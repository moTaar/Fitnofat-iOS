import Foundation

// MARK: - Calorie Estimation

/// ACSM metabolic formula: kcal = MET × 3.5 × bodyweight(kg) / 200 × minutes

let KM_PER_MILE = 1.609344

/// MET values for common exercises when not explicitly provided.
/// Keywords are matched case-insensitively against exercise names.
let MET_KEYWORDS: [(pattern: String, met: Double)] = [
    ("deadlift", 6.0),
    ("squat", 6.0),
    ("clean and press", 6.0),
    ("bench press", 5.5),
    ("row", 5.5),
    ("barbell row", 5.5),
    ("dumbbell row", 5.0),
    ("pull-up", 5.0),
    ("pull up", 5.0),
    ("push-up", 5.0),
    ("push up", 5.0),
    ("dips", 5.0),
    ("dip", 5.0),
    ("lat pulldown", 5.0),
    ("overhead press", 5.0),
    ("lunge", 5.0),
    ("hip thrust", 5.0),
    ("bulgarian split squat", 5.0),
    ("curls", 3.5),
    ("curl", 3.5),
    ("triceps", 3.5),
    ("fly", 3.5),
    ("lateral raise", 3.5),
    ("front raise", 3.5),
    ("face pull", 3.5),
    ("leg curl", 3.5),
    ("leg extension", 3.5),
    ("calf raise", 3.5),
    ("plank", 3.0),
    ("cable", 3.5),
    ("running", 9.5),
    ("jump rope", 11.0),
    ("cycling", 7.5),
    ("rowing", 7.0),
    ("swimming", 8.0),
    ("burpees", 8.0),
    ("kettlebell swing", 8.0),
]

/// Calculate kcal burned for an exercise.
/// - Parameters:
///   - met: Metabolic equivalent of task (looked up externally or from cache)
///   - bodyweightKg: User's body weight in kilograms
///   - durationMinutes: Duration of the exercise in minutes
/// - Returns: Estimated calories burned
func kcalFromMet(met: Double, bodyweightKg: Double, durationMinutes: Double) -> Int {
    Int(round(met * 3.5 * bodyweightKg / 200.0 * durationMinutes))
}

/// Estimate exercise duration based on logged sets.
/// - Strength: assumes each rep takes ~3s, rest between sets included (~60s)
/// - Cardio: uses explicit durationSeconds from the first set
/// - Hold: uses explicit durationSeconds from the first set
/// - Fallback: 3s per rep * reps per set * sets + 60s rest per set
/// - Returns: Duration in minutes (minimum 1 minute)
func exerciseDurationMinutes(from exercise: LoggedExercise) -> Double {
    let kind = exercise.kind ?? .strength

    switch kind {
    case .cardio, .hold:
        // Use explicit duration from the first set that has one
        for set in exercise.sets {
            if let secs = set.durationSec, secs > 0 {
                return max(1.0, Double(secs) / 60.0)
            }
        }
        // If no duration, fall through to strength estimation

    case .strength:
        break
    }

    // Estimate from reps: ~3s per rep, plus ~60s rest between sets
    let totalReps = exercise.sets.reduce(0) { $0 + $1.reps }
    let setCount = max(exercise.sets.count, 1)
    let estimatedSecs = Double(totalReps) * 3.0 + Double(setCount - 1) * 60.0
    return max(1.0, estimatedSecs / 60.0)
}

/// Resolve MET for an exercise name.
/// Checks explicit MET first, then falls back to keyword matching.
/// - Parameter name: Exercise name
/// - Returns: MET value if found, nil for generic fallback
func resolveMetFromKeywords(name: String) -> Double? {
    let lower = name.lowercased()
    for (pattern, met) in MET_KEYWORDS {
        if lower.contains(pattern) {
            return met
        }
    }
    return nil
}

/// Calculate total calories for a logged exercise.
/// - Parameters:
///   - exercise: The logged exercise with sets
///   - bodyweightKg: User's body weight
/// - Returns: Estimated calories burned, or nil if unresolvable
func calculateExerciseCalories(exercise: LoggedExercise, bodyweightKg: Double) -> Int? {
    guard let met = exercise.met ?? resolveMetFromKeywords(name: exercise.name) else {
        return nil
    }
    let duration = exerciseDurationMinutes(from: exercise)
    return kcalFromMet(met: met, bodyweightKg: bodyweightKg, durationMinutes: duration)
}
