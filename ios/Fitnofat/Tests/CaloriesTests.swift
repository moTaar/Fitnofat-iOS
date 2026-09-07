import XCTest
@testable import Fitnofat

final class CaloriesTests: XCTestCase {

    // MARK: - kcalFromMet

    func testKcalFromMet() {
        // ACSM formula: kcal = MET × 3.5 × kg / 200 × minutes
        // MET 5, 70kg, 30 min → 5 × 3.5 × 70 / 200 × 30 = 183.75 → 184
        XCTAssertEqual(kcalFromMet(met: 5, bodyweightKg: 70, durationMinutes: 30), 184)

        // MET 8, 80kg, 45 min → 8 × 3.5 × 80 / 200 × 45 = 504
        XCTAssertEqual(kcalFromMet(met: 8, bodyweightKg: 80, durationMinutes: 45), 504)

        // Zero duration
        XCTAssertEqual(kcalFromMet(met: 5, bodyweightKg: 70, durationMinutes: 0), 0)

        // Zero bodyweight
        XCTAssertEqual(kcalFromMet(met: 5, bodyweightKg: 0, durationMinutes: 30), 0)
    }

    // MARK: - resolveMetFromKeywords

    func testResolveMetExactMatch() {
        XCTAssertEqual(resolveMetFromKeywords(name: "deadlift"), 6.0)
        XCTAssertEqual(resolveMetFromKeywords(name: "bench press"), 5.5)
        XCTAssertEqual(resolveMetFromKeywords(name: "jump rope"), 11.0)
    }

    func testResolveMetPartialMatch() {
        XCTAssertEqual(resolveMetFromKeywords(name: "Dumbbell Row"), 5.0)
        XCTAssertEqual(resolveMetFromKeywords(name: "Barbell Row"), 5.5)
    }

    func testResolveMetCaseInsensitive() {
        XCTAssertEqual(resolveMetFromKeywords(name: "DEADLIFT"), 6.0)
        XCTAssertEqual(resolveMetFromKeywords(name: "Squat"), 6.0)
    }

    func testResolveMetNoMatch() {
        XCTAssertNil(resolveMetFromKeywords(name: "unknown exercise"))
        XCTAssertNil(resolveMetFromKeywords(name: "weird movement pattern"))
    }

    // MARK: - exerciseDurationMinutes

    func testDurationStrengthEstimatesRepsAndRest() {
        let exercise = LoggedExercise(
            exerciseId: "1",
            name: "Squat",
            muscleGroup: "Legs",
            restSeconds: 90,
            kind: .strength,
            sets: [
                LoggedSet(weight: 100, reps: 10, completed: true),
                LoggedSet(weight: 100, reps: 8, completed: true),
            ]
        )
        // 18 reps * 3s = 54s, + 1 rest period of 60s = 114s / 60 = 1.9 → max(1, 1.9)
        let duration = exerciseDurationMinutes(from: exercise)
        XCTAssertGreaterThanOrEqual(duration, 1.0)
    }

    func testDurationCardioUsesExplicitDuration() {
        let exercise = LoggedExercise(
            exerciseId: "2",
            name: "Running",
            muscleGroup: "Cardio",
            restSeconds: 0,
            kind: .cardio,
            sets: [
                LoggedSet(completed: true, durationSec: 600), // 10 minutes
            ]
        )
        XCTAssertEqual(exerciseDurationMinutes(from: exercise), 10.0)
    }

    func testDurationHoldUsesExplicitDuration() {
        let exercise = LoggedExercise(
            exerciseId: "3",
            name: "Plank",
            muscleGroup: "Core",
            restSeconds: 30,
            kind: .hold,
            sets: [
                LoggedSet(completed: true, durationSec: 120), // 2 minutes
            ]
        )
        XCTAssertEqual(exerciseDurationMinutes(from: exercise), 2.0)
    }

    func testDurationFallbackWhenNoDurationOnCardio() {
        let exercise = LoggedExercise(
            exerciseId: "4",
            name: "Running",
            muscleGroup: "Cardio",
            restSeconds: 0,
            kind: .cardio,
            sets: [
                LoggedSet(completed: true), // no durationSec
            ]
        )
        // Falls through to strength estimation: 0 reps * 3s = 0, + 0 rest = 0 → min 1
        XCTAssertEqual(exerciseDurationMinutes(from: exercise), 1.0)
    }

    func testDurationMinimum() {
        let exercise = LoggedExercise(
            exerciseId: "5",
            name: "Curl",
            muscleGroup: "Biceps",
            restSeconds: 60,
            kind: .strength,
            sets: [
                LoggedSet(weight: 10, reps: 1, completed: true),
            ]
        )
        // 1 rep * 3s = 3s, + 0 rest = 3s / 60 = 0.05 → min 1
        XCTAssertEqual(exerciseDurationMinutes(from: exercise), 1.0)
    }

    // MARK: - calculateExerciseCalories

    func testCalculateWithExplicitMET() {
        let exercise = LoggedExercise(
            exerciseId: "1",
            name: "Squat",
            muscleGroup: "Legs",
            restSeconds: 90,
            kind: .strength,
            met: 6.0,
            sets: [
                LoggedSet(weight: 100, reps: 10, completed: true),
                LoggedSet(weight: 100, reps: 8, completed: true),
            ]
        )
        let cals = calculateExerciseCalories(exercise: exercise, bodyweightKg: 70)
        XCTAssertNotNil(cals)
        XCTAssertGreaterThan(cals!, 0)
    }

    func testCalculateWithKeywordMatch() {
        let exercise = LoggedExercise(
            exerciseId: "2",
            name: "Deadlift",
            muscleGroup: "Back",
            restSeconds: 120,
            kind: .strength,
            sets: [
                LoggedSet(weight: 140, reps: 5, completed: true),
            ]
        )
        let cals = calculateExerciseCalories(exercise: exercise, bodyweightKg: 80)
        XCTAssertNotNil(cals)
        XCTAssertGreaterThan(cals!, 0)
    }

    func testCalculateReturnsNilForUnresolvableMET() {
        let exercise = LoggedExercise(
            exerciseId: "3",
            name: "Weird Exercise That Does Not Exist",
            muscleGroup: "Other",
            restSeconds: 60,
            kind: .strength,
            sets: [
                LoggedSet(weight: 50, reps: 10, completed: true),
            ]
        )
        XCTAssertNil(calculateExerciseCalories(exercise: exercise, bodyweightKg: 70))
    }
}
