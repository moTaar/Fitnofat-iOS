// AI Nutrition & Portion planner.
//
// Aggregates the athlete's physical stats, dietary preferences and CURRENT
// training load (the exercises/volume in their active program) into a single
// structured payload, asks Gemini for a training-day + rest-day meal plan, and
// parses the JSON into actionable portions. A fully deterministic local engine
// (Mifflin-St Jeor TDEE + hand-portion rendering) backs the same contract so the
// feature works offline / with no API key, and so the plan always returns fast.

import { config } from "./config";
import type {
  ActivityLevel, DayPlan, DietGoal, MacroTargets, Meal, NutritionPlanData,
  PortionItem, RoutineExercise, Sex, UserProfile,
} from "./types";

const ENDPOINT = (model: string, key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

// A routine as the planner needs to see it (name + its exercises).
export interface RoutineLite {
  name: string;
  dayLabel?: string;
  exercises: RoutineExercise[];
}

// ── Training-load summary (workout data → nutrition signal) ───────────────────
// Translates the program into the things that actually move dietary demand:
// weekly hard sets, the muscle groups being trained, and a coarse intensity.
function trainingSummary(p: UserProfile, routines: RoutineLite[]): string {
  const totalSets = routines.reduce(
    (n, r) => n + r.exercises.reduce((m, e) => m + e.sets.length, 0),
    0
  );
  const groups = new Set<string>();
  routines.forEach((r) => r.exercises.forEach((e) => groups.add(e.muscleGroup)));
  const sampleMoves = routines
    .flatMap((r) => r.exercises.map((e) => e.name))
    .slice(0, 12);

  const lines = [
    `- Training days/week: ${p.daysPerWeek}`,
    `- Session length: ${p.sessionMinutes} min`,
    `- Total prescribed sets across the week: ${totalSets}`,
    `- Muscle groups trained: ${[...groups].join(", ") || "general"}`,
    `- Primary training goal: ${p.goal}`,
    `- Sample exercises: ${sampleMoves.join(", ") || "n/a"}`,
  ];
  return lines.join("\n");
}

// ── Deterministic engine (offline / no-key fallback, also the math reference) ──

const ACTIVITY_MULT: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  very_active: 1.725,
};

// Calorie adjustment for the body-composition goal, per day-type. Recomp uses
// classic calorie cycling: a small surplus on training days, a deficit on rest.
const GOAL_ADJ: Record<DietGoal, { train: number; rest: number }> = {
  lean_gain:          { train: 1.12, rest: 1.08 },
  recomp:             { train: 1.06, rest: 0.88 },
  maintain:           { train: 1.0,  rest: 1.0 },
  deficit:            { train: 0.85, rest: 0.82 },
  aggressive_deficit: { train: 0.75, rest: 0.72 },
};

function bmrMifflin(weightKg: number, heightCm: number, age: number, sex: Sex): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  if (sex === "male") return base + 5;
  if (sex === "female") return base - 161;
  return base - 78; // unknown/other → midpoint
}

function round(n: number, step = 1): number {
  return Math.round(n / step) * step;
}

// Macro split from a calorie target. Protein scales with bodyweight (higher in a
// deficit to spare muscle); fat is a % of calories; carbs take the remainder.
function macrosFor(calories: number, weightKg: number, goal: DietGoal): MacroTargets {
  const cutting = goal === "deficit" || goal === "aggressive_deficit";
  const proteinG = round(weightKg * (cutting ? 2.2 : 1.9), 5);
  const fatG = round((calories * 0.25) / 9, 1);
  const remaining = calories - proteinG * 4 - fatG * 9;
  const carbsG = Math.max(0, round(remaining / 4, 5));
  return { calories: round(calories, 10), protein: proteinG, carbs: carbsG, fats: fatG };
}

