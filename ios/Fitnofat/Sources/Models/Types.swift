import Foundation

// MARK: - Enums

enum Goal: String, Codable, CaseIterable, Identifiable {
    case strength, hypertrophy, weightLoss = "weight_loss", endurance, general
    var id: String { rawValue }
    var label: String {
        switch self {
        case .strength: return "Strength"
        case .hypertrophy: return "Muscle (Hypertrophy)"
        case .weightLoss: return "Weight Loss"
        case .endurance: return "Endurance"
        case .general: return "General Fitness"
        }
    }
}

enum Equipment: String, Codable, CaseIterable, Identifiable {
    case fullGym = "full_gym", homeGym = "home_gym", dumbbells, bodyweight
    case resistanceBands = "resistance_bands", machines, kettlebells, mixed, other
    var id: String { rawValue }
    var label: String {
        switch self {
        case .fullGym: return "Full Gym"
        case .homeGym: return "Home Gym"
        case .dumbbells: return "Dumbbells"
        case .bodyweight: return "Bodyweight"
        case .resistanceBands: return "Resistance Bands"
        case .machines: return "Machines"
        case .kettlebells: return "Kettlebells"
        case .mixed: return "Mixed"
        case .other: return "Other"
        }
    }
}

enum Experience: String, Codable, CaseIterable, Identifiable {
    case beginner, intermediate, advanced
    var id: String { rawValue }
    var label: String { rawValue.capitalized }
}

enum WorkoutCategory: String, Codable, CaseIterable, Identifiable {
    case calisthenics, weightlifting, cardio, yogaPilates = "yoga_pilates", mixed, other
    var id: String { rawValue }
    var label: String {
        switch self {
        case .yogaPilates: return "Yoga & Pilates"
        default: return rawValue.capitalized
        }
    }
}

enum MuscleGroup: String, Codable, CaseIterable, Identifiable {
    case chest = "Chest", back = "Back", shoulders = "Shoulders"
    case biceps = "Biceps", triceps = "Triceps"
    case legs = "Legs", glutes = "Glutes", core = "Core"
    case cardio = "Cardio", fullBody = "Full Body"
    var id: String { rawValue }
}

enum ActivityLevel: String, Codable, CaseIterable, Identifiable {
    case sedentary, light, moderate, veryActive = "very_active"
    var id: String { rawValue }
    var label: String {
        switch self {
        case .sedentary: return "Sedentary"
        case .light: return "Light"
        case .moderate: return "Moderate"
        case .veryActive: return "Very Active"
        }
    }
}

enum DietGoal: String, Codable, CaseIterable, Identifiable {
    case leanGain = "lean_gain", recomp, maintain, deficit, aggressiveDeficit = "aggressive_deficit"
    var id: String { rawValue }
    var label: String {
        switch self {
        case .leanGain: return "Lean Gain"
        case .recomp: return "Recomposition"
        case .maintain: return "Maintain"
        case .deficit: return "Deficit"
        case .aggressiveDeficit: return "Aggressive Deficit"
        }
    }
}

enum Sex: String, Codable, CaseIterable, Identifiable {
    case male, female, other
    var id: String { rawValue }
}

enum Cuisine: String, Codable, CaseIterable, Identifiable {
    case standard, french, italian, korean, mediterranean, mexican, japanese
    var id: String { rawValue }
    var label: String { rawValue.capitalized }
}

enum ExerciseKind: String, Codable {
    case strength, cardio, hold
}

enum Plan: String, Codable {
    case free, pro
}

enum Feature: String, Codable {
    case aiCoach = "ai_coach", aiNutrition = "ai_nutrition"
    case programRefresh = "program_refresh", aiExercise = "ai_exercise"
    case aiMedical = "ai_medical"
}

enum RoutineSource: String, Codable {
    case ai, manual
}

enum SubscriptionStatus: String, Codable {
    case active, trialing, pastDue = "past_due", canceled, expired
}

enum RepSensitivity: String, Codable {
    case low, medium, high
}

// MARK: - Core Data Types

struct UserProfile: Codable, Equatable {
    var name: String = ""
    var goal: Goal = .general
    var equipment: Equipment = .bodyweight
    var equipmentMix: [String]?
    var experience: Experience = .beginner
    var category: WorkoutCategory = .mixed
    var daysPerWeek: Int = 3
    var sessionMinutes: Int = 45
    var bodyweightKg: Double?
    var units: String = "kg"
    var notes: String?
    var heightCm: Double?
    var age: Int?
    var sex: Sex?
    var activityLevel: ActivityLevel?
    var dietGoal: DietGoal?
    var dietRestrictions: [String]?
    var cuisine: Cuisine?
    var onboarded: Bool = false
}

struct MacroTargets: Codable, Equatable {
    var calories: Int = 0
    var protein: Int = 0
    var carbs: Int = 0
    var fats: Int = 0
}

struct PortionItem: Codable, Identifiable, Equatable {
    var id: String { food + amount }
    let food: String
    let amount: String
    let visual: String?
    let kind: String
    var calories: Int?
}

struct Meal: Codable, Identifiable, Equatable {
    var id: String { name + slot }
    let name: String
    let slot: String
    let timing: String
    let macros: MacroTargets
    let items: [PortionItem]
    let note: String?
}

struct DayPlan: Codable, Equatable {
    let targets: MacroTargets
    let meals: [Meal]
    let hydrationLiters: Double
}

struct NutritionPlanData: Codable, Equatable {
    let strategy: String
    let summary: String
    let trainingDay: DayPlan
    let restDay: DayPlan
}

struct NutritionPlan: Codable, Identifiable, Equatable {
    let id: String
    let iteration: Int
    let createdAt: Int
    let strategy: String
    let summary: String
    let trainingDay: DayPlan
    let restDay: DayPlan
}

