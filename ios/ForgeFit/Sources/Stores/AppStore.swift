import Foundation
import Combine

// MARK: - App Store

/// Root application state store.
/// Manages authentication lifecycle, bootstrap loading, and global state.
@MainActor
final class AppStore: ObservableObject {
    static let shared = AppStore()

    // MARK: - Published State

    @Published var isAuthenticated: Bool = false
    @Published var isLoading: Bool = true
    @Published var bootstrapData: BootstrapData?
    @Published var error: String?

    // MARK: - Sub-stores

    @Published var profile = ProfileStore.shared
    @Published var program = ProgramStore.shared
    @Published var workouts = WorkoutStore.shared
    @Published var nutrition = NutritionStore.shared
    @Published var exercises = ExerciseStore.shared
    @Published var billing = BillingStore.shared
    @Published var aiCoach = AICoachStore.shared

    // MARK: - Auth Cancel Handler

    private var authCancel: (() -> Void)?

    private init() {
        authCancel = AuthService.shared.onChange { [weak self] session in
            DispatchQueue.main.async {
                self?.isAuthenticated = session != nil
                if session == nil {
                    self?.clearAll()
                }
            }
        }
        isAuthenticated = AuthService.shared.isAuthenticated
    }

    deinit {
        authCancel?()
    }

    // MARK: - Bootstrap

    /// Load the initial app data. If authenticated, try to bootstrap from server.
    /// Falls back to cached data if offline.
    func load() async {
        isLoading = true
        error = nil

        guard AuthService.shared.isAuthenticated else {
            isLoading = false
            return
        }

        do {
            let data = try await APIClient.shared.bootstrap()
            bootstrapData = data
            profile.load(from: data)
            program.load(from: data)
            workouts.load(from: data)
            nutrition.load(from: data)
            exercises.load(from: data)
            isLoading = false
        } catch let apiError as ApiError {
            if case .networkError = apiError {
                // Offline — load from cache
                loadCached()
            } else {
                error = apiError.localizedDescription
            }
            isLoading = false
        } catch {
            self.error = error.localizedDescription
            isLoading = false
        }
    }

    /// Load data from local cache when offline.
    private func loadCached() {
        profile.loadCached()
        program.loadCached()
        workouts.loadCached()
        nutrition.loadCached()
        exercises.loadCached()
    }

    /// Clear all stores on logout.
    private func clearAll() {
        bootstrapData = nil
        profile.reset()
        program.reset()
        workouts.reset()
        nutrition.reset()
        exercises.reset()
    }

    /// Sign out and clear all data.
    func signOut() {
        APIClient.shared.logout()
        clearAll()
        isAuthenticated = false
    }
}

// MARK: - Profile Store

@MainActor
final class ProfileStore: ObservableObject {
    static let shared = ProfileStore()

    @Published var profile: UserProfile = UserProfile()
    @Published var isLoading: Bool = false

    private let cacheKey = "user_profile"
    private init() {}

    func load(from data: BootstrapData) {
        if let p = data.profile {
            profile = p
            LocalStore.shared.save(p, forKey: cacheKey)
        }
    }

    func loadCached() {
        if let cached: UserProfile = LocalStore.shared.load(UserProfile.self, forKey: cacheKey) {
            profile = cached
        }
    }

    func update(_ patch: UserProfile) async throws {
        isLoading = true
        defer { isLoading = false }
        let updated = try await APIClient.shared.updateProfile(patch)
        profile = updated
        LocalStore.shared.save(updated, forKey: cacheKey)
    }

    func reset() {
        profile = UserProfile()
        LocalStore.shared.delete(forKey: cacheKey)
    }
}

// MARK: - Program Store

@MainActor
final class ProgramStore: ObservableObject {
    static let shared = ProgramStore()

    @Published var program: Program?
    @Published var routines: [Routine] = []
    @Published var isLoading: Bool = false

    private let programCacheKey = "current_program"
    private let routinesCacheKey = "current_routines"
    private init() {}

    func load(from data: BootstrapData) {
        program = data.program
        routines = data.routines
        cache()
    }

    func loadCached() {
        program = LocalStore.shared.load(Program.self, forKey: programCacheKey)
        routines = LocalStore.shared.load([Routine].self, forKey: routinesCacheKey) ?? []
    }

    /// Generate a new program from user profile.
    func generate(profile: UserProfile) async throws {
        isLoading = true
        defer { isLoading = false }
        let result = try await APIClient.shared.generateProgram(profile: profile)
        program = result.program
        routines = result.routines
        if let nutrition = result.nutritionPlan {
            NutritionStore.shared.nutritionPlan = nutrition
        }
        cache()
    }