// Hand-portion foods, tagged so we can honour restrictions (vegan/keto/allergy).
interface Food { name: string; kind: PortionItem["kind"]; per: number; unitG: number; tags: string[]; veganOk: boolean; ketoOk: boolean }
const FOODS: Food[] = [
  // proteins (per = grams of protein per 100g of food)
  { name: "Chicken breast",     kind: "protein", per: 31, unitG: 100, tags: [], veganOk: false, ketoOk: true },
  { name: "Lean beef",          kind: "protein", per: 26, unitG: 100, tags: ["beef"], veganOk: false, ketoOk: true },
  { name: "Salmon fillet",      kind: "protein", per: 20, unitG: 100, tags: ["fish"], veganOk: false, ketoOk: true },
  { name: "Greek yogurt",       kind: "protein", per: 10, unitG: 100, tags: ["dairy"], veganOk: false, ketoOk: true },
  { name: "Tofu",               kind: "protein", per: 12, unitG: 100, tags: ["soy"], veganOk: true,  ketoOk: true },
  { name: "Lentils",            kind: "protein", per: 9,  unitG: 100, tags: [], veganOk: true,  ketoOk: false },
  { name: "Tempeh",             kind: "protein", per: 19, unitG: 100, tags: ["soy"], veganOk: true,  ketoOk: true },
  // carbs (per = grams of carbs per 100g cooked)
  { name: "White rice",         kind: "carb",    per: 28, unitG: 100, tags: [], veganOk: true,  ketoOk: false },
  { name: "Sweet potato",       kind: "carb",    per: 20, unitG: 100, tags: [], veganOk: true,  ketoOk: false },
  { name: "Oats",               kind: "carb",    per: 60, unitG: 100, tags: ["gluten"], veganOk: true, ketoOk: false },
  { name: "Quinoa",             kind: "carb",    per: 21, unitG: 100, tags: [], veganOk: true,  ketoOk: false },
  { name: "Banana",             kind: "carb",    per: 23, unitG: 100, tags: [], veganOk: true,  ketoOk: false },
  // fats (per = grams of fat per 100g)
  { name: "Avocado",            kind: "fat",     per: 15, unitG: 100, tags: [], veganOk: true,  ketoOk: true },
  { name: "Almonds",            kind: "fat",     per: 49, unitG: 100, tags: ["nut"], veganOk: true, ketoOk: true },
  { name: "Olive oil",          kind: "fat",     per: 100, unitG: 100, tags: [], veganOk: true, ketoOk: true },
  { name: "Peanut butter",      kind: "fat",     per: 50, unitG: 100, tags: ["nut","peanut"], veganOk: true, ketoOk: true },
  // veg
  { name: "Mixed greens",       kind: "veg",     per: 4,  unitG: 100, tags: [], veganOk: true,  ketoOk: true },
  { name: "Broccoli",           kind: "veg",     per: 7,  unitG: 100, tags: [], veganOk: true,  ketoOk: true },
];

function restrictionFilter(restrictions: string[]): (f: Food) => boolean {
  const r = restrictions.map((s) => s.toLowerCase());
  const vegan = r.some((x) => x.includes("vegan") || x.includes("plant"));
  const veggie = r.some((x) => x.includes("vegetarian"));
  const keto = r.some((x) => x.includes("keto") || x.includes("low carb") || x.includes("low-carb"));
  return (f) => {
    if (vegan && !f.veganOk) return false;
    if (veggie && (f.tags.includes("beef") || f.tags.includes("fish")) ) return false;
    if (keto && !f.ketoOk) return false;
    // allergen keywords appearing in the restriction text exclude tagged foods
    if (r.some((x) => f.tags.some((t) => x.includes(t) && t !== "")))
      return false;
    return true;
  };
}

