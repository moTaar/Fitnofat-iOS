import XCTest
@testable import Fitnofat

final class ModelCodableTests: XCTestCase {

    // MARK: - Enum encoding

    func testGoalRawValues() {
        XCTAssertEqual(Goal.strength.rawValue, "strength")
        XCTAssertEqual(Goal.hypertrophy.rawValue, "hypertrophy")
        XCTAssertEqual(Goal.weightLoss.rawValue, "weight_loss")
        XCTAssertEqual(Goal.endurance.rawValue, "endurance")
        XCTAssertEqual(Goal.general.rawValue, "general")
    }

    func testEquipmentRawValues() {
        XCTAssertEqual(Equipment.fullGym.rawValue, "full_gym")
        XCTAssertEqual(Equipment.bodyweight.rawValue, "bodyweight")
        XCTAssertEqual(Equipment.dumbbells.rawValue, "dumbbells")
    }

    func testExerciseKindRawValues() {
        XCTAssertEqual(ExerciseKind.strength.rawValue, "strength")
        XCTAssertEqual(ExerciseKind.cardio.rawValue, "cardio")
        XCTAssertEqual(ExerciseKind.hold.rawValue, "hold")
    }

    func testPlanRawValues() {
        XCTAssertEqual(Plan.free.rawValue, "free")
        XCTAssertEqual(Plan.pro.rawValue, "pro")
    }

    func testSubscriptionStatusRawValues() {
        XCTAssertEqual(SubscriptionStatus.active.rawValue, "active")
        XCTAssertEqual(SubscriptionStatus.pastDue.rawValue, "past_due")
    }

    // MARK: - Codable round trips

    func testUserProfileRoundTrip() throws {
        let profile = UserProfile(
            name: "Test User",
            goal: .strength,
            equipment: .fullGym,
            experience: .intermediate,
            bodyweightKg: 75.5,
            units: "kg",
            onboarded: true
        )
        let data = try JSONEncoder().encode(profile)
        let decoded = try JSONDecoder().decode(UserProfile.self, from: data)
        XCTAssertEqual(decoded.name, "Test User")
        XCTAssertEqual(decoded.goal, .strength)
        XCTAssertEqual(decoded.equipment, .fullGym)
        XCTAssertEqual(decoded.experience, .intermediate)
        XCTAssertEqual(decoded.bodyweightKg, 75.5)
        XCTAssertEqual(decoded.units, "kg")
        XCTAssertTrue(decoded.onboarded)
    }

    func testExerciseRoundTrip() throws {
        let exercise = Exercise(
            id: "ex1",
            name: "Bench Press",
            muscleGroup: "Chest",
            equipment: "barbell",
            met: 5.5,
            guide: ExerciseGuide(
                steps: ["Lie down", "Press up"],
                cues: ["Elbows tucked"],
                mistakes: ["Bouncing"],
                breathing: "Exhale on exertion"
            ),
            source: "seed"
        )
        let data = try JSONEncoder().encode(exercise)
        let decoded = try JSONDecoder().decode(Exercise.self, from: data)
        XCTAssertEqual(decoded.id, "ex1")
        XCTAssertEqual(decoded.name, "Bench Press")
        XCTAssertEqual(decoded.muscleGroup, "Chest")
        XCTAssertEqual(decoded.met, 5.5)
        XCTAssertEqual(decoded.guide?.steps.count, 2)
        XCTAssertEqual(decoded.guide?.breathing, "Exhale on exertion")
    }

    func testExerciseEqualityById() {
        let e1 = Exercise(id: "ex1", name: "Bench Press", muscleGroup: "Chest", equipment: "barbell")
        let e2 = Exercise(id: "ex1", name: "Different Name", muscleGroup: "Back", equipment: "dumbbell")
        // Equal because same ID
        XCTAssertEqual(e1, e2)
    }

