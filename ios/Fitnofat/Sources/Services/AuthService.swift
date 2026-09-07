import Foundation
import Security

// MARK: - Session

struct Session: Codable {
    var accessToken: String
    var refreshToken: String
    var expiresAt: Int
    var user: UserInfo

    struct UserInfo: Codable {
        var id: String
        var email: String
    }
}

// MARK: - Auth Service

final class AuthService {
    static let shared = AuthService()

    // Session persistence
    private let sessionKey = "forgefit_session"
    private let keychainService = "com.fitnofat.auth"

    // Callbacks for session changes
    private var listeners: [(Session?) -> Void] = []

    // Published state
    private(set) var session: Session? {
        didSet {
            persistSession()
            notifyListeners()
        }
    }

    var isAuthenticated: Bool { session != nil }
    var accessToken: String? { session?.accessToken }
    var refreshToken: String? { session?.refreshToken }
    var userId: String? { session?.user.id }

    private init() {
        session = loadSession()
    }

    // MARK: - Public API

    func setSession(_ s: Session) { session = s }
    func clearSession() { session = nil }

    func onChange(_ cb: @escaping (Session?) -> Void) -> () -> Void {
        listeners.append(cb)
        return { [weak self] in
            self?.listeners.removeAll { $0 as AnyObject === cb as AnyObject }
        }
    }

    // MARK: - Persistence (Keychain)

    private func persistSession() {
        guard let session else {
            deleteFromKeychain()
            return
        }
        do {
            let data = try JSONEncoder().encode(session)
            saveToKeychain(data: data)
        } catch {
            print("[Auth] Failed to encode session: \(error)")
        }
    }

    private func loadSession() -> Session? {
        guard let data = loadFromKeychain() else { return nil }
        return try? JSONDecoder().decode(Session.self, from: data)
    }

    private func saveToKeychain(data: Data) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: sessionKey,
            kSecValueData as String: data,
        ]
        SecItemDelete(query as CFDictionary)
        SecItemAdd(query as CFDictionary, nil)
    }

    private func loadFromKeychain() -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: sessionKey,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else { return nil }
        return data
    }

    private func deleteFromKeychain() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: sessionKey,
        ]
        SecItemDelete(query as CFDictionary)
    }

    private func notifyListeners() {
        listeners.forEach { $0(session) }
    }
}

// MARK: - Auth Errors

enum AuthError: LocalizedError {
    case expired
    case invalidCredentials
    case networkError(String)
    case unknown(String)

    var errorDescription: String? {
        switch self {
        case .expired: return "Session expired"
        case .invalidCredentials: return "Invalid email or password"
        case .networkError(let msg): return msg
        case .unknown(let msg): return msg
        }
    }
}