// Render grams of a macro into one portion item using a representative food and
// the hand-portion visual guide.
function portion(
  kind: PortionItem["kind"],
  grams: number,
  foods: Food[]
): PortionItem | null {
  if (grams <= 0) return null;
  const pool = foods.filter((f) => f.kind === kind);
  const f = pool[Math.floor(Math.random() * pool.length)] ?? pool[0];
  if (!f) return null;
  const foodGrams = round((grams / f.per) * 100, 5);
  const visual =
    kind === "protein" ? `${Math.max(1, Math.round(grams / 28))} palm${grams > 42 ? "s" : ""}`
    : kind === "carb"  ? `${Math.max(1, Math.round(grams / 28))} cupped hand${grams > 42 ? "s" : ""}`
    : kind === "fat"   ? `${Math.max(1, Math.round(grams / 11))} thumb${grams > 16 ? "s" : ""}`
    : "1 fist";
  const cals =
    kind === "protein" ? grams * 4 : kind === "carb" ? grams * 4 : kind === "fat" ? grams * 9 : 15;
  return { food: f.name, amount: `${foodGrams} g`, visual, kind, calories: round(cals, 5) };
}

// Split a day's macro targets across meals (weights sum to 1 each macro).
function buildMeals(
  targets: MacroTargets,
  blueprint: { name: string; slot: Meal["slot"]; timing: string; p: number; c: number; f: number; note?: string }[],
  foods: Food[]
): Meal[] {
  return blueprint.map((b) => {
    const protein = round(targets.protein * b.p, 5);
    const carbs = round(targets.carbs * b.c, 5);
    const fats = round(targets.fats * b.f, 1);
    const items = [
      portion("protein", protein, foods),
      portion("carb", carbs, foods),
      portion("fat", fats, foods),
      b.slot === "lunch" || b.slot === "dinner" ? portion("veg", 1, foods) : null,
    ].filter(Boolean) as PortionItem[];
    return {
      name: b.name,
      slot: b.slot,
      timing: b.timing,
      note: b.note,
      macros: { calories: round(protein * 4 + carbs * 4 + fats * 9, 10), protein, carbs, fats },
      items,
    };
  });
}

function localPlan(p: UserProfile, routines: RoutineLite[]): NutritionPlanData {
  const weightKg = p.bodyweightKg && p.bodyweightKg > 0 ? p.bodyweightKg : 75;
  const heightCm = p.heightCm && p.heightCm > 0 ? p.heightCm : 175;
  const age = p.age && p.age > 0 ? p.age : 30;
  const sex: Sex = p.sex ?? "other";
  const activity: ActivityLevel = p.activityLevel ?? "light";
  const goal: DietGoal = p.dietGoal ?? "maintain";
  const restrictions = p.dietRestrictions ?? [];
  const foods = FOODS.filter(restrictionFilter(restrictions));

  const bmr = bmrMifflin(weightKg, heightCm, age, sex);
  const maintenance = bmr * ACTIVITY_MULT[activity];
  // Training-day expenditure bonus scales with session length.
  const trainingBonus = Math.min(500, p.sessionMinutes * 5);
  const adj = GOAL_ADJ[goal];

  const trainTargets = macrosFor((maintenance + trainingBonus) * adj.train, weightKg, goal);
  const restTargets = macrosFor(maintenance * adj.rest, weightKg, goal);

  const trainMeals = buildMeals(
    trainTargets,
    [
      { name: "Breakfast", slot: "breakfast", timing: "Within 1 hr of waking", p: 0.25, c: 0.2, f: 0.3 },
      { name: "Pre-workout fuel", slot: "pre_workout", timing: "60–90 min before training", p: 0.2, c: 0.3, f: 0.1, note: "Fast-digesting carbs to fuel the session." },
      { name: "Post-workout recovery", slot: "post_workout", timing: "Within 45 min after training", p: 0.3, c: 0.35, f: 0.1, note: "Protein + carbs to refill glycogen and start recovery." },
      { name: "Dinner", slot: "dinner", timing: "Evening", p: 0.25, c: 0.15, f: 0.5 },
    ],
    foods
  );

  const restMeals = buildMeals(
    restTargets,
    [
      { name: "Breakfast", slot: "breakfast", timing: "Within 1 hr of waking", p: 0.3, c: 0.3, f: 0.3 },
      { name: "Lunch", slot: "lunch", timing: "Midday", p: 0.3, c: 0.35, f: 0.3 },
      { name: "Dinner", slot: "dinner", timing: "Evening", p: 0.3, c: 0.25, f: 0.3 },
      { name: "Snack", slot: "snack", timing: "Between meals", p: 0.1, c: 0.1, f: 0.1 },
    ],
    foods
  );

  const hydration = round((weightKg * 0.035 + 0.7) * 10) / 10; // ~35ml/kg + training buffer

  const strategyLabel: Record<DietGoal, string> = {
    lean_gain: "Lean mass gain",
    recomp: "Body recomposition",
    maintain: "Maintenance",
    deficit: "Fat-loss deficit",
    aggressive_deficit: "Aggressive deficit",
  };

  void trainingSummary(p, routines); // (kept for parity with the AI prompt path)

  return {
    strategy: strategyLabel[goal],
    summary: `Targets are built from your Mifflin-St Jeor TDEE (~${round(maintenance, 10)} kcal maintenance) scaled for ${strategyLabel[goal].toLowerCase()} and your ${p.daysPerWeek}-day training load. Training days carry more carbs to fuel and recover from your sessions; rest days trim carbs and lean on fats. (Computed locally — set a Gemini API key for fully AI-personalised meals.)`,
    trainingDay: { targets: trainTargets, meals: trainMeals, hydrationLiters: hydration + 0.5 },
    restDay: { targets: restTargets, meals: restMeals, hydrationLiters: hydration },
  };
}

