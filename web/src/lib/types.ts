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

// ── Equipment preferences (Settings → Equipment Preferences) ─────────────────
// A fine-grained override on TOP OF `equipment`/`equipmentMix` above, for a
// small set of items the athlete may want to explicitly allow or ban — e.g.
// "I picked Bodyweight, but I do also have resistance bands" (include), or
// "I picked Full gym, but never program leg-press machines for me" (exclude).
// Undefined/absent = no override, `equipment`/`equipmentMix` decide alone.
//   "include" → the AI MAY use this equipment if it's a good fit (not forced).
//   "exclude" → the AI must NEVER use this equipment, no matter what.
export type EquipmentPreference = "include" | "exclude";
export type EquipmentPrefCategory = "bands" | "freeWeights" | "machines";
export type EquipmentPreferences = Partial<Record<EquipmentPrefCategory, EquipmentPreference>>;

export interface UserProfile {
  name: string;
  goal: Goal;
  equipment: Equipment;
  equipmentMix?: string[]; // specific items when equipment === "mixed"
  equipmentPrefs?: EquipmentPreferences;
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
  // Cached MET (metabolic equivalent) for this exercise. Resolved once — from the
  // built-in Compendium table or, for unknowns, the AI — then reused for every
  // future calorie estimate of this exercise (no repeat AI cost).
  met?: number;
  // YouTube id of the demo this user picked for this movement. The picker opens
  // straight onto it next time; clearing it returns them to the ranked list.
  videoId?: string;
}

// A candidate demonstration video for the "How to perform" picker.
export interface ExerciseVideo {
  videoId: string;
  title: string;
  channelTitle: string;
  channelId: string;
  thumbnail: string;
  publishedAt?: string;
  durationSec?: number;
  viewCount?: number;
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

// How an exercise is measured. Drives which inputs are shown, how volume and
// calories are computed, and how progress is charted.
//   strength → weight × reps (e1RM trend)
//   cardio   → time/distance (run, bike, row, jump rope…)
//   hold     → time under tension (plank, wall-sit, yoga holds…)
export type ExerciseKind = "strength" | "cardio" | "hold";

// A logged set during/after a workout. `weight`/`reps` drive strength work;
// `durationSec`/`distanceKm` carry cardio & holds. All extras are optional so
// historical sessions (saved before these fields existed) keep working.
export interface LoggedSet {
  weight: number;
  reps: number;
  completed: boolean;
  durationSec?: number; // time-based work (cardio / holds): real seconds
  distanceKm?: number; // distance cardio (run / bike / row)
  rpe?: number; // rate of perceived exertion, 1–10 (also feeds calorie intensity)
}

export interface LoggedExercise {
  exerciseId: string;
  name: string;
  muscleGroup: MuscleGroup;
  restSeconds: number;
  sets: LoggedSet[];
  kind?: ExerciseKind; // defaults to "strength" when absent
  calories?: number; // estimated kcal burned for this exercise
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
  calories?: number; // total estimated kcal burned for the session
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

// ── Health / medical tracker ─────────────────────────────────────────────────
// Mirrors server/src/types.ts. Note this data is deliberately NOT persisted to
// localStorage (see store.ts `partialize`): it is fetched per session.

export type HealthIssueCategory =
  | "injury" | "pain" | "nutrition" | "metabolic" | "sleep"
  | "stress" | "medical" | "lifestyle" | "other";
export type HealthIssueStatus = "open" | "in_progress" | "monitoring" | "resolved" | "dismissed";
export type HealthIssueSeverity = "low" | "moderate" | "high" | "urgent";
export type HealthRecordKind =
  | "symptom" | "condition" | "medication" | "allergy" | "injury"
  | "surgery" | "lab" | "vitals" | "appointment" | "note";
export type HealthEventKind = "note" | "check_in" | "status_change" | "measurement" | "ai_review";

export interface Medication {
  name: string;
  dose?: string;
  schedule?: string;
}

export interface HealthProfile {
  /** Set once the user opts in to sending health data to the medical model. */
  aiConsentAt?: number;
  conditions: string[];
  allergies: string[];
  medications: Medication[];
  surgeries: string[];
  familyHistory: string[];
  bloodType?: string;
  smoking?: string;
  alcohol?: string;
  sleepHours?: number;
  stressLevel?: string;
  notes?: string;
  lastReviewAt?: number;
  lastReviewSummary?: string;
}

export interface ActionStep {
  step: string;
  cadence?: string;
  done?: boolean;
}

export interface IssueMetric {
  label: string;
  unit?: string;
  target?: string;
  latest?: number;
  latestAt?: number;
}

export interface HealthIssueEvent {
  id: string;
  issueId: string;
  kind: HealthEventKind;
  body?: string;
  metric?: string;
  value?: number;
  unit?: string;
  createdAt: number;
}

export interface HealthIssue {
  id: string;
  key: string;
  title: string;
  category: HealthIssueCategory;
  status: HealthIssueStatus;
  severity: HealthIssueSeverity;
  progress: number;
  bodyRegion?: string;
  summary?: string;
  whyItMatters?: string;
  actionPlan: ActionStep[];
  metrics: IssueMetric[];
  redFlags: string[];
  source: "ai" | "user";
  confidence?: "low" | "medium" | "high";
  firstNoticedAt?: number;
  targetDate?: string;
  resolvedAt?: number;
  lastReviewedAt?: number;
  createdAt: number;
  updatedAt: number;
  events?: HealthIssueEvent[];
}

export interface HealthRecord {
  id: string;
  issueId?: string;
  kind: HealthRecordKind;
  title: string;
  detail?: string;
  occurredAt: number;
  data: Record<string, unknown>;
  source: "user" | "ai";
  createdAt: number;
}

// ── Do & don't rules ─────────────────────────────────────────────────────────
// Standing instructions distilled from the health conversation. Mirrors
// server/src/types.ts.

export type RuleDomain = "nutrition" | "physical" | "medical" | "lifestyle";
export type RuleDirection = "start" | "more" | "less" | "avoid" | "keep";
export type RuleStatus = "active" | "paused" | "archived";

export interface HealthRule {
  id: string;
  issueId?: string;
  key: string;
  domain: RuleDomain;
  direction: RuleDirection;
  subject: string;
  detail?: string;
  reason?: string;
  status: RuleStatus;
  source: "ai" | "user";
  confidence?: "low" | "medium" | "high";
  /** Set once you edit it — the AI then stops rewriting this one. */
  userEdited: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * What one cloud model call was given, and what stayed on the server. The model
 * never receives the health record — it gets a relevance-filtered brief built
 * by the server's privacy layer, and this says what was in it.
 */
export interface CloudDisclosure {
  scope: "question" | "review";
  topics: string[];
  sent: { issues: number; records: number; rules: number };
  held: { issues: number; records: number; rules: number };
  withheld: string[];
  computedLocally: string[];
  redactions: number;
}

/** What the server says about the medical model backing this account. */
export interface MedicalAiStatus {
  available: boolean;
  /** e.g. "gemini-2.5-pro (Gemini)" — shown so the user can see who answered. */
  model: string;
  provider: "gemini" | "none";
  consented: boolean;
  disclaimer: string;
}

// ── Subscriptions / billing (accounts microservice) ──────────────────────────
export type Plan = "free" | "pro";
export type Feature =
  | "ai_coach" | "ai_nutrition" | "program_refresh" | "ai_exercise" | "ai_medical";

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
