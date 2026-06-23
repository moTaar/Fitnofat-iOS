// ── Domain types ────────────────────────────────────────────────────────────
// All AI interactions are designed around these deterministic JSON shapes.

export type Goal = "strength" | "hypertrophy" | "weight_loss" | "endurance" | "general";
export type Equipment =
  | "full_gym"
  | "home_gym"
  | "dumbbells"
  | "bodyweight"
  | "resistance_bands"
  | "machines"
  | "kettlebells"
  | "mixed"
  | "other";
export type Experience = "beginner" | "intermediate" | "advanced";
export type WorkoutCategory = "calisthenics" | "weightlifting" | "cardio" | "yoga_pilates" | "mixed" | "other";
export type MuscleGroup =
  | "Chest"
  | "Back"
  | "Shoulders"
  | "Biceps"
  | "Triceps"
  | "Legs"
  | "Glutes"
  | "Core"
  | "Cardio"
  | "Full Body";

export interface UserProfile {
  name: string;
  goal: Goal;
  equipment: Equipment;
  equipmentMix?: string[]; // specific items when equipment === "mixed"
  experience: Experience;
  category: WorkoutCategory;
  daysPerWeek: number;
  sessionMinutes: number;
  bodyweightKg?: number;
  units: "kg" | "lb";
  notes?: string;
}

export interface Exercise {
  id: string;
  name: string;
  muscleGroup: MuscleGroup;
  equipment: string; // e.g. "Barbell", "Dumbbell", "Bodyweight"
  isCustom?: boolean;
  instructions?: string;
  guide?: ExerciseGuide; // AI-generated how-to, cached for exercises not in the seed library
}

// How-to guidance for performing an exercise with correct form.
export interface ExerciseGuide {
  primaryMuscles: string[];
  secondaryMuscles?: string[];
  steps: string[]; // ordered execution instructions
  cues: string[]; // form tips that improve quality / safety
  mistakes: string[]; // common errors to avoid
  breathing?: string;
}

// A planned set inside a routine (the prescription)
export interface PlannedSet {
  targetReps: number;
  targetWeight?: number; // optional; bodyweight moves may omit
  rpe?: number;
}

export interface RoutineExercise {
  exerciseId: string;
  name: string; // denormalized for offline resilience
  muscleGroup: MuscleGroup;
  sets: PlannedSet[];
  restSeconds: number;
  notes?: string;
}

export interface Routine {
  id: string;
  name: string; // "Push Day", "Legs A"
  description?: string;
  exercises: RoutineExercise[];
  source: "ai" | "manual";
  dayLabel?: string; // e.g. "Day 1" / "Mon"
  favorite?: boolean;
  createdAt: number;
}

export interface Program {
  id: string;
  name: string;
  weeks: number;
  goal: Goal;
  iteration: number; // bumped each AI refresh
  routineIds: string[];
  createdAt: number;
  summary?: string; // AI rationale for this iteration
}

// A logged set during/after a workout
export interface LoggedSet {
  weight: number;
  reps: number;
  completed: boolean;
}

export interface LoggedExercise {
  exerciseId: string;
  name: string;
  muscleGroup: MuscleGroup;
  restSeconds: number;
  sets: LoggedSet[];
}

export interface WorkoutSession {
  id: string;
  clientId?: string; // stable id used for idempotent offline → server sync
  routineId?: string;
  routineName: string;
  startedAt: number;
  endedAt?: number;
  durationSec: number;
  exercises: LoggedExercise[];
  totalVolume: number;
  notes?: string;
  synced: boolean; // for offline → server sync
}

// The active (in-progress) workout, persisted to localStorage so a refresh
// mid-set never loses data.
export interface ActiveWorkout {
  id: string;
  routineId?: string;
  routineName: string;
  startedAt: number;
  exercises: LoggedExercise[];
  restTimer: {
    active: boolean;
    endsAt: number | null;
    durationSec: number;
  };
}

// ── AI payload shapes ─────────────────────────────────────────────────────────

export interface AIGeneratedSet {
  reps: number;
  weight?: number;
  rpe?: number;
}

export interface AIGeneratedExercise {
  name: string;
  muscleGroup: MuscleGroup;
  equipment: string;
  restSeconds: number;
  sets: AIGeneratedSet[];
  notes?: string;
}

export interface AIGeneratedRoutine {
  name: string;
  dayLabel: string;
  description?: string;
  exercises: AIGeneratedExercise[];
}

export interface AIProgramResponse {
  programName: string;
  weeks: number;
  summary: string;
  routines: AIGeneratedRoutine[];
}