    /// Refresh the current program (AI re-evaluation).
    func refresh() async throws {
        isLoading = true
        defer { isLoading = false }
        let result = try await APIClient.shared.refreshProgram()
        program = result.program
        routines = result.routines
        if let nutrition = result.nutritionPlan {
            NutritionStore.shared.nutritionPlan = nutrition
        }
        cache()
    }

    /// Create a manual routine.
    func createRoutine(_ routine: Routine) async throws {
        let created = try await APIClient.shared.createRoutine(routine)
        routines.append(created)
        cache()
    }

    /// Update a routine (patch).
    func updateRoutine(id: String, patch: [String: Any]) async throws {
        let updated = try await APIClient.shared.updateRoutine(id: id, patch: patch)
        if let idx = routines.firstIndex(where: { $0.id == id }) {
            routines[idx] = updated
        }
        cache()
    }

    /// Delete a routine.
    func deleteRoutine(id: String) async throws {
        try await APIClient.shared.deleteRoutine(id: id)
        routines.removeAll { $0.id == id }
        cache()
    }

    private func cache() {
        if let p = program { LocalStore.shared.save(p, forKey: programCacheKey) }
        LocalStore.shared.save(routines, forKey: routinesCacheKey)
    }

    func reset() {
        program = nil
        routines = []
        LocalStore.shared.delete(forKey: programCacheKey)
        LocalStore.shared.delete(forKey: routinesCacheKey)
    }
}

// MARK: - Workout Store

@MainActor
final class WorkoutStore: ObservableObject {
    static let shared = WorkoutStore()

    @Published var workoutSessions: [WorkoutSession] = []
    @Published var activeWorkout: ActiveWorkout?
    @Published var isLoading: Bool = false

    private let sessionsCacheKey = "workout_sessions"
    private init() {}

    func load(from data: BootstrapData) {
        workoutSessions = data.workouts
        LocalStore.shared.save(data.workouts, forKey: sessionsCacheKey)
    }

    func loadCached() {
        workoutSessions = LocalStore.shared.load([WorkoutSession].self, forKey: sessionsCacheKey) ?? []
    }

    /// Save workouts (supports offline queue).
    func saveWorkouts(_ sessions: [WorkoutSession]) async throws {
        isLoading = true
        defer { isLoading = false }

        // Update local state immediately
        for session in sessions {
            if let idx = workoutSessions.firstIndex(where: { $0.id == session.id }) {
                workoutSessions[idx] = session
            } else {
                workoutSessions.append(session)
            }
        }
        LocalStore.shared.save(workoutSessions, forKey: sessionsCacheKey)

        do {
            let synced = try await APIClient.shared.saveWorkouts(sessions)
            // Update with server response (includes computed fields like calories)
            for session in synced {
                if let idx = workoutSessions.firstIndex(where: { $0.id == session.id }) {
                    workoutSessions[idx] = session
                }
            }
            LocalStore.shared.save(workoutSessions, forKey: sessionsCacheKey)
        } catch let apiError as ApiError {
            if case .networkError = apiError {
                // Queue for later sync
                for session in sessions {
                    SyncQueue.shared.enqueue(type: "workout", action: "save", payload: session)
                }
            } else {
                throw apiError
            }
        }
    }

    /// Delete a workout session.
    func deleteWorkout(id: String) async throws {
        try await APIClient.shared.deleteWorkout(id: id)
        workoutSessions.removeAll { $0.id == id }
        LocalStore.shared.save(workoutSessions, forKey: sessionsCacheKey)
    }

    /// Start a new active workout.
    func startWorkout(routine: Routine) {
        activeWorkout = ActiveWorkout(
            routineName: routine.name,
            startedAt: Int(Date().timeIntervalSince1970),
            exercises: routine.exercises.map { ex in
                LoggedExercise(
                    exerciseId: ex.exerciseId,
                    name: ex.name,
                    muscleGroup: ex.muscleGroup,
                    restSeconds: ex.restSeconds,
                    kind: ex.muscleGroup == "Cardio" ? .cardio : .strength,
                    sets: ex.sets.map { LoggedSet(weight: $0.targetWeight ?? 0, reps: $0.targetReps, completed: false) }
                )
            }
        )
    }

    /// Start a free-form (no routine) workout.
    func startFreeWorkout(name: String) {
        activeWorkout = ActiveWorkout(
            routineName: name,
            startedAt: Int(Date().timeIntervalSince1970)
        )
    }