    func testWorkoutSessionRoundTrip() throws {
        let session = WorkoutSession(
            id: "ws1",
            clientId: "c1",
            routineId: "r1",
            routineName: "Push Day",
            startedAt: 1736942400,
            endedAt: 1736946000,
            durationSec: 3600,
            totalVolume: 5000,
            calories: 350,
            notes: "Good session",
            exercises: [
                LoggedExercise(
                    exerciseId: "e1",
                    name: "Bench Press",
                    muscleGroup: "Chest",
                    restSeconds: 90,
                    kind: .strength,
                    sets: [
                        LoggedSet(weight: 80, reps: 10, completed: true),
                        LoggedSet(weight: 80, reps: 8, completed: true),
                    ]
                )
            ],
            synced: true
        )
        let data = try JSONEncoder().encode(session)
        let decoded = try JSONDecoder().decode(WorkoutSession.self, from: data)
        XCTAssertEqual(decoded.id, "ws1")
        XCTAssertEqual(decoded.routineName, "Push Day")
        XCTAssertEqual(decoded.durationSec, 3600)
        XCTAssertEqual(decoded.totalVolume, 5000)
        XCTAssertEqual(decoded.exercises.count, 1)
        XCTAssertEqual(decoded.exercises[0].sets.count, 2)
        XCTAssertEqual(decoded.exercises[0].sets[0].weight, 80)
        XCTAssertEqual(decoded.exercises[0].sets[0].reps, 10)
    }

    func testLoggedSetRoundTrip() throws {
        let set = LoggedSet(weight: 100, reps: 5, completed: true, rpe: 8.5)
        let data = try JSONEncoder().encode(set)
        let decoded = try JSONDecoder().decode(LoggedSet.self, from: data)
        XCTAssertEqual(decoded.weight, 100)
        XCTAssertEqual(decoded.reps, 5)
        XCTAssertTrue(decoded.completed)
        XCTAssertEqual(decoded.rpe, 8.5)
    }

    func testLoggedSetWithDuration() throws {
        let set = LoggedSet(completed: true, durationSec: 300)
        let data = try JSONEncoder().encode(set)
        let decoded = try JSONDecoder().decode(LoggedSet.self, from: data)
        XCTAssertEqual(decoded.durationSec, 300)
    }

    func testActiveWorkoutRoundTrip() throws {
        let workout = ActiveWorkout(
            routineName: "Leg Day",
            startedAt: 1736942400,
            exercises: [
                LoggedExercise(
                    exerciseId: "e1",
                    name: "Squat",
                    muscleGroup: "Legs",
                    restSeconds: 120,
                    kind: .strength,
                    sets: [
                        LoggedSet(weight: 100, reps: 10, completed: false),
                    ]
                )
            ],
            restTimer: RestTimerState(endsAt: 1736942700, duration: 120)
        )
        let data = try JSONEncoder().encode(workout)
        let decoded = try JSONDecoder().decode(ActiveWorkout.self, from: data)
        XCTAssertEqual(decoded.routineName, "Leg Day")
        XCTAssertEqual(decoded.exercises.count, 1)
        XCTAssertNotNil(decoded.restTimer)
        XCTAssertEqual(decoded.restTimer?.duration, 120)
    }

    func testNutritionPlanRoundTrip() throws {
        let plan = NutritionPlan(
            id: "np1",
            iteration: 1,
            createdAt: 1736942400,
            strategy: "balanced",
            summary: "A balanced nutrition plan",
            trainingDay: DayPlan(
                targets: MacroTargets(calories: 2500, protein: 180, carbs: 250, fats: 70),
                meals: [
                    Meal(name: "Breakfast", slot: "breakfast", timing: "8:00",
                         macros: MacroTargets(calories: 500, protein: 30, carbs: 50, fats: 15),
                         items: [], note: nil)
                ],
                hydrationLiters: 3.0
            ),
            restDay: DayPlan(
                targets: MacroTargets(calories: 2200, protein: 160, carbs: 200, fats: 60),
                meals: [],
                hydrationLiters: 2.5
            )
        )
        let data = try JSONEncoder().encode(plan)
        let decoded = try JSONDecoder().decode(NutritionPlan.self, from: data)
        XCTAssertEqual(decoded.id, "np1")
        XCTAssertEqual(decoded.trainingDay.targets.calories, 2500)
        XCTAssertEqual(decoded.trainingDay.meals.count, 1)
        XCTAssertEqual(decoded.restDay.hydrationLiters, 2.5)
    }

