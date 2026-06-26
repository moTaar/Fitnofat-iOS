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
// Smart Rep Counter motion sensitivity. Higher → detects subtler movements.
export type RepSensitivity = "low" | "medium" | "high";
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

// ── Nutrition planner ───────────────────────────────────────────────────────
export type ActivityLevel = "sedentary" | "light" | "moderate" | "very_active";
export type DietGoal = "lean_gain" | "recomp" | "maintain" | "deficit" | "aggressive_deficit";
export type Sex = "male" | "female" | "other";

// Culinary style for daily meal suggestions. "standard" = no cultural styling.
export type Cuisine =
  | "standard" | "french" | "italian" | "korean"
  | "mediterranean" | "mexican" | "japanese";

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
  // metabolic data (AI Nutrition planner)
  heightCm?: number;
  age?: number;
  sex?: Sex;
  activityLevel?: ActivityLevel;
  dietGoal?: DietGoal;
  dietRestrictions?: string[];
  cuisine?: Cuisine; // default culinary style for AI meal suggestions
}

export type FoodKind = "protein" | "carb" | "fat" | "veg" | "hydration" | "other";
export type MealSlot =
  | "pre_workout" | "post_workout" | "breakfast" | "lunch" | "dinner" | "snack";

export interface MacroTargets {
  calories: number;
  protein: number; // grams
  carbs: number;   // grams
  fats: number;    // grams
}

export interface PortionItem {
  food: string;
  amount: string;  // "150 g" / "6 oz"
  visual: string;  // "≈ 1 palm"
  kind: FoodKind;
  calories?: number;
}

export interface Meal {
  name: string;
  slot: MealSlot;
  timing: string;
  macros: MacroTargets;
  items: PortionItem[];
  note?: string;
}

export interface DayPlan {
  targets: MacroTargets;
  meals: Meal[];
  hydrationLiters: number;
}

export interface NutritionPlan {
  id: string;
  iteration: number;
  strategy: string;
  summary: string;
  trainingDay: DayPlan;
  restDay: DayPlan;
  createdAt: number;
}

// ── AI nutritional lookup ("L'apport nutritif") ───────────────────────────────
export interface MicroNutrient {
  name: string;   // e.g. "Sodium", "Fiber", "Vitamin C"
  amount: string; // e.g. "320 mg"
}

// Deterministic result returned by the AI nutritional database analyzer.
export interface FoodLookupResult {
  foodName: string;          // resolved canonical name
  portion: string;           // portion size analyzed, e.g. "100 g cooked"
  macros: MacroTargets;      // calories + protein/carbs/fats
  micros?: MicroNutrient[];  // key micronutrients when relevant
  confidence?: "high" | "medium" | "low";
  notes?: string;
}

// A food the user logged to today's tracker via the lookup search.
export interface LoggedFood {
  id: string;
  name: string;
  portion: string;
  macros: MacroTargets;
  loggedAt: number;
}

// Client-only daily checklist state (cached offline in localStorage).
export interface NutritionLog {
  date: string;                 // yyyy-MM-dd (local)
  dayType: "training" | "rest";
  checkedMeals: string[];       // meal slot+name keys the user has ticked off
  extras?: LoggedFood[];        // foods added via the nutritional lookup search
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
  // Animation hints chosen by the AI so the stick-figure demo matches the move.
  pattern?: string; // movement archetype (see lib/animations.ts)
  load?: "bar" | "db" | "none"; // what the hands hold
  prop?: "floor" | "bench" | "seat" | "none"; // supporting surface
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

// ── Subscriptions / billing (accounts microservice) ──────────────────────────
export type Plan = "free" | "pro";
export type Feature = "ai_coach" | "ai_nutrition" | "program_refresh" | "ai_exercise";

export interface PlanInfo {
  id: Plan;
  name: string;
  priceUsd: number;
  features: Feature[];
  blurb: string;
  purchasable: boolean;
}

export interface Subscription {
  plan: Plan;
  status: string; // 'active' | 'trialing' | 'past_due' | 'canceled' | 'inactive'
  currentPeriodEnd: string | null;
}