    /// Complete the active workout.
    func finishWorkout() -> WorkoutSession? {
        guard let active = activeWorkout else { return nil }
        let now = Int(Date().timeIntervalSince1970)
        let duration = now - active.startedAt

        let totalVolume = active.exercises.reduce(0.0) { total, ex in
            total + ex.sets.reduce(0.0) { $0 + $1.weight * Double($1.reps) }
        }

        let session = WorkoutSession(
            id: UUID().uuidString,
            clientId: UUID().uuidString,
            routineId: nil,
            routineName: active.routineName,
            startedAt: active.startedAt,
            endedAt: now,
            durationSec: duration,
            totalVolume: totalVolume,
            exercises: active.exercises
        )

        workoutSessions.append(session)
        LocalStore.shared.save(workoutSessions, forKey: sessionsCacheKey)
        self.activeWorkout = nil
        return session
    }

    /// Discard the active workout.
    func discardWorkout() {
        activeWorkout = nil
    }

    func reset() {
        workoutSessions = []
        activeWorkout = nil
        LocalStore.shared.delete(forKey: sessionsCacheKey)
    }
}

// MARK: - Nutrition Store

@MainActor
final class NutritionStore: ObservableObject {
    static let shared = NutritionStore()

    @Published var nutritionPlan: NutritionPlan?
    @Published var isLoading: Bool = false

    private let cacheKey = "nutrition_plan"
    private init() {}

    func load(from data: BootstrapData) {
        nutritionPlan = data.nutritionPlan
        if let plan = data.nutritionPlan { LocalStore.shared.save(plan, forKey: cacheKey) }
    }

    func loadCached() {
        nutritionPlan = LocalStore.shared.load(NutritionPlan.self, forKey: cacheKey)
    }

    /// Generate or regenerate nutrition plan.
    func generate(patch: UserProfile? = nil) async throws {
        isLoading = true
        defer { isLoading = false }
        let result = try await APIClient.shared.generateNutrition(patch: patch)
        nutritionPlan = result.nutritionPlan
        ProfileStore.shared.profile = result.profile
        LocalStore.shared.save(result.nutritionPlan, forKey: cacheKey)
    }

    /// Look up a food item.
    func lookupFood(query: String) async throws -> FoodLookupResult? {
        let response = try await APIClient.shared.lookupFood(query: query)
        return response.result
    }

    func reset() {
        nutritionPlan = nil
        LocalStore.shared.delete(forKey: cacheKey)
    }
}

// MARK: - Exercise Store

@MainActor
final class ExerciseStore: ObservableObject {
    static let shared = ExerciseStore()

    @Published var exercises: [Exercise] = []
    @Published var isLoading: Bool = false

    private let cacheKey = "exercises"
    private init() {}

    func load(from data: BootstrapData) {
        exercises = data.exercises
        LocalStore.shared.save(data.exercises, forKey: cacheKey)
    }

    func loadCached() {
        exercises = LocalStore.shared.load([Exercise].self, forKey: cacheKey) ?? []
    }

    /// Look up an exercise by name from the local library.
    func lookup(name: String) -> Exercise? {
        exercises.first { $0.name.lowercased() == name.lowercased() }
            ?? SeedExercises.all.first { $0.name.lowercased() == name.lowercased() }.map {
                Exercise(id: $0.id, name: $0.name, muscleGroup: $0.muscleGroup, equipment: $0.equipment, met: $0.met, guide: $0.guide)
            }
    }

    /// Create a new exercise on the server.
    func create(name: String, muscleGroup: String, equipment: String) async throws -> Exercise {
        let exercise = try await APIClient.shared.createExercise(name: name, muscleGroup: muscleGroup, equipment: equipment)
        exercises.append(exercise)
        LocalStore.shared.save(exercises, forKey: cacheKey)
        return exercise
    }

    /// AI-assisted exercise creation (name → muscle group + equipment + guide).
    func aiAssist(name: String) async throws -> Exercise {
        let exercise = try await APIClient.shared.aiAssistExercise(name: name)
        if !exercises.contains(where: { $0.id == exercise.id }) {
            exercises.append(exercise)
            LocalStore.shared.save(exercises, forKey: cacheKey)
        }
        return exercise
    }

    /// Get or generate an exercise guide.
    func guide(name: String, muscleGroup: String? = nil, equipment: String? = nil, force: Bool = false) async throws -> Exercise {
        try await APIClient.shared.exerciseGuide(name: name, muscleGroup: muscleGroup, equipment: equipment, force: force)
    }

