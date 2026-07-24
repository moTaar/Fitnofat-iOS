import Foundation

// MARK: - API Errors

enum ApiError: LocalizedError {
    case httpError(Int, String)
    case authExpired
    case upgradeRequired(String, String?)
    case decodingError
    case networkError(String)

    var errorDescription: String? {
        switch self {
        case .httpError(let code, let msg): return "\(msg) (\(code))"
        case .authExpired: return "Session expired"
        case .upgradeRequired(let msg, _): return msg
        case .decodingError: return "Failed to decode response"
        case .networkError(let msg): return msg
        }
    }
}

// MARK: - API Client

final class APIClient {
    static let shared = APIClient()

    private let apiBase: String
    private let accountsBase: String
    private let session: URLSession
    private let decoder: JSONDecoder

    private init() {
        // Load from environment or defaults
        self.apiBase = (ProcessInfo.processInfo.environment["API_URL"] ?? "http://localhost:8080")
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        self.accountsBase = (ProcessInfo.processInfo.environment["ACCOUNTS_URL"] ?? "http://localhost:8090")
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        self.session = URLSession(configuration: config)
        self.decoder = JSONDecoder()
    }

    // MARK: - Request

    private func buildRequest(
        base: String,
        path: String,
        method: String = "GET",
        body: Data? = nil,
        authenticated: Bool = true
    ) -> URLRequest {
        let url = URL(string: "\(base)\(path)")!
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if authenticated, let token = AuthService.shared.accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        req.httpBody = body
        return req
    }

