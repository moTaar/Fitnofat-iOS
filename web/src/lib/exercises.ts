import type { Exercise, MuscleGroup } from "./types";

// Pre-populated common exercises. IDs are stable slugs so AI-generated
// routines can map names → library entries deterministically.
const raw: Omit<Exercise, "id">[] = [
  // Chest
  { name: "Barbell Bench Press", muscleGroup: "Chest", equipment: "Barbell" },
  { name: "Incline Dumbbell Press", muscleGroup: "Chest", equipment: "Dumbbell" },
  { name: "Dumbbell Bench Press", muscleGroup: "Chest", equipment: "Dumbbell" },
  { name: "Push-up", muscleGroup: "Chest", equipment: "Bodyweight" },
  { name: "Cable Chest Fly", muscleGroup: "Chest", equipment: "Cable" },
  { name: "Dip", muscleGroup: "Chest", equipment: "Bodyweight" },
  // Back
  { name: "Pull-up", muscleGroup: "Back", equipment: "Bodyweight" },
  { name: "Chin-up", muscleGroup: "Back", equipment: "Bodyweight" },
  { name: "Barbell Row", muscleGroup: "Back", equipment: "Barbell" },
  { name: "Lat Pulldown", muscleGroup: "Back", equipment: "Cable" },
  { name: "Seated Cable Row", muscleGroup: "Back", equipment: "Cable" },
  { name: "Single-Arm Dumbbell Row", muscleGroup: "Back", equipment: "Dumbbell" },
  { name: "Deadlift", muscleGroup: "Back", equipment: "Barbell" },
  // Shoulders
  { name: "Overhead Press", muscleGroup: "Shoulders", equipment: "Barbell" },
  { name: "Dumbbell Shoulder Press", muscleGroup: "Shoulders", equipment: "Dumbbell" },
  { name: "Lateral Raise", muscleGroup: "Shoulders", equipment: "Dumbbell" },
  { name: "Face Pull", muscleGroup: "Shoulders", equipment: "Cable" },
  { name: "Rear Delt Fly", muscleGroup: "Shoulders", equipment: "Dumbbell" },
  // Biceps
  { name: "Barbell Curl", muscleGroup: "Biceps", equipment: "Barbell" },
  { name: "Dumbbell Curl", muscleGroup: "Biceps", equipment: "Dumbbell" },
  { name: "Hammer Curl", muscleGroup: "Biceps", equipment: "Dumbbell" },
  { name: "Cable Curl", muscleGroup: "Biceps", equipment: "Cable" },
  // Triceps
  { name: "Tricep Pushdown", muscleGroup: "Triceps", equipment: "Cable" },
  { name: "Overhead Tricep Extension", muscleGroup: "Triceps", equipment: "Dumbbell" },
  { name: "Close-Grip Bench Press", muscleGroup: "Triceps", equipment: "Barbell" },
  { name: "Skull Crusher", muscleGroup: "Triceps", equipment: "Barbell" },
  // Legs
  { name: "Barbell Back Squat", muscleGroup: "Legs", equipment: "Barbell" },
  { name: "Front Squat", muscleGroup: "Legs", equipment: "Barbell" },
  { name: "Leg Press", muscleGroup: "Legs", equipment: "Machine" },
  { name: "Romanian Deadlift", muscleGroup: "Legs", equipment: "Barbell" },
  { name: "Walking Lunge", muscleGroup: "Legs", equipment: "Dumbbell" },
  { name: "Leg Extension", muscleGroup: "Legs", equipment: "Machine" },
  { name: "Leg Curl", muscleGroup: "Legs", equipment: "Machine" },
  { name: "Bulgarian Split Squat", muscleGroup: "Legs", equipment: "Dumbbell" },
  { name: "Calf Raise", muscleGroup: "Legs", equipment: "Machine" },
  { name: "Goblet Squat", muscleGroup: "Legs", equipment: "Dumbbell" },
  // Glutes
  { name: "Hip Thrust", muscleGroup: "Glutes", equipment: "Barbell" },
  { name: "Glute Bridge", muscleGroup: "Glutes", equipment: "Bodyweight" },
  { name: "Cable Kickback", muscleGroup: "Glutes", equipment: "Cable" },
  // Core
  { name: "Plank", muscleGroup: "Core", equipment: "Bodyweight" },
  { name: "Hanging Leg Raise", muscleGroup: "Core", equipment: "Bodyweight" },
  { name: "Cable Crunch", muscleGroup: "Core", equipment: "Cable" },
  { name: "Russian Twist", muscleGroup: "Core", equipment: "Bodyweight" },
  { name: "Ab Wheel Rollout", muscleGroup: "Core", equipment: "Bodyweight" },
  // Cardio
  { name: "Treadmill Run", muscleGroup: "Cardio", equipment: "Machine" },
  { name: "Rowing Machine", muscleGroup: "Cardio", equipment: "Machine" },
  { name: "Jump Rope", muscleGroup: "Cardio", equipment: "Bodyweight" },
  { name: "Burpee", muscleGroup: "Full Body", equipment: "Bodyweight" },
  { name: "Kettlebell Swing", muscleGroup: "Full Body", equipment: "Kettlebell" },
  // 5 Tibetans
  { name: "Tibetan Rite 1 - Spinning", muscleGroup: "Full Body", equipment: "Bodyweight" },
  { name: "Tibetan Rite 2 - Leg Raise", muscleGroup: "Core", equipment: "Bodyweight" },
  { name: "Tibetan Rite 3 - Kneeling Backbend", muscleGroup: "Full Body", equipment: "Bodyweight" },
  { name: "Tibetan Rite 4 - Table Pose", muscleGroup: "Full Body", equipment: "Bodyweight" },
  { name: "Tibetan Rite 5 - Up-Down Dog", muscleGroup: "Full Body", equipment: "Bodyweight" },
];

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const SEED_EXERCISES: Exercise[] = raw.map((e) => ({
  ...e,
  id: slugify(e.name),
}));

export const MUSCLE_GROUPS: MuscleGroup[] = [
  "Chest",
  "Back",
  "Shoulders",
  "Biceps",
  "Triceps",
  "Legs",
  "Glutes",
  "Core",
  "Cardio",
  "Full Body",
];

/** Find a library exercise by (fuzzy) name, used to resolve AI output. */
export function matchExercise(
  name: string,
  library: Exercise[]
): Exercise | undefined {
  const slug = slugify(name);
  return (
    library.find((e) => e.id === slug) ||
    library.find((e) => slugify(e.name) === slug) ||
    library.find((e) => e.name.toLowerCase() === name.toLowerCase())
  );
}