    /// Resolve MET value for an exercise.
    func resolveMet(name: String, muscleGroup: String? = nil, equipment: String? = nil, kind: String? = nil) async throws -> Double {
        let response = try await APIClient.shared.exerciseMet(name: name, muscleGroup: muscleGroup, equipment: equipment, kind: kind)
        return response.met
    }

    func reset() {
        exercises = []
        LocalStore.shared.delete(forKey: cacheKey)
    }
}

// MARK: - Billing Store

@MainActor
final class BillingStore: ObservableObject {
    static let shared = BillingStore()

    @Published var subscription: Subscription?
    @Published var plans: [PlanInfo] = []
    @Published var isLoading: Bool = false

    private init() {}

    /// Load subscription and plans from server.
    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            async let sub = APIClient.shared.getSubscription()
            async let plansResp = APIClient.shared.getPlans()
            (subscription, plans) = try await (sub, plansResp.plans)
        } catch {
            print("[Billing] Failed to load: \(error)")
        }
    }

    /// Check if user is entitled to a feature.
    func isEntitled(to feature: Feature) -> Bool {
        EntitlementService.shared.isEntitled(to: feature, subscription: subscription)
    }

    /// Start a checkout session for a plan upgrade.
    func startCheckout(plan: String) async throws -> URL {
        let response = try await APIClient.shared.startCheckout(plan: plan)
        guard let url = URL(string: response.url) else {
            throw ApiError.httpError(400, "Invalid checkout URL")
        }
        return url
    }

    /// Open the billing portal for managing subscription.
    func openPortal() async throws -> URL {
        let response = try await APIClient.shared.openBillingPortal()
        guard let url = URL(string: response.url) else {
            throw ApiError.httpError(400, "Invalid portal URL")
        }
        return url
    }

    func reset() {
        subscription = nil
        plans = []
    }
}

// MARK: - AI Coach Store

@MainActor
final class AICoachStore: ObservableObject {
    static let shared = AICoachStore()

    @Published var messages: [CoachMessage] = []
    @Published var isLoading: Bool = false
    @Published var error: String?

    private let cacheKey = "coach_messages"
    private init() {}

    struct CoachMessage: Identifiable, Codable {
        let id: String
        let role: String
        let content: String
        let images: [CoachImagePayload]?

        init(role: String, content: String, images: [CoachImagePayload]? = nil) {
            self.id = UUID().uuidString
            self.role = role
            self.content = content
            self.images = images
        }
    }

    /// Send a message to the AI coach.
    func send(content: String, images: [UIImage]? = nil) async throws {
        isLoading = true
        error = nil

        // Prepare images
        var imagePayloads: [CoachImagePayload]? = nil
        if let images = images, !images.isEmpty {
            imagePayloads = images.compactMap { img in
                guard let b64 = ImageUtils.prepareCoachImage(img) else { return nil }
                return CoachImagePayload(mimeType: "image/jpeg", data: b64)
            }
            if let validationError = ImageUtils.validateCoachImages(imagePayloads!.map(\.data)) {
                error = validationError
                isLoading = false
                throw ApiError.httpError(400, validationError)
            }
        }

        let userMessage = CoachMessage(role: "user", content: content, images: imagePayloads)
        messages.append(userMessage)
        LocalStore.shared.save(messages, forKey: cacheKey)

        // Build payload
        let payloads = messages.map { msg in
            CoachMessagePayload(role: msg.role, content: msg.content, images: msg.images)
        }

        do {
            let response = try await APIClient.shared.aiCoach(messages: payloads)

            let coachMessage = CoachMessage(role: "assistant", content: response.text)
            messages.append(coachMessage)
            LocalStore.shared.save(messages, forKey: cacheKey)

            // Handle coach actions
            if response.type == "update", let routines = response.routines {
                ProgramStore.shared.routines = routines
                if let program = response.program {
                    ProgramStore.shared.program = program
                }
            }

            if response.type == "log", let workout = response.workout {
                WorkoutStore.shared.workoutSessions.append(workout)
            }

        } catch {
            self.error = error.localizedDescription
            throw error
        }

        isLoading = false
    }

    /// Load cached messages.
    func loadCached() {
        messages = LocalStore.shared.load([CoachMessage].self, forKey: cacheKey) ?? []
    }

    /// Clear conversation history.
    func clear() {
        messages = []
        LocalStore.shared.delete(forKey: cacheKey)
    }
}
