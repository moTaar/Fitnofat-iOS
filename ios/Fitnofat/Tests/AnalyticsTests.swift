import XCTest
@testable import Fitnofat

final class AnalyticsTests: XCTestCase {

    // MARK: - currentStreak

    func testStreakEmpty() {
        XCTAssertEqual(currentStreak(workoutDates: []), 0)
    }

    func testStreakTodayOnly() {
        let today = Date()
        XCTAssertEqual(currentStreak(workoutDates: [today]), 0)
    }

    func testStreakSingleConsecutiveDay() {
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: Date())!
        XCTAssertEqual(currentStreak(workoutDates: [yesterday]), 1)
    }

    func testStreakThreeConsecutiveDays() {
        let cal = Calendar.current
        let today = cal.startOfDay(for: Date())
        let d1 = cal.date(byAdding: .day, value: -1, to: today)!
        let d2 = cal.date(byAdding: .day, value: -2, to: today)!
        let d3 = cal.date(byAdding: .day, value: -3, to: today)!
        XCTAssertEqual(currentStreak(workoutDates: [d1, d2, d3]), 3)
    }

    func testStreakGapBreaksStreak() {
        let cal = Calendar.current
        let today = cal.startOfDay(for: Date())
        let yesterday = cal.date(byAdding: .day, value: -1, to: today)!
        let threeDaysAgo = cal.date(byAdding: .day, value: -3, to: today)!
        // Gap: yesterday and 3 days ago → streak is 1 (only yesterday)
        XCTAssertEqual(currentStreak(workoutDates: [yesterday, threeDaysAgo]), 1)
    }

    func testStreakUnsortedInput() {
        let cal = Calendar.current
        let today = cal.startOfDay(for: Date())
        let yesterday = cal.date(byAdding: .day, value: -1, to: today)!
        let twoDaysAgo = cal.date(byAdding: .day, value: -2, to: today)!
        // Unsorted — function sorts internally
        XCTAssertEqual(currentStreak(workoutDates: [twoDaysAgo, yesterday]), 2)
    }

    // MARK: - estimateOneRM

    func testEstimateOneRMZeroWeight() {
        XCTAssertEqual(estimateOneRM(weight: 0, reps: 10), 0)
    }

    func testEstimateOneRMZeroReps() {
        XCTAssertEqual(estimateOneRM(weight: 100, reps: 0), 0)
    }

    func testEstimateOneRMSingleRep() {
        XCTAssertEqual(estimateOneRM(weight: 100, reps: 1), 100)
    }

    func testEstimateOneRMStandard() {
        // 100 kg × (1 + 10 / 30) = 100 × 1.333... = 133.33 → 133.5
        XCTAssertEqual(estimateOneRM(weight: 100, reps: 10), 133.5)
        // 80 kg × (1 + 5 / 30) = 80 × 1.1667 = 93.33 → 93.5
        XCTAssertEqual(estimateOneRM(weight: 80, reps: 5), 93.5)
    }

    func testEstimateOneRMRounding() {
        // 60 kg × (1 + 15 / 30) = 60 × 1.5 = 90.0
        XCTAssertEqual(estimateOneRM(weight: 60, reps: 15), 90.0)
    }

    // MARK: - personalRecords

    func testPersonalRecordsEmpty() {
        XCTAssertTrue(personalRecords(from: []).isEmpty)
    }

    func testPersonalRecordsSingleSession() {
        let session = WorkoutSession(
            id: "1", clientId: "c1", routineName: "Leg Day",
            startedAt: 1736942400, durationSec: 3600, totalVolume: 0,
            exercises: [
                LoggedExercise(
                    exerciseId: "e1", name: "Squat", muscleGroup: "Legs",
                    restSeconds: 90, kind: .strength,
                    sets: [
                        LoggedSet(weight: 100, reps: 10, completed: true),
                        LoggedSet(weight: 120, reps: 5, completed: true),
                    ]
                )
            ]
        )
        let records = personalRecords(from: [session])
        XCTAssertEqual(records.count, 1)
        // 120 × (1 + 5/30) = 140.0 > 100 × (1 + 10/30) = 133.5 → best = 140.0
        XCTAssertEqual(records["Squat"]?.estimatedOneRM, 140.0)
    }

    func testPersonalRecordsPicksBestAcrossSessions() {
        let session1 = WorkoutSession(
            id: "1", clientId: "c1", routineName: "Leg Day",
            startedAt: 1736942400, durationSec: 3600, totalVolume: 0,
            exercises: [
                LoggedExercise(
                    exerciseId: "e1", name: "Squat", muscleGroup: "Legs",
                    restSeconds: 90, kind: .strength,
                    sets: [LoggedSet(weight: 100, reps: 10, completed: true)]
                )
            ]
        )
        let session2 = WorkoutSession(
            id: "2", clientId: "c1", routineName: "Leg Day",
            startedAt: 1737028800, durationSec: 3600, totalVolume: 0,
            exercises: [
                LoggedExercise(
                    exerciseId: "e1", name: "Squat", muscleGroup: "Legs",
                    restSeconds: 90, kind: .strength,
                    sets: [LoggedSet(weight: 130, reps: 3, completed: true)]
                )
            ]
        )
        let records = personalRecords(from: [session1, session2])
        XCTAssertEqual(records.count, 1)
        // 100 × (1 + 10/30) = 133.5, 130 × (1 + 3/30) = 143.0 → best = 143.0
        XCTAssertEqual(records["Squat"]?.estimatedOneRM, 143.0)
    }

    func testPersonalRecordsFiltersZeroWeight() {
        let session = WorkoutSession(
            id: "1", clientId: "c1", routineName: "Leg Day",
            startedAt: 1736942400, durationSec: 3600, totalVolume: 0,
            exercises: [
                LoggedExercise(
                    exerciseId: "e1", name: "Squat", muscleGroup: "Legs",
                    restSeconds: 90, kind: .strength,
                    sets: [LoggedSet(weight: 0, reps: 10, completed: true)]
                )
            ]
        )
        XCTAssertTrue(personalRecords(from: [session]).isEmpty)
    }

    // MARK: - weeklyVolumes

    func testWeeklyVolumesEmpty() {
        let volumes = weeklyVolumes(from: [], weeks: 4)
        XCTAssertEqual(volumes.count, 4)
        for week in volumes {
            XCTAssertEqual(week.totalVolume, 0)
            XCTAssertEqual(week.sessionCount, 0)
        }
    }

    func testWeeklyVolumesReturnsCorrectCount() {
        let volumes = weeklyVolumes(from: [], weeks: 8)
        XCTAssertEqual(volumes.count, 8)
    }

    // MARK: - exerciseTrends

    func testExerciseTrendsInsufficientData() {
        let session = WorkoutSession(
            id: "1", clientId: "c1", routineName: "Push",
            startedAt: 1736942400, durationSec: 3600, totalVolume: 0,
            exercises: []
        )
        // Single session is less than 2 → empty
        XCTAssertTrue(exerciseTrends(from: [session]).isEmpty)
    }

    func testExerciseTrendsNoCommonExercises() {
        let now = Date().timeIntervalSince1970
        let session1 = WorkoutSession(
            id: "1", clientId: "c1", routineName: "Push",
            startedAt: now - 10 * 86400, durationSec: 3600, totalVolume: 0,
            exercises: [
                LoggedExercise(
                    exerciseId: "e1", name: "Bench Press", muscleGroup: "Chest",
                    restSeconds: 90, kind: .strength,
                    sets: [LoggedSet(weight: 80, reps: 10, completed: true)]
                )
            ]
        )
        let session2 = WorkoutSession(
            id: "2", clientId: "c1", routineName: "Legs",
            startedAt: now, durationSec: 3600, totalVolume: 0,
            exercises: [
                LoggedExercise(
                    exerciseId: "e2", name: "Squat", muscleGroup: "Legs",
                    restSeconds: 90, kind: .strength,
                    sets: [LoggedSet(weight: 100, reps: 8, completed: true)]
                )
            ]
        )
        let trends = exerciseTrends(from: [session1, session2])
        // No common exercise name across both periods → empty
        XCTAssertTrue(trends.isEmpty)
    }
}