    private func request<T: Decodable>(
        _ path: String,
        method: String = "GET",
        body: Data? = nil,
        authenticated: Bool = true,
        base: String? = nil
    ) async throws -> T {
        let effectiveBase = base ?? apiBase
        var req = buildRequest(base: effectiveBase, path: path, method: method, body: body, authenticated: authenticated)

        // Attempt with current token
        var (data, response) = try await session.data(for: req)
        var httpResponse = response as! HTTPURLResponse

        // If 401 and authenticated, try refreshing the token
        if httpResponse.statusCode == 401 && authenticated && AuthService.shared.isAuthenticated {
            let refreshed = try await refreshSession()
            if refreshed {
                req = buildRequest(base: effectiveBase, path: path, method: method, body: body, authenticated: authenticated)
                (data, response) = try await session.data(for: req)
                httpResponse = response as! HTTPURLResponse
            } else {
                throw ApiError.authExpired
            }
        }

        // Handle error status codes
        guard (200...299).contains(httpResponse.statusCode) else {
            let errorBody = try? JSONDecoder().decode(ErrorBody.self, from: data)
            let message = errorBody?.error ?? "Request failed (\(httpResponse.statusCode))"
            if httpResponse.statusCode == 401 { throw ApiError.authExpired }
            if httpResponse.statusCode == 402 {
                throw ApiError.upgradeRequired(message, errorBody?.feature)
            }
            throw ApiError.httpError(httpResponse.statusCode, message)
        }

        // Decode response
        if T.self == Void.self || httpResponse.statusCode == 204 {
            return () as! T
        }

        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            print("[API] Decoding error for \(path): \(error)")
            print("[API] Raw response: \(String(data: data, encoding: .utf8) ?? "nil")")
            throw ApiError.decodingError
        }
    }

    private struct ErrorBody: Decodable {
        var error: String?
        var feature: String?
        var code: String?
    }

    // MARK: - Token Refresh

    private func refreshSession() async throws -> Bool {
        guard let refreshToken = AuthService.shared.refreshToken else { return false }
        let body = try JSONEncoder().encode(["refreshToken": refreshToken])
        var req = buildRequest(base: accountsBase, path: "/auth/refresh", method: "POST", body: body, authenticated: false)
        let (data, response) = try await session.data(for: req)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            AuthService.shared.clearSession()
            return false
        }
        let newSession = try decoder.decode(Session.self, from: data)
        AuthService.shared.setSession(newSession)
        return true
    }

    // MARK: - JSON Helpers

    private func encode<T: Encodable>(_ value: T) throws -> Data {
        try JSONEncoder().encode(value)
    }

    // MARK: - Auth Endpoints

    func signup(email: String, password: String, name: String?) async throws -> Session {
        var body: [String: String] = ["email": email, "password": password]
        if let name { body["name"] = name }
        let session: Session = try await request(
            "/auth/signup", method: "POST",
            body: try encode(body),
            authenticated: false,
            base: accountsBase
        )
        AuthService.shared.setSession(session)
        return session
    }

    func login(email: String, password: String) async throws -> Session {
        let body = ["email": email, "password": password]
        let session: Session = try await request(
            "/auth/login", method: "POST",
            body: try encode(body),
            authenticated: false,
            base: accountsBase
        )
        AuthService.shared.setSession(session)
        return session
    }

    func logout() {
        AuthService.shared.clearSession()
    }

    // MARK: - Account Endpoints

    func getAccount() async throws -> AccountInfo {
        try await request("/account", base: accountsBase)
    }

    func updateAccount(name: String? = nil, email: String? = nil) async throws -> [String: Bool] {
        var body: [String: String] = [:]
        if let name { body["name"] = name }
        if let email { body["email"] = email }
        return try await request("/account", method: "PATCH", body: try encode(body), base: accountsBase)
    }

    func changePassword(_ password: String) async throws -> [String: Bool] {
        try await request("/account/password", method: "POST", body: try encode(["password": password]), base: accountsBase)
    }

    func deleteAccount() async throws {
        let _: Void = try await request("/account", method: "DELETE", base: accountsBase)
    }

    // MARK: - Billing Endpoints

    func getPlans() async throws -> PlansResponse {
        try await request("/billing/plans", base: accountsBase)
    }

    func getSubscription() async throws -> Subscription {
        try await request("/billing/subscription", base: accountsBase)
    }

    func startCheckout(plan: String) async throws -> CheckoutResponse {
        try await request("/billing/checkout", method: "POST", body: try encode(["plan": plan]), base: accountsBase)
    }

    func openBillingPortal() async throws -> CheckoutResponse {
        try await request("/billing/portal", method: "POST", base: accountsBase)
    }

    // MARK: - Data Endpoints

    func bootstrap() async throws -> BootstrapData {
        try await request("/api/bootstrap")
    }

    func updateProfile(_ profile: UserProfile) async throws -> UserProfile {
        try await request("/api/profile", method: "PUT", body: try encode(profile))
    }

    func generateProgram(profile: UserProfile) async throws -> ProgramResult {
        try await request("/api/program/generate", method: "POST", body: try encode(profile))
    }

    func refreshProgram() async throws -> ProgramResult {
        try await request("/api/program/refresh", method: "POST")
    }

    func createRoutine(_ routine: Routine) async throws -> Routine {
        try await request("/api/routines", method: "POST", body: try encode(routine))
    }

    func updateRoutine(id: String, patch: [String: Any]) async throws -> Routine {
        let data = try JSONSerialization.data(withJSONObject: patch)
        return try await request("/api/routines/\(id)", method: "PUT", body: data)
    }

    func deleteRoutine(id: String) async throws {
        let _: Void = try await request("/api/routines/\(id)", method: "DELETE")
    }

    func createExercise(name: String, muscleGroup: String, equipment: String) async throws -> Exercise {
        try await request("/api/exercises", method: "POST", body: try encode([
            "name": name, "muscleGroup": muscleGroup, "equipment": equipment
        ]))
    }

    func aiAssistExercise(name: String) async throws -> Exercise {
        try await request("/api/exercises/ai-assist", method: "POST", body: try encode(["name": name]))
    }

    func exerciseGuide(name: String, muscleGroup: String? = nil, equipment: String? = nil, force: Bool? = nil) async throws -> Exercise {
        var body: [String: Any] = ["name": name]
        if let mg = muscleGroup { body["muscleGroup"] = mg }
        if let eq = equipment { body["equipment"] = eq }
        if let f = force { body["force"] = f }
        let data = try JSONSerialization.data(withJSONObject: body)
        return try await request("/api/exercises/guide", method: "POST", body: data)
    }

    func exerciseMet(name: String, muscleGroup: String? = nil, equipment: String? = nil, kind: String? = nil) async throws -> MetResponse {
        var body: [String: String] = ["name": name]
        if let mg = muscleGroup { body["muscleGroup"] = mg }
        if let eq = equipment { body["equipment"] = eq }
        if let k = kind { body["kind"] = k }
        return try await request("/api/exercises/met", method: "POST", body: try encode(body))
    }

    func generateNutrition(patch: UserProfile? = nil) async throws -> NutritionGenerateResponse {
        try await request("/api/nutrition/generate", method: "POST", body: patch.map { try encode($0) } ?? Data())
    }

    func lookupFood(query: String) async throws -> FoodLookupResponse {
        try await request("/api/nutrition/lookup", method: "POST", body: try encode(["query": query]))
    }

    func saveWorkouts(_ workouts: [WorkoutSession]) async throws -> [WorkoutSession] {
        try await request("/api/workouts", method: "POST", body: try encode(workouts))
    }

    func deleteWorkout(id: String) async throws {
        let _: Void = try await request("/api/workouts/\(id)", method: "DELETE")
    }

    func aiChat(messages: [[String: Any]]) async throws -> AiChatResponse {
        let data = try JSONSerialization.data(withJSONObject: ["messages": messages])
        return try await request("/api/ai/chat", method: "POST", body: data)
    }

    func aiCoach(messages: [CoachMessagePayload]) async throws -> AiCoachResponse {
        let data = try JSONEncoder().encode(["messages": messages])
        return try await request("/api/ai/coach", method: "POST", body: data)
    }
}

// MARK: - Supporting Types

struct NutritionGenerateResponse: Decodable {
    var nutritionPlan: NutritionPlan
    var profile: UserProfile
}

struct CoachMessagePayload: Codable {
    var role: String
    var content: String
    var images: [CoachImagePayload]?
}

struct CoachImagePayload: Codable {
    var mimeType: String
    var data: String
}