    func testBootstrapDataRoundTrip() throws {
        let bootstrap = BootstrapData(
            profile: UserProfile(name: "Test", goal: .general, equipment: .bodyweight, experience: .beginner, onboarded: true),
            routines: [],
            exercises: [
                Exercise(id: "ex1", name: "Push Up", muscleGroup: "Chest", equipment: "bodyweight")
            ],
            workouts: []
        )
        let data = try JSONEncoder().encode(bootstrap)
        let decoded = try JSONDecoder().decode(BootstrapData.self, from: data)
        XCTAssertEqual(decoded.profile?.name, "Test")
        XCTAssertEqual(decoded.exercises.count, 1)
        XCTAssertEqual(decoded.exercises[0].name, "Push Up")
    }

    func testAppSettingsRoundTrip() throws {
        var settings = AppSettings()
        settings.theme = "light"
        settings.defaultRestSeconds = 60
        settings.remindersEnabled = true
        settings.repSensitivity = "high"

        let data = try JSONEncoder().encode(settings)
        let decoded = try JSONDecoder().decode(AppSettings.self, from: data)
        XCTAssertEqual(decoded.theme, "light")
        XCTAssertEqual(decoded.defaultRestSeconds, 60)
        XCTAssertTrue(decoded.remindersEnabled)
        XCTAssertEqual(decoded.repSensitivity, "high")
    }

    func testRoutineRoundTrip() throws {
        let routine = Routine(
            id: "r1",
            name: "Push Day",
            description: "Chest and triceps",
            dayLabel: "Day 1",
            favorite: true,
            source: .ai,
            exercises: [
                RoutineExercise(
                    exerciseId: "e1",
                    name: "Bench Press",
                    muscleGroup: "Chest",
                    sets: [PlannedSet(targetReps: 10, targetWeight: 80, rpe: 8)],
                    restSeconds: 90
                )
            ],
            createdAt: 1736942400
        )
        let data = try JSONEncoder().encode(routine)
        let decoded = try JSONDecoder().decode(Routine.self, from: data)
        XCTAssertEqual(decoded.id, "r1")
        XCTAssertEqual(decoded.name, "Push Day")
        XCTAssertTrue(decoded.favorite)
        XCTAssertEqual(decoded.exercises.count, 1)
        XCTAssertEqual(decoded.exercises[0].sets[0].targetReps, 10)
    }

    func testProgramRoundTrip() throws {
        let program = Program(
            id: "p1", name: "Beginner Strength", weeks: 8,
            goal: "strength", iteration: 1,
            summary: "An 8-week beginner program",
            createdAt: 1736942400
        )
        let data = try JSONEncoder().encode(program)
        let decoded = try JSONDecoder().decode(Program.self, from: data)
        XCTAssertEqual(decoded.name, "Beginner Strength")
        XCTAssertEqual(decoded.weeks, 8)
    }

    func testSubscriptionRoundTrip() throws {
        let sub = Subscription(plan: .pro, status: .active, currentPeriodEnd: "2025-02-15", cancelAtPeriodEnd: false)
        let data = try JSONEncoder().encode(sub)
        let decoded = try JSONDecoder().decode(Subscription.self, from: data)
        XCTAssertEqual(decoded.plan, .pro)
        XCTAssertEqual(decoded.status, .active)
        XCTAssertEqual(decoded.currentPeriodEnd, "2025-02-15")
        XCTAssertEqual(decoded.cancelAtPeriodEnd, false)
    }
}
