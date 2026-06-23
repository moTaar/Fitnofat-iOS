// Shared domain + AI contract types (mirrors the frontend).

export type Goal = "strength" | "hypertrophy" | "weight_loss" | "endurance" | "general";
export type Equipment = "full_gym" | "dumbbells" | "bodyweight" | "home_gym";
export type Experience = "beginner" | "intermediate" | "advanced";
export type MuscleGroup =
  | "Chest" | "Back" | "Shoulders" | "Biceps" | "Triceps"
  | "Legs" | "Glutes" | "Core" | "Cardio" | "Full Body";

export interface UserProfile {
  name: string;
  goal: Goal;
  equipment: Equipment;
  experience: Experience;
  daysPerWeek: number;
  sessionMinutes: number;
  bodyweightKg?: number;
  units: "kg" | "lb";
  notes?: string;
}

export interface PlannedSet {
  targetReps: number;
  targetWeight?: number;
  rpe?: number;
}

export interface RoutineExercise {
  exerciseId: string;
  name: string;
  muscleGroup: MuscleGroup;
  sets: PlannedSet[];
  restSeconds: number;
  notes?: string;
}

export interface AIGeneratedSet { reps: number; weight?: number; rpe?: number }
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

export interface LoggedSet { weight: number; reps: number; completed: boolean }
export interface LoggedExercise {
  exerciseId: string;
  name: string;
  muscleGroup: MuscleGroup;
  restSeconds: number;
  sets: LoggedSet[];
}