struct FoodLookupResult: Codable {
    let foodName: String
    let portion: String
    let macros: MacroTargets
    let micros: [MicroNutrient]?
    let confidence: String?
    let notes: String?
}

struct MicroNutrient: Codable {
    let name: String
    let amount: String
}

struct LoggedFood: Codable, Identifiable {
    let id: String
    let date: Date
    let mealSlot: String
    let foodName: String
    let portion: String
    let macros: MacroTargets
}

struct NutritionLog: Codable {
    var foods: [LoggedFood] = []
}

struct ExerciseGuide: Codable, Equatable {
    var steps: [String] = []
    var cues: [String] = []
    var mistakes: [String] = []
    var breathing: String?
    var pattern: String?
    var load: String?
    var prop: String?
}

struct Exercise: Codable, Identifiable, Equatable {
    let id: String
    var name: String
    var muscleGroup: String
    var equipment: String
    var met: Double?
    var guide: ExerciseGuide?
    var source: String?

    static func == (lhs: Exercise, rhs: Exercise) -> Bool { lhs.id == rhs.id }
}

struct PlannedSet: Codable {
    var targetReps: Int
    var targetWeight: Double?
    var rpe: Double?
}

struct RoutineExercise: Codable, Identifiable {
    var id: String { exerciseId + UUID().uuidString }
    var exerciseId: String
    var name: String
    var muscleGroup: String
    var sets: [PlannedSet]
    var restSeconds: Int
    var notes: String?
}

struct Routine: Codable, Identifiable {
    var id: String
    var name: String
    var description: String?
    var dayLabel: String?
    var favorite: Bool = false
    var source: RoutineSource = .manual
    var exercises: [RoutineExercise] = []
    var createdAt: Int
}

struct LoggedSet: Codable {
    var weight: Double = 0
    var reps: Int = 0
    var completed: Bool = false
    var durationSec: Int?
    var distanceKm: Double?
    var rpe: Double?
}

struct LoggedExercise: Codable, Identifiable {
    var id: String { exerciseId }
    var exerciseId: String
    var name: String
    var muscleGroup: String
    var restSeconds: Int
    var kind: ExerciseKind?
    var calories: Int?
    var sets: [LoggedSet] = []
}

struct WorkoutSession: Codable, Identifiable {
    var id: String
    var clientId: String
    var routineId: String?
    var routineName: String
    var startedAt: Int
    var endedAt: Int?
    var durationSec: Int
    var totalVolume: Double
    var calories: Int?
    var notes: String?
    var exercises: [LoggedExercise] = []
    var synced: Bool = true
}

struct ActiveWorkout: Codable {
    var routineName: String
    var startedAt: Int
    var exercises: [LoggedExercise] = []
    var restTimer: RestTimerState?
}

struct RestTimerState: Codable {
    var endsAt: Int
    var duration: Int
}

// Program-related types

struct AIGeneratedSet: Codable {
    var reps: Int
    var weight: Double?
    var rpe: Double?
}

struct AIGeneratedExercise: Codable {
    var name: String
    var muscleGroup: String
    var equipment: String
    var restSeconds: Int
    var sets: [AIGeneratedSet]
    var notes: String?
}

struct AIGeneratedRoutine: Codable {
    var name: String
    var dayLabel: String
    var description: String?
    var exercises: [AIGeneratedExercise]
}

struct AIProgramResponse: Codable {
    var programName: String
    var weeks: Int
    var summary: String
    var routines: [AIGeneratedRoutine]
}

struct Program: Codable, Identifiable {
    var id: String
    var name: String
    var weeks: Int
    var goal: String
    var iteration: Int
    var summary: String
    var createdAt: Int
}

struct PlanInfo: Codable, Identifiable {
    var id: String
    var name: String
    var price: Int
    var currency: String
    var interval: String
    var features: [String]
}

struct Subscription: Codable {
    var plan: Plan
    var status: SubscriptionStatus
    var currentPeriodEnd: String?
    var cancelAtPeriodEnd: Bool?
}

// MARK: - API Response Types

struct BootstrapData: Codable {
    var profile: UserProfile?
    var program: Program?
    var nutritionPlan: NutritionPlan?
    var routines: [Routine]
    var exercises: [Exercise]
    var workouts: [WorkoutSession]
}

struct ProgramResult: Codable {
    var program: Program
    var routines: [Routine]
    var nutritionPlan: NutritionPlan?
}

struct AccountInfo: Codable {
    var id: String
    var email: String
    var name: String
    var plan: Plan
    var status: String
    var currentPeriodEnd: String?
}

struct PlansResponse: Codable {
    var plans: [PlanInfo]
}

struct CheckoutResponse: Codable {
    var url: String
}

struct AiChatResponse: Codable {
    var type: String
    var text: String
    var suggestions: [String]?
    var profile: UserProfile?
}

struct AiCoachResponse: Codable {
    var type: String
    var text: String
    var suggestions: [String]?
    var program: Program?
    var routines: [Routine]?
    var workout: WorkoutSession?
}

struct MetResponse: Codable {
    var slug: String
    var met: Double
    var source: String
}

struct FoodLookupResponse: Codable {
    var result: FoodLookupResult?
}

// MARK: - App State Types

struct AppSettings: Codable, Equatable {
    var theme: String = "dark"
    var defaultRestSeconds: Int = 90
    var remindersEnabled: Bool = false
    var repSensitivity: String = "medium"
    var repSound: Bool = true
}

struct ManualSessionDraft: Codable {
    var routineName: String
    var startedAt: Int
    var durationSec: Int
    var exercises: [LoggedExercise]
    var notes: String?
}
