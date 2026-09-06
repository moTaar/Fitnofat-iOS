import XCTest
@testable import ForgeFit

final class PersistenceTests: XCTestCase {
    let store = LocalStore.shared

    override func tearDown() {
        // Clean up test keys
        store.delete(forKey: "test_string")
        store.delete(forKey: "test_int")
        store.delete(forKey: "test_array")
        store.removeDefault(forKey: "test_default")
        super.tearDown()
    }

    // MARK: - LocalStore

    func testSaveAndLoadString() {
        store.save("hello", forKey: "test_string")
        let loaded: String? = store.load(String.self, forKey: "test_string")
        XCTAssertEqual(loaded, "hello")
    }

    func testSaveAndLoadInt() {
        store.save(42, forKey: "test_int")
        let loaded: Int? = store.load(Int.self, forKey: "test_int")
        XCTAssertEqual(loaded, 42)
    }

    func testSaveAndLoadArray() {
        let items = ["a", "b", "c"]
        store.save(items, forKey: "test_array")
        let loaded: [String]? = store.load([String].self, forKey: "test_array")
        XCTAssertEqual(loaded, items)
    }

    func testLoadMissingKey() {
        let loaded: String? = store.load(String.self, forKey: "nonexistent_key_xyz")
        XCTAssertNil(loaded)
    }

    func testExists() {
        store.save("exists", forKey: "test_string")
        XCTAssertTrue(store.exists(forKey: "test_string"))
        XCTAssertFalse(store.exists(forKey: "nonexistent_key_xyz"))
    }

    func testDelete() {
        store.save("delete_me", forKey: "test_string")
        XCTAssertTrue(store.exists(forKey: "test_string"))
        store.delete(forKey: "test_string")
        XCTAssertFalse(store.exists(forKey: "test_string"))
    }

    func testOverwriteValue() {
        store.save("first", forKey: "test_string")
        store.save("second", forKey: "test_string")
        let loaded: String? = store.load(String.self, forKey: "test_string")
        XCTAssertEqual(loaded, "second")
    }

    // MARK: - UserDefaults Convenience

    func testSetAndGetDefault() {
        store.setDefault("value123", forKey: "test_default")
        let loaded: String? = store.getDefault("test_default")
        XCTAssertEqual(loaded, "value123")
    }

    func testRemoveDefault() {
        store.setDefault("to_remove", forKey: "test_default")
        store.removeDefault(forKey: "test_default")
        let loaded: String? = store.getDefault("test_default")
        XCTAssertNil(loaded)
    }

    // MARK: - SyncQueue

    func testSyncQueueEnqueueAndCount() {
        SyncQueue.shared.clear()
        XCTAssertEqual(SyncQueue.shared.count, 0)

        SyncQueue.shared.enqueue(type: "workout", action: "create", payload: ["key": "value"])
        XCTAssertEqual(SyncQueue.shared.count, 1)

        SyncQueue.shared.enqueue(type: "workout", action: "update", payload: ["key2": "value2"])
        XCTAssertEqual(SyncQueue.shared.count, 2)
    }

    func testSyncQueueDequeue() {
        SyncQueue.shared.clear()
        SyncQueue.shared.enqueue(type: "workout", action: "create", payload: ["key": "value"])
        SyncQueue.shared.enqueue(type: "workout", action: "update", payload: ["key2": "value2"])

        let items = SyncQueue.shared.pendingItems()
        XCTAssertEqual(items.count, 2)

        SyncQueue.shared.dequeue(items[0].id)
        XCTAssertEqual(SyncQueue.shared.count, 1)

        SyncQueue.shared.dequeue(items[1].id)
        XCTAssertEqual(SyncQueue.shared.count, 0)
    }

    func testSyncQueueClear() {
        SyncQueue.shared.clear()
        SyncQueue.shared.enqueue(type: "workout", action: "create", payload: ["key": "value"])
        SyncQueue.shared.enqueue(type: "workout", action: "create", payload: ["key2": "value2"])
        XCTAssertEqual(SyncQueue.shared.count, 2)

        SyncQueue.shared.clear()
        XCTAssertEqual(SyncQueue.shared.count, 0)
    }

    func testSyncQueuePendingItems() {
        SyncQueue.shared.clear()
        SyncQueue.shared.enqueue(type: "workout", action: "create", payload: ["id": "123"])

        let items = SyncQueue.shared.pendingItems()
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items[0].type, "workout")
        XCTAssertEqual(items[0].action, "create")
    }
}