// ── Gemini path ───────────────────────────────────────────────────────────────

const macroSchema = {
  type: "object",
  properties: {
    calories: { type: "integer" },
    protein: { type: "number" },
    carbs: { type: "number" },
    fats: { type: "number" },
  },
  required: ["calories", "protein", "carbs", "fats"],
};

const portionSchema = {
  type: "object",
  properties: {
    food: { type: "string" },
    amount: { type: "string" },
    visual: { type: "string" },
    kind: { type: "string", enum: ["protein", "carb", "fat", "veg", "hydration", "other"] },
    calories: { type: "number" },
  },
  required: ["food", "amount", "visual", "kind"],
};

const mealSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    slot: { type: "string", enum: ["pre_workout", "post_workout", "breakfast", "lunch", "dinner", "snack"] },
    timing: { type: "string" },
    macros: macroSchema,
    items: { type: "array", items: portionSchema },
    note: { type: "string" },
  },
  required: ["name", "slot", "timing", "macros", "items"],
};

const dayPlanSchema = {
  type: "object",
  properties: {
    targets: macroSchema,
    meals: { type: "array", items: mealSchema },
    hydrationLiters: { type: "number" },
  },
  required: ["targets", "meals", "hydrationLiters"],
};

const nutritionSchema = {
  type: "object",
  properties: {
    strategy: { type: "string" },
    summary: { type: "string" },
    trainingDay: dayPlanSchema,
    restDay: dayPlanSchema,
  },
  required: ["strategy", "summary", "trainingDay", "restDay"],
};

const NUTRITION_SYSTEM = `You are a certified sports nutritionist and registered dietitian.
You build precise, practical daily meal plans that fuel a specific training program.
Return ONLY valid JSON matching the schema — no prose outside JSON.
Rules:
- Compute realistic daily calorie + macronutrient targets (protein, carbs, fats in grams) from the athlete's stats (Mifflin-St Jeor TDEE), their lifestyle activity, AND their training load.
- Produce TWO day plans: "trainingDay" and "restDay". Training days get more carbohydrate to fuel/recover sessions; rest days trim carbs and shift to fats. Protein stays high on both.
- Training-day meals MUST include a "pre_workout" and a "post_workout" meal with timing relative to the session.
- Each meal lists "items": real foods with an exact real-world "amount" (grams or oz) AND an intuitive hand-portion "visual" (e.g. "1 palm", "2 cupped hands", "1 thumb", "1 fist").
- STRICTLY honour every dietary restriction provided (e.g. vegan, keto, allergies) — never include a forbidden food.
- Each meal's "macros" should sum (across meals) close to that day's "targets".
- Provide a hydration target in litres for each day.
- Keep "summary" to 2–3 sentences explaining the strategy and how it ties to the training load.`;

