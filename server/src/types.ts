// Shared domain + AI contract types (mirrors the frontend).

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
  | "Chest" | "Back" | "Shoulders" | "Biceps" | "Triceps"
  | "Legs" | "Glutes" | "Core" | "Cardio" | "Full Body";

// Lifestyle activity outside of training (NEAT) — drives the TDEE multiplier.
export type ActivityLevel = "sedentary" | "light" | "moderate" | "very_active";
// Body-composition objective for the nutrition planner (distinct from training goal).
export type DietGoal = "lean_gain" | "recomp" | "maintain" | "deficit" | "aggressive_deficit";
export type Sex = "male" | "female" | "other";
// Culinary style for daily meal suggestions. "standard" = no cultural styling.
export type Cuisine =
  | "standard" | "french" | "italian" | "korean"
  | "mediterranean" | "mexican" | "japanese";

// A fine-grained override on top of `equipment`/`equipmentMix` (see the
// matching comment in the web client's types.ts) — undefined = no override.
export type EquipmentPreference = "include" | "exclude";
export type EquipmentPrefCategory = "bands" | "freeWeights" | "machines";
export type EquipmentPreferences = Partial<Record<EquipmentPrefCategory, EquipmentPreference>>;

export interface UserProfile {
  name: string;
  goal: Goal;
  equipment: Equipment;
  equipmentMix?: string[];
  equipmentPrefs?: EquipmentPreferences;
  experience: Experience;
  category: WorkoutCategory;
  daysPerWeek: number;
  sessionMinutes: number;
  bodyweightKg?: number;
  units: "kg" | "lb";
  notes?: string;
  // ── metabolic data (AI Nutrition planner) ──
  heightCm?: number;
  age?: number;
  sex?: Sex;
  activityLevel?: ActivityLevel;
  dietGoal?: DietGoal;
  dietRestrictions?: string[];
  cuisine?: Cuisine; // default culinary style for AI meal suggestions
}

// ── Nutrition planner contract ──────────────────────────────────────────────
// Real-world food kinds, used to colour/iconise portions in the client.
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
  food: string;     // "Grilled chicken breast"
  amount: string;   // real-world metric, e.g. "150 g" / "6 oz"
  visual: string;   // intuitive guide, e.g. "≈ 1 palm"
  kind: FoodKind;
  calories?: number;
}

export interface Meal {
  name: string;     // "Pre-workout fuel"
  slot: MealSlot;
  timing: string;   // "30–60 min before training"
  macros: MacroTargets;
  items: PortionItem[];
  note?: string;
}

export interface DayPlan {
  targets: MacroTargets;
  meals: Meal[];
  hydrationLiters: number;
}

// One AI call returns BOTH day variants so portions can flex by training load.
export interface NutritionPlanData {
  strategy: string;  // e.g. "Body recomposition"
  summary: string;   // 2–3 sentence rationale
  trainingDay: DayPlan;
  restDay: DayPlan;
}

export interface NutritionPlan extends NutritionPlanData {
  id: string;
  iteration: number;
  createdAt: number;
}

// ── AI nutritional lookup ("L'apport nutritif") ───────────────────────────────
export interface MicroNutrient {
  name: string;   // e.g. "Sodium", "Fiber"
  amount: string; // e.g. "320 mg"
}

// Deterministic, hallucination-resistant result from the food analyzer.
export interface FoodLookupResult {
  foodName: string;
  portion: string;          // portion size analyzed
  macros: MacroTargets;     // calories + protein/carbs/fats
  micros?: MicroNutrient[];
  confidence?: "high" | "medium" | "low";
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
