import Foundation

// MARK: - Local Persistence

/// Lightweight persistence layer using FileManager and UserDefaults.
/// Replaces the web app's localStorage and Zustand store persistence.

final class LocalStore {
    static let shared = LocalStore()

    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private let fileManager = FileManager.default

    private var documentsDir: URL {
        fileManager.urls(for: .documentDirectory, in: .userDomainMask).first!
    }

    private init() {}

    // MARK: - File-based Storage

    /// Save a Codable value to a file in the documents directory.
    func save<T: Codable>(_ value: T, forKey key: String) {
        let url = documentsDir.appendingPathComponent("\(key).json")
        do {
            let data = try encoder.encode(value)
            try data.write(to: url, options: .atomic)
        } catch {
            print("[LocalStore] Failed to save '\(key)': \(error)")
        }
    }

    /// Load a Codable value from a file in the documents directory.
    func load<T: Codable>(_ type: T.Type, forKey key: String) -> T? {
        let url = documentsDir.appendingPathComponent("\(key).json")
        guard fileManager.fileExists(atPath: url.path) else { return nil }
        do {
            let data = try Data(contentsOf: url)
            return try decoder.decode(type, from: data)
        } catch {
            print("[LocalStore] Failed to load '\(key)': \(error)")
            return nil
        }
    }

    /// Delete a stored file.
    func delete(forKey key: String) {
        let url = documentsDir.appendingPathComponent("\(key).json")
        guard fileManager.fileExists(atPath: url.path) else { return }
        do {
            try fileManager.removeItem(at: url)
        } catch {
            print("[LocalStore] Failed to delete '\(key)': \(error)")
        }
    }

    /// Check if a key exists in storage.
    func exists(forKey key: String) -> Bool {
        let url = documentsDir.appendingPathComponent("\(key).json")
        return fileManager.fileExists(atPath: url.path)
    }

    // MARK: - UserDefaults Convenience

    /// Save a simple value to UserDefaults.
    func setDefault<T>(_ value: T, forKey key: String) {
        UserDefaults.standard.set(value, forKey: "forgefit.\(key)")
    }

    /// Load a simple value from UserDefaults.
    func getDefault<T>(_ key: String) -> T? {
        UserDefaults.standard.object(forKey: "forgefit.\(key)") as? T
    }

    /// Remove a key from UserDefaults.
    func removeDefault(forKey key: String) {
        UserDefaults.standard.removeObject(forKey: "forgefit.\(key)")
    }
}

// MARK: - Sync Queue

/// Manages a queue of offline mutations that need to be synced to the server.
/// Used for workouts created while offline.
struct SyncQueueItem: Codable {
    let id: String
    let type: String
    let action: String
    let payload: Data
    let createdAt: Int
}

final class SyncQueue {
    static let shared = SyncQueue()
    private let store = LocalStore.shared
    private let queueKey = "sync_queue"

    private init() {}

    /// Add an item to the sync queue.
    func enqueue(type: String, action: String, payload: Encodable) {
        var queue = getQueue()
        do {
            let data = try JSONEncoder().encode(payload)
            let item = SyncQueueItem(
                id: UUID().uuidString,
                type: type,
                action: action,
                payload: data,
                createdAt: Int(Date().timeIntervalSince1970)
            )
            queue.append(item)
            store.save(queue, forKey: queueKey)
        } catch {
            print("[SyncQueue] Failed to enqueue: \(error)")
        }
    }

    /// Get all pending sync items.
    func pendingItems() -> [SyncQueueItem] {
        getQueue()
    }

    /// Remove a specific item from the queue (after successful sync).
    func dequeue(_ id: String) {
        var queue = getQueue()
        queue.removeAll { $0.id == id }
        store.save(queue, forKey: queueKey)
    }

    /// Clear all items from the sync queue.
    func clear() {
        store.delete(forKey: queueKey)
    }

    /// Number of pending items.
    var count: Int {
        getQueue().count
    }

    private func getQueue() -> [SyncQueueItem] {
        store.load([SyncQueueItem].self, forKey: queueKey) ?? []
    }
}