function buildPrompt(p: UserProfile, routines: RoutineLite[], analytics?: string): string {
  const restrictions = p.dietRestrictions?.length ? p.dietRestrictions.join(", ") : "none";
  return `Design a nutrition plan for this athlete.

Physical stats:
- Bodyweight: ${p.bodyweightKg ?? "unknown"} kg
- Height: ${p.heightCm ?? "unknown"} cm
- Age: ${p.age ?? "unknown"}
- Sex: ${p.sex ?? "unspecified"}
- Lifestyle activity outside the gym: ${p.activityLevel ?? "light"}
- Units preference: ${p.units}

Nutrition goal: ${p.dietGoal ?? "maintain"}
Dietary restrictions: ${restrictions}

Current training program load:
${trainingSummary(p, routines)}
${analytics ? `\nRecent training progress (use to fine-tune calories/carbs for the new phase):\n${analytics}` : ""}

Return the full JSON plan (trainingDay + restDay).`;
}

function sanitizeMacros(m: any): MacroTargets {
  return {
    calories: Math.max(0, Math.round(Number(m?.calories) || 0)),
    protein: Math.max(0, Number(m?.protein) || 0),
    carbs: Math.max(0, Number(m?.carbs) || 0),
    fats: Math.max(0, Number(m?.fats) || 0),
  };
}

function sanitizeDay(d: any, fallback: DayPlan): DayPlan {
  if (!d || !Array.isArray(d.meals) || d.meals.length === 0) return fallback;
  const meals: Meal[] = d.meals.map((m: any) => ({
    name: String(m?.name ?? "Meal"),
    slot: m?.slot ?? "snack",
    timing: String(m?.timing ?? ""),
    macros: sanitizeMacros(m?.macros),
    note: m?.note ? String(m.note) : undefined,
    items: Array.isArray(m?.items)
      ? m.items.map((it: any) => ({
          food: String(it?.food ?? ""),
          amount: String(it?.amount ?? ""),
          visual: String(it?.visual ?? ""),
          kind: it?.kind ?? "other",
          calories: it?.calories != null ? Number(it.calories) : undefined,
        }))
      : [],
  }));
  return {
    targets: sanitizeMacros(d.targets),
    meals,
    hydrationLiters: Number(d.hydrationLiters) || fallback.hydrationLiters,
  };
}

export async function generateNutritionPlan(
  p: UserProfile,
  routines: RoutineLite[],
  analytics?: string
): Promise<NutritionPlanData> {
  const fallback = localPlan(p, routines);
  const key = config.geminiApiKey.trim();
  if (!key) return fallback;

  try {
    const res = await fetch(ENDPOINT(config.geminiModel, key), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: NUTRITION_SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: buildPrompt(p, routines, analytics) }] }],
        generationConfig: {
          temperature: 0.5,
          responseMimeType: "application/json",
          responseSchema: nutritionSchema,
        },
      }),
    });
    if (!res.ok) {
      if (res.status === 429) throw new Error("QUOTA_EXCEEDED");
      throw new Error(`Gemini nutrition error ${res.status}`);
    }
    const data: any = await res.json();
    const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini returned an empty nutrition response.");
    const parsed = JSON.parse(text);
    return {
      strategy: String(parsed.strategy ?? fallback.strategy),
      summary: String(parsed.summary ?? fallback.summary),
      trainingDay: sanitizeDay(parsed.trainingDay, fallback.trainingDay),
      restDay: sanitizeDay(parsed.restDay, fallback.restDay),
    };
  } catch (err) {
    if (err instanceof Error && err.message === "QUOTA_EXCEEDED") throw err;
    return fallback;
  }
}
