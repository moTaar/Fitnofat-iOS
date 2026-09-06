import Foundation

// Seed exercise library with 53 pre-populated exercises across 10 muscle groups.
// Each exercise's ID is a deterministic slug of its name so AI-generated routines
// can map names to library entries without server round-trips.

private func slugify(_ name: String) -> String {
    name.lowercased()
        .replacingOccurrences(of: "[^a-z0-9]+", with: "_", options: .regularExpression)
        .trimmingCharacters(in: CharacterSet(charactersIn: "_"))
}

struct SeedExercise: Codable {
    let id: String
    let name: String
    let muscleGroup: String
    let equipment: String
    let met: Double?
    let guide: ExerciseGuide?

    init(name: String, muscleGroup: String, equipment: String, met: Double? = nil, guide: ExerciseGuide? = nil) {
        self.id = slugify(name)
        self.name = name
        self.muscleGroup = muscleGroup
        self.equipment = equipment
        self.met = met
        self.guide = guide
    }
}

struct SeedExercises {
    static let all: [SeedExercise] = [
        // ── Chest ──
        SeedExercise(name: "Bench Press", muscleGroup: "Chest", equipment: "Barbell", met: 5.5),
        SeedExercise(name: "Incline Bench Press", muscleGroup: "Chest", equipment: "Barbell", met: 5.5),
        SeedExercise(name: "Decline Bench Press", muscleGroup: "Chest", equipment: "Barbell", met: 5.5),
        SeedExercise(name: "Dumbbell Bench Press", muscleGroup: "Chest", equipment: "Dumbbell", met: 5.5),
        SeedExercise(name: "Incline Dumbbell Press", muscleGroup: "Chest", equipment: "Dumbbell", met: 5.5),
        SeedExercise(name: "Chest Fly", muscleGroup: "Chest", equipment: "Cable", met: 3.5),
        SeedExercise(name: "Push-Up", muscleGroup: "Chest", equipment: "Bodyweight", met: 5.0),
        SeedExercise(name: "Dips", muscleGroup: "Chest", equipment: "Bodyweight", met: 5.0),

        // ── Back ──
        SeedExercise(name: "Pull-Up", muscleGroup: "Back", equipment: "Bodyweight", met: 5.0),
        SeedExercise(name: "Lat Pulldown", muscleGroup: "Back", equipment: "Cable", met: 5.0),
        SeedExercise(name: "Barbell Row", muscleGroup: "Back", equipment: "Barbell", met: 5.5),
        SeedExercise(name: "Dumbbell Row", muscleGroup: "Back", equipment: "Dumbbell", met: 5.0),
        SeedExercise(name: "Deadlift", muscleGroup: "Back", equipment: "Barbell", met: 6.0),
        SeedExercise(name: "Seated Cable Row", muscleGroup: "Back", equipment: "Cable", met: 5.0),
        SeedExercise(name: "Face Pull", muscleGroup: "Back", equipment: "Cable", met: 3.5),

        // ── Shoulders ──
        SeedExercise(name: "Overhead Press", muscleGroup: "Shoulders", equipment: "Barbell", met: 5.0),
        SeedExercise(name: "Dumbbell Shoulder Press", muscleGroup: "Shoulders", equipment: "Dumbbell", met: 5.0),
        SeedExercise(name: "Lateral Raise", muscleGroup: "Shoulders", equipment: "Dumbbell", met: 3.5),
        SeedExercise(name: "Front Raise", muscleGroup: "Shoulders", equipment: "Dumbbell", met: 3.5),

        // ── Biceps ──
        SeedExercise(name: "Barbell Curl", muscleGroup: "Biceps", equipment: "Barbell", met: 3.5),
        SeedExercise(name: "Dumbbell Curl", muscleGroup: "Biceps", equipment: "Dumbbell", met: 3.5),
        SeedExercise(name: "Hammer Curl", muscleGroup: "Biceps", equipment: "Dumbbell", met: 3.5),
        SeedExercise(name: "Preacher Curl", muscleGroup: "Biceps", equipment: "Barbell", met: 3.5),

        // ── Triceps ──
        SeedExercise(name: "Triceps Pushdown", muscleGroup: "Triceps", equipment: "Cable", met: 3.5),
        SeedExercise(name: "Overhead Triceps Extension", muscleGroup: "Triceps", equipment: "Dumbbell", met: 3.5),
        SeedExercise(name: "Close-Grip Bench Press", muscleGroup: "Triceps", equipment: "Barbell", met: 5.0),
        SeedExercise(name: "Skull Crusher", muscleGroup: "Triceps", equipment: "Barbell", met: 3.5),

        // ── Legs ──
        SeedExercise(name: "Squat", muscleGroup: "Legs", equipment: "Barbell", met: 6.0),
        SeedExercise(name: "Front Squat", muscleGroup: "Legs", equipment: "Barbell", met: 6.0),
        SeedExercise(name: "Goblet Squat", muscleGroup: "Legs", equipment: "Dumbbell", met: 5.0),
        SeedExercise(name: "Leg Press", muscleGroup: "Legs", equipment: "Machine", met: 5.0),
        SeedExercise(name: "Lunges", muscleGroup: "Legs", equipment: "Dumbbell", met: 5.0),
        SeedExercise(name: "Romanian Deadlift", muscleGroup: "Legs", equipment: "Barbell", met: 5.5),
        SeedExercise(name: "Leg Curl", muscleGroup: "Legs", equipment: "Machine", met: 3.5),
        SeedExercise(name: "Leg Extension", muscleGroup: "Legs", equipment: "Machine", met: 3.5),
        SeedExercise(name: "Calf Raise", muscleGroup: "Legs", equipment: "Machine", met: 3.5),

        // ── Glutes ──
        SeedExercise(name: "Hip Thrust", muscleGroup: "Glutes", equipment: "Barbell", met: 5.0),
        SeedExercise(name: "Glute Bridge", muscleGroup: "Glutes", equipment: "Bodyweight", met: 3.5),
        SeedExercise(name: "Bulgarian Split Squat", muscleGroup: "Glutes", equipment: "Dumbbell", met: 5.0),

        // ── Core ──
        SeedExercise(name: "Plank", muscleGroup: "Core", equipment: "Bodyweight", met: 3.0),
        SeedExercise(name: "Crunches", muscleGroup: "Core", equipment: "Bodyweight", met: 3.5),
        SeedExercise(name: "Hanging Leg Raise", muscleGroup: "Core", equipment: "Bodyweight", met: 3.5),
        SeedExercise(name: "Russian Twist", muscleGroup: "Core", equipment: "Bodyweight", met: 3.5),
        SeedExercise(name: "Cable Crunch", muscleGroup: "Core", equipment: "Cable", met: 3.5),

        // ── Cardio ──
        SeedExercise(name: "Running", muscleGroup: "Cardio", equipment: "Bodyweight", met: 9.5),
        SeedExercise(name: "Cycling", muscleGroup: "Cardio", equipment: "Machine", met: 7.5),
        SeedExercise(name: "Rowing Machine", muscleGroup: "Cardio", equipment: "Machine", met: 7.0),
        SeedExercise(name: "Jump Rope", muscleGroup: "Cardio", equipment: "Bodyweight", met: 11.0),
        SeedExercise(name: "Swimming", muscleGroup: "Cardio", equipment: "Bodyweight", met: 8.0),

        // ── Full Body ──
        SeedExercise(name: "Burpees", muscleGroup: "Full Body", equipment: "Bodyweight", met: 8.0),
        SeedExercise(name: "Kettlebell Swing", muscleGroup: "Full Body", equipment: "Kettlebell", met: 8.0),
        SeedExercise(name: "Clean and Press", muscleGroup: "Full Body", equipment: "Barbell", met: 6.0),

        // ── Tibetan Rites ──
        SeedExercise(name: "First Rite - Spinning", muscleGroup: "Full Body", equipment: "Bodyweight"),
        SeedExercise(name: "Second Rite - Leg Lifts", muscleGroup: "Core", equipment: "Bodyweight"),
        SeedExercise(name: "Third Rite - Camel", muscleGroup: "Core", equipment: "Bodyweight"),
        SeedExercise(name: "Fourth Rite - Tabletop", muscleGroup: "Full Body", equipment: "Bodyweight"),
        SeedExercise(name: "Fifth Rite - Downward Dog", muscleGroup: "Full Body", equipment: "Bodyweight"),
    ]

    static let muscleGroups: [String] = [
        "Chest", "Back", "Shoulders", "Biceps", "Triceps",
        "Legs", "Glutes", "Core", "Cardio", "Full Body"
    ]
}
