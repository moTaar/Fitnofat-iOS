import { config } from "./config";
import { goalLabel } from "./util";
import type {
  AIGeneratedExercise,
  AIGeneratedRoutine,
  AIProgramResponse,
  MuscleGroup,
  UserProfile,
} from "./types";

const ENDPOINT = (model: string, key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

// When the athlete's equipment is restricted we pin the `equipment` field to an
// enum so the model can only label exercises with gear they actually own.
function buildResponseSchema(equipmentEnum?: string[] | null) {
  const equipment =
    equipmentEnum && equipmentEnum.length
      ? { type: "string", enum: equipmentEnum }
      : { type: "string" };
  return {
    type: "object",
    properties: {
      programName: { type: "string" },
      weeks: { type: "integer" },
      summary: { type: "string" },
      routines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            dayLabel: { type: "string" },
            description: { type: "string" },
            exercises: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  muscleGroup: { type: "string" },
                  equipment,
                  restSeconds: { type: "integer" },
                  notes: { type: "string" },
                  sets: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        reps: { type: "integer" },
                        weight: { type: "number" },
                        rpe: { type: "number" },
                      },
                      required: ["reps"],
                    },
                  },
                },
                required: ["name", "muscleGroup", "equipment", "restSeconds", "sets"],
              },
            },
          },
          required: ["name", "dayLabel", "exercises"],
        },
      },
    },
    required: ["programName", "weeks", "summary", "routines"],
  };
}

const EQUIPMENT_TEXT: Record<string, string> = {
  full_gym: "a fully-equipped commercial gym (barbells, machines, cables, dumbbells, kettlebells)",
  home_gym: "a home gym with a barbell, rack, bench and adjustable dumbbells",
  dumbbells: "adjustable dumbbells (and a bench if needed)",
  bodyweight: "bodyweight only (no equipment)",
  resistance_bands: "resistance bands only (loop bands and/or tube bands with handles)",
  machines: "gym machines only (no free weights — cables, leg press, chest press, etc.)",
  kettlebells: "kettlebells only",
  other: "equipment the athlete describes in their notes",
};

const CATEGORY_TEXT: Record<string, string> = {
  calisthenics: "Calisthenics / bodyweight movement (push-ups, pull-ups, dips, L-sits, handstands, etc.)",
  weightlifting: "Weightlifting / barbell & dumbbell training (compounds + accessories)",
  cardio: "Cardiovascular training (running, cycling, rowing, jump rope, HIIT)",
  yoga_pilates: "Yoga & Pilates (mobility, flexibility, core stability, breath work)",
  mixed: "Mixed / balanced (combine strength, cardio, and mobility work across the week)",
  other: "Open / no strong preference — choose what best fits the goal",
};

const SYSTEM = `You are an elite strength & conditioning coach and certified personal trainer.
You design safe, evidence-based, progressively-overloaded training programs.
You ALWAYS return valid JSON that matches the provided schema exactly — no prose outside JSON.
Use realistic starting weights for the experience level (use 0 weight for bodyweight movements).
CRITICAL: only program exercises the athlete can perform with the EXACT equipment listed in their profile — never assume access to gear (cables, machines, dumbbells, barbells, etc.) that is not explicitly listed. When in doubt, choose a bodyweight movement.
Also match the athlete's preferred workout style/category.
Distribute volume sensibly across the week.
muscleGroup MUST be one of: Chest, Back, Shoulders, Biceps, Triceps, Legs, Glutes, Core, Cardio, Full Body.`;

function equipmentDescription(p: UserProfile): string {
  if (p.equipment === "mixed" && p.equipmentMix?.length) {
    return `a custom mix: ${p.equipmentMix.join(", ")}`;
  }
  return EQUIPMENT_TEXT[p.equipment] ?? "equipment the athlete describes in their notes";
}

// ── Equipment constraint model ───────────────────────────────────────────────
// The AI used to occasionally program exercises that need gear the athlete
// doesn't own (e.g. cables/dumbbells for a bodyweight user). We derive the
// athlete's allowed "weighted equipment" up front, feed it to the model as a
// hard constraint (prompt + JSON enum), then verify the response and re-prompt
// to fix any violations before the program is finalized.
//
// "Restricted" tokens are the ones that actually gate whether a movement is
// doable. Bodyweight, a bench and a pull-up bar are treated as universally
// available accessories, so they never count as violations (this avoids false
// positives on staples like push-ups, dips and pull-ups).
type EquipmentToken = "barbell" | "dumbbell" | "cable" | "machine" | "resistance_band" | "kettlebell";

const RESTRICTED_TOKENS: EquipmentToken[] = [
  "barbell", "dumbbell", "cable", "machine", "resistance_band", "kettlebell",
];

const EQUIPMENT_LABEL: Record<EquipmentToken, string> = {
  barbell: "Barbell",
  dumbbell: "Dumbbell",
  cable: "Cable",
  machine: "Machine",
  resistance_band: "Resistance Band",
  kettlebell: "Kettlebell",
};

// Restricted tokens each preset grants. `null` ⇒ no restriction (use anything).
const PRESET_TOKENS: Record<string, EquipmentToken[] | null> = {
  full_gym: null,
  other: null,
  home_gym: ["barbell", "dumbbell"],
  dumbbells: ["dumbbell"],
  bodyweight: [],
  resistance_bands: ["resistance_band"],
  machines: ["machine", "cable"],
  kettlebells: ["kettlebell"],
};

// Detect which restricted equipment a free-text string (an exercise name or the
// model's `equipment` field) implies. Only restricted tokens are detected.
function detectTokens(text: string): EquipmentToken[] {
  const t = ` ${text.toLowerCase()} `;
  const out = new Set<EquipmentToken>();
  if (/barbell|ez.?bar|olympic bar/.test(t)) out.add("barbell");
  if (/dumbbell|dumbell|\bdb\b/.test(t)) out.add("dumbbell");
  if (/cable|pulley|crossover|pulldown|pull.?down|pushdown|push.?down|face.?pull/.test(t)) out.add("cable");
  if (/machine|leg press|hack squat|pec deck|leg extension|leg curl|hammer strength|\bsmith\b/.test(t)) out.add("machine");
  if (/\bband\b|resistance band|banded/.test(t)) out.add("resistance_band");
  if (/kettlebell|\bkb\b/.test(t)) out.add("kettlebell");
  // A banded variant of a cable/machine movement (e.g. "Banded Lat Pulldown")
  // only needs a band — don't double-flag it as cable/machine.
  if (out.has("resistance_band")) { out.delete("cable"); out.delete("machine"); }
  return [...out];
}

// The set of restricted equipment the athlete actually has. `null` = unrestricted.
function allowedTokens(p: UserProfile): Set<EquipmentToken> | null {
  if (p.equipment === "mixed") {
    const items = p.equipmentMix ?? [];
    // No items specified — we can't safely constrain, so don't.
    if (!items.length) return null;
    const set = new Set<EquipmentToken>();
    for (const item of items) detectTokens(item).forEach((tok) => set.add(tok));
    return set;
  }
  const preset = PRESET_TOKENS[p.equipment];
  return preset == null ? null : new Set(preset);
}

// Human-readable equipment labels the model may use in the `equipment` field.
// `null` mirrors allowedTokens — no restriction. The accessory labels are always
// appended because they're considered universally available.
function allowedEquipmentLabels(allowed: Set<EquipmentToken> | null): string[] | null {
  if (!allowed) return null;
  const restricted = RESTRICTED_TOKENS.filter((tok) => allowed.has(tok)).map((tok) => EQUIPMENT_LABEL[tok]);
  return [...restricted, "Bodyweight", "Bench", "Pull-up Bar"];
}

// The restricted gear the athlete does NOT have, phrased for a prompt exclusion.
function excludedEquipmentText(allowed: Set<EquipmentToken>): string {
  const missing = RESTRICTED_TOKENS.filter((tok) => !allowed.has(tok)).map(
    (tok) => `${EQUIPMENT_LABEL[tok].toLowerCase()}s`
  );
  return missing.length ? missing.join(", ") : "any unavailable equipment";
}

// A strict, hard-to-miss equipment section for the generation prompt.
function equipmentConstraintBlock(p: UserProfile, allowed: Set<EquipmentToken> | null): string {
  if (!allowed) {
    return `Equipment available: ${equipmentDescription(p)} (full range — choose whatever best fits the goal).`;
  }
  const labels = allowedEquipmentLabels(allowed)!;
  return `Equipment available: ${equipmentDescription(p)}

EQUIPMENT CONSTRAINTS (STRICT — the athlete has access to NOTHING else):
- Every exercise MUST be performable using ONLY: ${labels.join(", ")}.
- The "equipment" field of every exercise MUST be exactly one of: ${labels.join(", ")}.
- Do NOT program any movement that requires ${excludedEquipmentText(allowed)} (or any other unavailable gear).
- Bodyweight movements are always acceptable — prefer them over inventing equipment the athlete lacks.`;
}

interface EquipmentViolation {
  routine: string;
  name: string;
  tokens: EquipmentToken[];
}

// Restricted equipment an exercise needs but the athlete doesn't have.
function exerciseViolations(e: AIGeneratedExercise, allowed: Set<EquipmentToken>): EquipmentToken[] {
  const needed = new Set<EquipmentToken>([
    ...detectTokens(e.name ?? ""),
    ...detectTokens(e.equipment ?? ""),
  ]);
  return [...needed].filter((tok) => !allowed.has(tok));
}

// Verify a generated program respects the athlete's equipment. Empty ⇒ all good.
function findEquipmentViolations(
  ai: AIProgramResponse,
  allowed: Set<EquipmentToken> | null
): EquipmentViolation[] {
  if (!allowed) return [];
  const out: EquipmentViolation[] = [];
  for (const r of ai.routines ?? []) {
    for (const e of r.exercises ?? []) {
      const bad = exerciseViolations(e, allowed);
      if (bad.length) out.push({ routine: r.name, name: e.name, tokens: bad });
    }
  }
  return out;
}

// Last-resort sanitizer: drop any still-non-compliant exercise. Never empties a
// training day — if every move in a routine is flagged we keep the originals
// rather than ship a blank day (this should be vanishingly rare after the
// corrective re-prompt).
function enforceEquipment(
  ai: AIProgramResponse,
  allowed: Set<EquipmentToken> | null
): AIProgramResponse {
  if (!allowed) return ai;
  return {
    ...ai,
    routines: ai.routines.map((r) => {
      const kept = r.exercises.filter((e) => exerciseViolations(e, allowed).length === 0);
      return { ...r, exercises: kept.length ? kept : r.exercises };
    }),
  };
}

// Correction note appended to the original prompt when the first attempt strays.
function equipmentCorrectionNote(
  p: UserProfile,
  allowed: Set<EquipmentToken>,
  violations: EquipmentViolation[]
): string {
  const labels = allowedEquipmentLabels(allowed)!;
  const list = violations
    .map((v) => `- "${v.name}" (${v.routine}) — needs ${v.tokens.map((t) => EQUIPMENT_LABEL[t]).join(", ")}`)
    .join("\n");
  return `IMPORTANT — your previous attempt BROKE the equipment constraints. The exercises below require equipment the athlete does NOT have and MUST be replaced with effective alternatives that use ONLY ${labels.join(", ")}:
${list}

Return the COMPLETE corrected program (all ${p.daysPerWeek} routines). Every single exercise must comply with the equipment constraints.`;
}

function generatePrompt(p: UserProfile, allowed: Set<EquipmentToken> | null): string {
  return `Create a personalized training program.

Athlete profile:
- Name: ${p.name || "Athlete"}
- Primary goal: ${goalLabel(p.goal)}
- Preferred workout style: ${CATEGORY_TEXT[p.category ?? "mixed"]}
- Experience: ${p.experience}
- Training days per week: ${p.daysPerWeek}
- Target session length: ${p.sessionMinutes} minutes
- Units: ${p.units}
${p.bodyweightKg ? `- Bodyweight: ${p.bodyweightKg} ${p.units}` : ""}
${p.notes ? `- Notes / limitations: ${p.notes}` : ""}

${equipmentConstraintBlock(p, allowed)}

Produce exactly ${p.daysPerWeek} distinct routines (one per training day).
Each routine should contain 4-7 exercises that strongly reflect the athlete's preferred workout style.
Provide a concise "summary" (2-3 sentences) explaining the program design rationale.`;
}

function refreshPrompt(p: UserProfile, analytics: string, allowed: Set<EquipmentToken> | null): string {
  return `The athlete has completed a training block. Evolve their program for the NEXT iteration.

Athlete profile:
- Goal: ${goalLabel(p.goal)}
- Preferred workout style: ${CATEGORY_TEXT[p.category ?? "mixed"]}
- Experience: ${p.experience}
- Days per week: ${p.daysPerWeek}
- Units: ${p.units}

${equipmentConstraintBlock(p, allowed)}

Recent performance analytics:
${analytics}

Apply intelligent progression:
- Increase load/reps on exercises that are progressing well (progressive overload).
- Swap out exercises that have STALLED (no progress / plateaued) for effective alternatives that still match the preferred workout style.
- Any replacement exercise MUST also respect the equipment constraints above.
- Keep the same number of routines (${p.daysPerWeek}).
- In "summary", explicitly explain what you changed and why (mention specific exercises).`;
}

const VALID_GROUPS: MuscleGroup[] = [
  "Chest", "Back", "Shoulders", "Biceps", "Triceps",
  "Legs", "Glutes", "Core", "Cardio", "Full Body",
];

function normalize(p: AIProgramResponse): AIProgramResponse {
  return {
    programName: p.programName || "Custom Program",
    weeks: p.weeks || 4,
    summary: p.summary || "",
    routines: (p.routines || []).map((r) => ({
      ...r,
      exercises: (r.exercises || []).map((e) => ({
        ...e,
        muscleGroup: VALID_GROUPS.includes(e.muscleGroup as MuscleGroup)
          ? e.muscleGroup
          : "Full Body",
        restSeconds: e.restSeconds || 90,
        sets: (e.sets || []).map((s) => ({
          reps: s.reps || 10,
          weight: typeof s.weight === "number" ? s.weight : undefined,
          rpe: s.rpe,
        })),
      })),
    })),
  };
}

async function callGemini(
  prompt: string,
  equipmentEnum?: string[] | null
): Promise<AIProgramResponse> {
  const key = config.geminiApiKey.trim();
  if (!key) throw new Error("NO_API_KEY");

  const res = await fetch(ENDPOINT(config.geminiModel, key), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        responseMimeType: "application/json",
        responseSchema: buildResponseSchema(equipmentEnum),
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429) throw new Error("NO_API_KEY"); // reuse local fallback
    throw new Error(`Gemini API error ${res.status}: ${body.slice(0, 300)}`);
  }
  const data: any = await res.json();
  const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned an empty response.");
  return normalize(JSON.parse(text) as AIProgramResponse);
}

// A focused "repair this program" prompt for the fast structured model. Lets us
// fix equipment violations with a single targeted edit instead of paying for a
// full regeneration (and, for coach updates, without re-invoking the heavy
// search-grounded model).
function equipmentRepairPrompt(
  p: UserProfile,
  ai: AIProgramResponse,
  allowed: Set<EquipmentToken>,
  violations: EquipmentViolation[]
): string {
  const labels = allowedEquipmentLabels(allowed)!;
  const program = { programName: ai.programName, weeks: ai.weeks, summary: ai.summary, routines: ai.routines };
  return `Fix the equipment in this training program. Keep its structure, set/rep schemes and intent — ONLY swap the non-compliant exercises for effective alternatives.

Athlete: ${goalLabel(p.goal)} goal, ${p.experience}, prefers ${CATEGORY_TEXT[p.category ?? "mixed"]}.
Allowed equipment ONLY: ${labels.join(", ")}.

Current program (JSON):
${JSON.stringify(program)}

${equipmentCorrectionNote(p, allowed, violations)}`;
}

// Verify an AI program against the athlete's equipment and make it compliant:
// one targeted repair call on the fast structured model, then a deterministic
// hard-filter for any residue. Returns instantly with ZERO extra API calls when
// the equipment is unrestricted or the program is already clean (the common
// case, thanks to the prompt constraints + JSON enum on the first pass).
async function ensureEquipmentCompliant(
  p: UserProfile,
  ai: AIProgramResponse
): Promise<AIProgramResponse> {
  const allowed = allowedTokens(p);
  if (!allowed) return ai;

  let violations = findEquipmentViolations(ai, allowed);
  if (!violations.length) return ai;

  try {
    const labels = allowedEquipmentLabels(allowed);
    ai = await callGemini(equipmentRepairPrompt(p, ai, allowed, violations), labels);
    violations = findEquipmentViolations(ai, allowed);
  } catch {
    // Repair call failed — fall through to the deterministic filter below.
  }
  if (violations.length) ai = enforceEquipment(ai, allowed);
  return ai;
}

export async function generateProgram(p: UserProfile): Promise<AIProgramResponse> {
  try {
    const allowed = allowedTokens(p);
    const ai = await callGemini(generatePrompt(p, allowed), allowedEquipmentLabels(allowed));
    return await ensureEquipmentCompliant(p, ai);
  } catch (err) {
    if (err instanceof Error && err.message === "NO_API_KEY") return localProgram(p);
    throw err;
  }
}

export async function refreshProgram(
  p: UserProfile,
  analytics: string
): Promise<AIProgramResponse> {
  try {
    const allowed = allowedTokens(p);
    const ai = await callGemini(refreshPrompt(p, analytics, allowed), allowedEquipmentLabels(allowed));
    return await ensureEquipmentCompliant(p, ai);
  } catch (err) {
    if (err instanceof Error && err.message === "NO_API_KEY") {
      const base = localProgram(p);
      base.summary =
        "Offline progression applied: added ~2.5% load and a rep to compound lifts. Set GEMINI_API_KEY on the server for adaptive AI coaching.";
      base.routines.forEach((r) =>
        r.exercises.forEach((e) =>
          e.sets.forEach((s) => {
            if (s.weight) s.weight = Math.round(s.weight * 1.025);
            s.reps += 1;
          })
        )
      );
      return base;
    }
    throw err;
  }
}

// ── Conversational onboarding chat ───────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "model";
  content: string;
}

export interface ChatReply {
  type: "question" | "done";
  text: string;
  suggestions?: string[]; // tappable quick-reply chips shown below the message
  profile?: UserProfile;
}

// Plain-text system prompt. Model signals completion with [DONE], and attaches
// tappable suggestion chips via [SUGGESTIONS: a | b | c] on the last line.
const CHAT_SYSTEM = `You are ForgeFit's friendly AI personal-training coach doing a short onboarding interview.
Ask ONE concise, friendly question at a time to learn:
1. Primary fitness goal (strength / muscle / weight loss / endurance / general fitness)
2. Preferred workout style / category (calisthenics / weightlifting / cardio / yoga-pilates / mixed / other)
3. Available equipment — pick the best match: full gym / home gym (barbell + rack) / dumbbells / bodyweight only / resistance bands / machines only / kettlebells / a custom mix of several / other
4. Training experience level (beginner <1yr / intermediate 1–3yr / advanced 3+yr)
5. Days per week they can train (1–6)
6. Target session length in minutes (30 / 45 / 60 / 90)
7. Preferred weight units (kg or lb)
8. Current body weight — ask for a number in the unit they just chose (e.g. "75 kg" or "165 lb"). Mention they can skip if they'd rather not share. This is used to calibrate starting loads and progressions.

Optional (ask only if the conversation feels natural):
9. Their name
10. Any injuries or preferences

ASK ONLY ONE QUESTION PER TURN.

IMPORTANT — every time you ask a question (i.e. NOT on the [DONE] turn), the LAST line of your reply MUST be a topic tag naming which item the question collects:
[TOPIC: <id>]
where <id> is EXACTLY ONE of: goal, style, equipment, experience, days, session_length, units, bodyweight, name, injuries.
Map the numbered items above to ids: 1→goal, 2→style, 3→equipment, 4→experience, 5→days, 6→session_length, 7→units, 8→bodyweight, 9→name, 10→injuries.
The app renders the tappable answer chips from this tag, so it MUST match the question you actually asked. Output the tag verbatim on its own final line. Examples:
- "What's your main fitness goal?" → [TOPIC: goal]
- "How long would you like each training session to be?" → [TOPIC: session_length]
- "How long have you been training?" → [TOPIC: experience]
Do NOT write the answer options yourself — only the [TOPIC] tag.

Once you have answers for items 1–8, end with a short friendly closing sentence then:
[DONE]
{"goal":"<strength|hypertrophy|weight_loss|endurance|general>","category":"<calisthenics|weightlifting|cardio|yoga_pilates|mixed|other>","equipment":"<full_gym|home_gym|dumbbells|bodyweight|resistance_bands|machines|kettlebells|mixed|other>","equipmentMix":["item1","item2"],"experience":"<beginner|intermediate|advanced>","daysPerWeek":<1-6>,"sessionMinutes":<30|45|60|90>,"units":"<kg|lb>","bodyweightKg":<number or null>,"name":"<name or empty string>","notes":"<notes or empty string>"}
Notes:
- Only include "equipmentMix" when equipment is "mixed". List the specific items the user mentioned (e.g. ["Dumbbells","Resistance bands","Bodyweight"]).
- "bodyweightKg" stores the numeric value the user gave (e.g. 75 for "75 kg", 165 for "165 lb"). Set to null if skipped.

Do NOT include a [TOPIC: ...] tag on the [DONE] turn.`;

// ── Onboarding question topics → answer chips ────────────────────────────────
// Robustness model: we do NOT guess the question's topic from prose as the
// primary signal (that proved fragile — e.g. "training session" wrongly read as
// the "experience" topic). Instead the model emits an explicit [TOPIC: <id>]
// tag (see CHAT_SYSTEM) which we map to canonical chips here. Keyword detection
// (classifyTopic) is only a fallback for when the tag is missing/invalid.
//
// TOPIC_CHIPS is the single source of truth for the chips of every question —
// changing the wording of an option is a one-line edit here.
type OnboardingTopic =
  | "goal" | "style" | "equipment" | "experience" | "days"
  | "session_length" | "units" | "bodyweight" | "name" | "injuries";

const TOPIC_CHIPS: Record<OnboardingTopic, string[]> = {
  goal: ["Build muscle", "Lose weight", "Get stronger", "Stay fit"],
  style: ["Calisthenics", "Weightlifting", "Cardio", "Mixed"],
  equipment: ["Full gym", "Bodyweight", "Dumbbells", "Resistance bands", "Custom mix"],
  experience: ["Beginner (<1 yr)", "Intermediate (1–3 yrs)", "Advanced (3+ yrs)"],
  days: ["3 days", "4 days", "5 days", "2 days"],
  session_length: ["45 min", "60 min", "30 min", "90 min"],
  units: ["kg", "lb"],
  bodyweight: ["Skip"],
  name: ["Skip"],
  injuries: ["No injuries", "Skip"],
};

const TOPIC_MARKER = /\[TOPIC:\s*([a-z_]+)\s*\]/i;

// Read the model's explicit topic tag. Returns undefined if absent or not a
// recognised id (so the caller falls back to the keyword classifier).
function parseTopic(raw: string): OnboardingTopic | undefined {
  const id = raw.match(TOPIC_MARKER)?.[1]?.toLowerCase();
  return id && id in TOPIC_CHIPS ? (id as OnboardingTopic) : undefined;
}

// Focus topic-detection on the actual question, not the recap of the previous
// answer. Replies usually open with an acknowledgement (e.g. "Got it, a mix of
// calisthenics and cardio!") that echoes earlier keywords — matching on the full
// text would wrongly classify an EQUIPMENT question as a workout-style one.
function questionText(text: string): string {
  const sentences = text.split(/(?<=[?!.])\s+/);
  const questions = sentences.filter((s) => s.includes("?"));
  return (questions.length ? questions.join(" ") : text).toLowerCase();
}

// Fallback classifier used ONLY when the model omits a valid [TOPIC] tag.
// Ordered most-specific-first and the easily-confused pairs are disambiguated so
// no question can fall through to the wrong topic:
//   • session_length is tested BEFORE experience, and the experience pattern is
//     anchored to "been training / experience level" phrasing so a "training
//     session" question can never be read as experience.
//   • bodyweight is tested BEFORE units so "weigh in kg" isn't read as units.
function classifyTopic(text: string): OnboardingTopic | undefined {
  const t = questionText(text);
  if (/\bgoal\b|fitness goal|main goal|primary goal|trying to achieve|looking to (achieve|do|get)|what.*objective|\baim\b/.test(t))
    return "goal";
  // units BEFORE style — "prefer to see weights in kg/lb" contains the word
  // "weights" which the style pattern previously caught first.
  // bodyweight also BEFORE units — the bodyweight question may mention kg/lb.
  if (/how much.*weigh|current (body ?)?weight|\bbody ?weight\b|what.*you weigh|your (body ?)?weight\b|weigh (currently|right now)/.test(t))
    return "bodyweight";
  if (/which units?|what units?|prefer.*(kg|lb|kilograms?|pounds?)|kg or lb|lb or kg|metric or imperial|measure.*weights? in|\bweight units?\b/.test(t))
    return "units";
  // "weights" removed from style pattern — it's too generic and clashes with
  // the units question ("prefer to see weights in kg"). Use "weightlifting" instead.
  if (/workout style|training style|style of (workout|training)|type of (workout|training)|\bcalisthenics\b|\bweightlifting\b|\byoga\b|\bpilates\b|prefer.*(cardio|weightlifting|bodyweight movement)/.test(t))
    return "style";
  if (/\bequipment\b|\bgear\b|what.*(have|own|access).*(train|work ?out|gym|equipment|gear|weights?)|do you (have|own).*(equipment|gym|dumbbell|barbell|kettlebell|band|machine|weight|\bbar\b|rack|gear)|access to (a |an )?(gym|equipment|weights?|dumbbell|barbell|machine)|\bgym\b|dumbbell|barbell|kettlebell|resistance band|machines?\b/.test(t))
    return "equipment";
  // session_length BEFORE experience so "training session" can't match experience.
  if (/how long.*(session|workout)|session.*(length|long|duration|last|be\b)|each (session|workout).*(long|last|be)|(minutes?|mins?).*(per|each|a) (session|workout|day)|how many minutes|duration.*(session|workout)|session length/.test(t))
    return "session_length";
  if (/how many days|days (per|a) week|days.*(train|workout|week)|times (per|a) week|how often.*(train|week)|train.*per week/.test(t))
    return "days";
  if (/\bexperience\b|experience level|how experienced|(training|lifting|workout|fitness) experience|how (long|many years) have you (been )?(training|lifting|working out|exercising)|been (training|lifting) for|new to (training|lifting|the gym|fitness|working out)|\bbeginner\b|\bintermediate\b|\badvanced\b/.test(t))
    return "experience";
  if (/your name|what.*name|call you/.test(t))
    return "name";
  if (/injur|limitation|\bpain\b|niggle|medical|condition|any preference/.test(t))
    return "injuries";
  return undefined;
}

// Resolve the chips for a model reply. Priority: explicit [TOPIC] tag → keyword
// classifier → the model's free-form [SUGGESTIONS] line (legacy fallback).
function resolveSuggestions(raw: string, text: string): string[] | undefined {
  const topic = parseTopic(raw) ?? classifyTopic(text);
  if (topic) return TOPIC_CHIPS[topic];
  const sug = raw.match(/\[SUGGESTIONS:\s*([^\]]+)\]/i);
  return sug ? sug[1].split("|").map((s) => s.trim()).filter(Boolean) : undefined;
}

export async function chatOnboarding(messages: ChatMessage[]): Promise<ChatReply> {
  const key = config.geminiApiKey.trim();
  if (!key) {
    return {
      type: "done",
      text: "Great! Let me build your program now.",
      profile: { name: "", goal: "general", category: "mixed", equipment: "full_gym", experience: "beginner", daysPerWeek: 3, sessionMinutes: 60, units: "kg", notes: "" },
    };
  }

  // Gemini requires at least one user turn.
  const contents =
    messages.length > 0
      ? messages.map((m) => ({ role: m.role, parts: [{ text: m.content }] }))
      : [{ role: "user", parts: [{ text: "Hi, I'd like to set up my training program." }] }];

  const res = await fetch(ENDPOINT(config.geminiModel, key), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: CHAT_SYSTEM }] },
      contents,
      generationConfig: { temperature: 0.7 },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429) throw new Error("QUOTA_EXCEEDED");
    throw new Error(`Gemini chat error ${res.status}: ${body.slice(0, 300)}`);
  }

  const data: any = await res.json();
  const raw: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!raw) throw new Error("Gemini returned an empty chat response.");

  // Detect the [DONE] marker and extract the trailing JSON profile.
  const doneIdx = raw.indexOf("[DONE]");
  if (doneIdx !== -1) {
    const jsonStr = raw.slice(doneIdx + 6).trim();
    const closingText = raw.slice(0, doneIdx).trim();
    try {
      const p = JSON.parse(jsonStr);
      const VALID_CATS = ["calisthenics","weightlifting","cardio","yoga_pilates","mixed","other"];
      const VALID_EQ = ["full_gym","home_gym","dumbbells","bodyweight","resistance_bands","machines","kettlebells","mixed","other"];
      const profile: UserProfile = {
        name: p.name ?? "",
        goal: p.goal ?? "general",
        category: VALID_CATS.includes(p.category) ? p.category : "mixed",
        equipment: VALID_EQ.includes(p.equipment) ? p.equipment : "full_gym",
        equipmentMix: Array.isArray(p.equipmentMix) && p.equipmentMix.length ? p.equipmentMix : undefined,
        experience: p.experience ?? "beginner",
        daysPerWeek: Number(p.daysPerWeek) || 3,
        sessionMinutes: Number(p.sessionMinutes) || 60,
        units: p.units === "lb" ? "lb" : "kg",
        bodyweightKg: p.bodyweightKg != null ? Number(p.bodyweightKg) || undefined : undefined,
        notes: p.notes ?? "",
      };
      return { type: "done", text: closingText || "Perfect, building your program now!", profile };
    } catch {
      throw new Error("Failed to parse profile from AI response.");
    }
  }

  // Strip the control markers ([TOPIC]/[SUGGESTIONS]) before showing the text,
  // then resolve chips: explicit topic tag → keyword classifier → legacy line.
  const text = raw
    .replace(TOPIC_MARKER, "")
    .replace(/\[SUGGESTIONS:[^\]]*\]/i, "")
    .trim();
  const suggestions = resolveSuggestions(raw, text);

  return { type: "question", text, suggestions };
}

// ── Ongoing coaching chat (for already-onboarded users) ──────────────────────
// Unlike chatOnboarding, this never re-runs the interview. It answers training
// questions and adjusts the existing routines on request, using a stronger model
// with thinking + Google Search grounding for accurate, current advice.

export interface CoachReply {
  type: "message" | "update" | "log";
  text: string;
  suggestions?: string[];
  program?: AIProgramResponse; // present when type === "update"
  workout?: LoggedWorkoutDraft; // present when type === "log"
}

// A completed session the athlete described in free text, translated by the
// coach into concrete exercises ready to persist to their history.
export interface LoggedWorkoutDraft {
  routineName: string;
  durationSec: number;
  exercises: {
    name: string;
    muscleGroup: MuscleGroup;
    equipment?: string;
    restSeconds: number;
    notes?: string;
    sets: { reps: number; weight: number }[];
  }[];
}

// Defensive normalizer for the [LOG] JSON the model emits — clamps muscle
// groups to the valid enum, drops empty sets/exercises and coerces numbers so a
// slightly-malformed reply can still be saved.
function normalizeLoggedWorkout(w: any): LoggedWorkoutDraft {
  const rawExercises = Array.isArray(w?.exercises) ? w.exercises : [];
  const exercises = rawExercises
    .map((e: any) => ({
      name: typeof e?.name === "string" && e.name.trim() ? e.name.trim() : "Exercise",
      muscleGroup: VALID_GROUPS.includes(e?.muscleGroup as MuscleGroup)
        ? (e.muscleGroup as MuscleGroup)
        : "Full Body",
      equipment: typeof e?.equipment === "string" && e.equipment.trim() ? e.equipment.trim() : undefined,
      restSeconds: Number(e?.restSeconds) > 0 ? Math.round(Number(e.restSeconds)) : 60,
      notes: typeof e?.notes === "string" && e.notes.trim() ? e.notes.trim() : undefined,
      sets: (Array.isArray(e?.sets) ? e.sets : [])
        .map((s: any) => ({
          reps: Math.max(0, Math.round(Number(s?.reps) || 0)),
          weight: Math.max(0, Number(s?.weight) || 0),
        }))
        .filter((s: { reps: number }) => s.reps > 0),
    }))
    .filter((e: { sets: unknown[] }) => e.sets.length > 0);
  return {
    routineName:
      typeof w?.routineName === "string" && w.routineName.trim()
        ? w.routineName.trim()
        : "Logged Workout",
    durationSec: Number(w?.durationSec) > 0 ? Math.round(Number(w.durationSec)) : 0,
    exercises,
  };
}

function coachSystem(p: UserProfile, routines: unknown): string {
  const catLabel = CATEGORY_TEXT[p.category ?? "mixed"] ?? "Mixed training";
  const eqLabel = p.equipment === "mixed" && p.equipmentMix?.length
    ? `Custom mix: ${p.equipmentMix.join(", ")}`
    : EQUIPMENT_TEXT[p.equipment] ?? p.equipment;
  return `You are ForgeFit's ongoing AI personal coach for an athlete who has ALREADY completed onboarding.
You already know everything about them — NEVER re-ask onboarding questions (goal, equipment, days, etc.).

Athlete profile (JSON):
${JSON.stringify(p)}
Equipment detail: ${eqLabel}
Preferred workout style: ${catLabel}

${equipmentConstraintBlock(p, allowedTokens(p))}

Their current routines (JSON):
${JSON.stringify(routines)}

How to behave:
- Answer training, programming, form, recovery and nutrition questions concisely and accurately. Use evidence-based, up-to-date guidance (you have search grounding — use it for anything that benefits from current information).
- Always honor the athlete's stated preferences (e.g. if they like biking or prefer calisthenics, weave that into your advice and any routine you build).
- If a request is ambiguous, ask ONE short clarifying question — never a full questionnaire.

When the athlete asks to change, adjust, improve, regenerate, rebuild, add to, or otherwise MODIFY their routines/program:
1. Write a short confirmation sentence describing what you changed and why.
2. Then, on a NEW line, output the marker [UPDATE] immediately followed by a single JSON object (and nothing after it) matching EXACTLY this schema:
[UPDATE]
{"programName":"...","weeks":<int>,"summary":"<concise explanation of the changes>","routines":[{"name":"...","dayLabel":"...","description":"...","exercises":[{"name":"...","muscleGroup":"<Chest|Back|Shoulders|Biceps|Triceps|Legs|Glutes|Core|Cardio|Full Body>","equipment":"...","restSeconds":<int>,"notes":"...","sets":[{"reps":<int>,"weight":<number>,"rpe":<number>}]}]}]}
   - Build the COMPLETE updated program (all routines), not just the changed parts.
   - Keep roughly ${p.daysPerWeek} routines unless the athlete asks for a different number.
   - Apply their preferences and use realistic loads for a ${p.experience} athlete (weight 0 for bodyweight moves).
   - EVERY exercise MUST obey the equipment constraints above — never program gear the athlete doesn't have.

When the athlete TELLS you what they ALREADY DID / completed (e.g. "I did 1 hour of biking and 5 tibetans", "just finished 4x10 bench at 60kg", "ran 5k this morning", "30 min yoga + 50 push-ups") — i.e. they are REPORTING a finished session, not asking you to change their plan — translate it into a logged workout and save it:
1. Use your knowledge to expand shorthand and named routines into concrete exercises. Examples: the "Five Tibetan Rites" (a.k.a. "5 tibetans") = 5 distinct exercises, each traditionally 21 reps; a "5k run" ≈ 25–30 min of cardio. Honor the athlete's wording.
2. If an ESSENTIAL detail is missing, ask ONE short clarifying question and ask for missing details ONE AT A TIME across turns (never a long list). Essential = which exercises, and for each either the reps×sets (strength) or the duration (cardio/holds). Weight is OPTIONAL — assume bodyweight (weight 0) when not stated and do NOT ask for it unless it clearly matters. Do not ask about anything you can reasonably infer.
3. Once you have enough, write ONE short confirmation sentence of what you're logging, then on a NEW line output the marker [LOG] immediately followed by a single JSON object (and NOTHING after it) matching EXACTLY this schema:
[LOG]
{"routineName":"...","durationSec":<int>,"exercises":[{"name":"...","muscleGroup":"<Chest|Back|Shoulders|Biceps|Triceps|Legs|Glutes|Core|Cardio|Full Body>","equipment":"...","restSeconds":<int>,"notes":"...","sets":[{"reps":<int>,"weight":<number>}]}]}
   - routineName: a short title for the session (e.g. "Biking + Five Tibetans").
   - durationSec: your best estimate of the TOTAL session length in seconds.
   - One set object PER set actually performed. weight is in ${p.units} (use 0 for bodyweight moves).
   - For TIME-BASED cardio or holds (biking, running, rowing, plank, etc.): use a SINGLE set with reps = the total MINUTES performed and weight = 0, and put the real duration in "notes" (e.g. "60 min steady ride").
   - muscleGroup MUST be one of the allowed values; use "Cardio" for conditioning work.
[LOG] and [UPDATE] are MUTUALLY EXCLUSIVE — logging a past session never modifies the athlete's program, so never emit both in one reply.

For purely informational replies, do NOT output [UPDATE] or [LOG]. You MAY append a final line [SUGGESTIONS: option | option | option] with 2-4 short, relevant follow-up actions (e.g. "Make it harder | Add more cardio | Explain this plan").`;
}

export async function chatCoach(
  messages: ChatMessage[],
  profile: UserProfile,
  routines: unknown
): Promise<CoachReply> {
  const key = config.geminiApiKey.trim();
  if (!key) {
    return {
      type: "message",
      text: "AI coaching is unavailable right now — the server has no Gemini API key configured. You can still edit your routines manually from the Routines tab.",
    };
  }

  const contents = messages.map((m) => ({ role: m.role, parts: [{ text: m.content }] }));

  const res = await fetch(ENDPOINT(config.coachModel, key), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: coachSystem(profile, routines) }] },
      contents,
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.7 },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429) throw new Error("QUOTA_EXCEEDED");
    throw new Error(`Gemini coach error ${res.status}: ${body.slice(0, 300)}`);
  }

  const data: any = await res.json();
  const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
  const raw: string = parts.map((p) => p?.text ?? "").join("").trim();
  if (!raw) throw new Error("Gemini returned an empty coach response.");

  // Workout-logging path: the athlete described a session they completed.
  const logIdx = raw.indexOf("[LOG]");
  if (logIdx !== -1) {
    const after = raw.slice(logIdx + 5);
    const start = after.indexOf("{");
    const end = after.lastIndexOf("}");
    const closingText = raw.slice(0, logIdx).trim();
    if (start !== -1 && end > start) {
      try {
        const workout = normalizeLoggedWorkout(JSON.parse(after.slice(start, end + 1)));
        if (workout.exercises.length) {
          return { type: "log", text: closingText || "Logged your session! 💪", workout };
        }
      } catch {
        // Fall through to the clarifying message below.
      }
    }
    // Marker present but we couldn't build a valid workout — never leak the raw
    // [LOG] JSON to the user; ask them to clarify instead.
    return {
      type: "message",
      text:
        closingText ||
        "I couldn't quite parse that workout — tell me which exercises you did and the reps or duration for each, and I'll log it.",
    };
  }

  // Routine-update path.
  const updIdx = raw.indexOf("[UPDATE]");
  if (updIdx !== -1) {
    const after = raw.slice(updIdx + 8);
    const start = after.indexOf("{");
    const end = after.lastIndexOf("}");
    const closingText = raw.slice(0, updIdx).trim();
    if (start !== -1 && end > start) {
      try {
        const parsed = normalize(JSON.parse(after.slice(start, end + 1)) as AIProgramResponse);
        // Same equipment guard as initial generation: verify, repair, filter.
        const program = await ensureEquipmentCompliant(profile, parsed);
        return { type: "update", text: closingText || "Done — I've updated your program.", program };
      } catch {
        // Fall through to a plain message if the JSON was malformed.
        return { type: "message", text: closingText || "I tried to update your program but couldn't format the changes. Could you rephrase what you'd like changed?" };
      }
    }
  }

  // Conversational path with optional suggestion chips.
  const sugMatch = raw.match(/\[SUGGESTIONS:\s*([^\]]+)\]/i);
  const suggestions = sugMatch
    ? sugMatch[1].split("|").map((s) => s.trim()).filter(Boolean)
    : undefined;
  const text = raw.replace(/\[SUGGESTIONS:[^\]]*\]/i, "").trim();
  return { type: "message", text, suggestions };
}

// ── On-demand exercise how-to guide generation ───────────────────────────────
// When the AI invents an exercise that isn't in the client's hardcoded guide
// library, we generate full form guidance the first time a user opens its
// "How to perform" sheet, then cache it (server-side) so it's permanent.

// Movement archetypes the client's animated stick-figure can render, plus the
// load (what's in the hands) and prop (supporting surface). The AI classifies
// each exercise into these so the demo matches the movement instead of relying
// on the client's keyword guessing. Keep these lists in sync with the client
// (web/src/lib/animations.ts).
export const GUIDE_PATTERNS = [
  "squat", "hinge", "press_flat", "press_over", "raise", "row", "pulldown",
  "curl", "extension", "lunge", "bridge", "core", "leg_machine", "calf", "cardio",
] as const;
const GUIDE_LOADS = ["bar", "db", "none"] as const;
const GUIDE_PROPS = ["floor", "bench", "seat", "none"] as const;
type GuidePattern = (typeof GUIDE_PATTERNS)[number];
type GuideLoad = (typeof GUIDE_LOADS)[number];
type GuideProp = (typeof GUIDE_PROPS)[number];

export interface ExerciseGuide {
  primaryMuscles: string[];
  secondaryMuscles?: string[];
  steps: string[];
  cues: string[];
  mistakes: string[];
  breathing?: string;
  pattern?: GuidePattern; // drives the animated demo
  load?: GuideLoad;
  prop?: GuideProp;
}

const guideSchema = {
  type: "object",
  properties: {
    primaryMuscles: { type: "array", items: { type: "string" } },
    secondaryMuscles: { type: "array", items: { type: "string" } },
    steps: { type: "array", items: { type: "string" } },
    cues: { type: "array", items: { type: "string" } },
    mistakes: { type: "array", items: { type: "string" } },
    breathing: { type: "string" },
    pattern: { type: "string", enum: [...GUIDE_PATTERNS] },
    load: { type: "string", enum: [...GUIDE_LOADS] },
    prop: { type: "string", enum: [...GUIDE_PROPS] },
  },
  required: ["primaryMuscles", "steps", "cues", "mistakes", "breathing", "pattern", "load", "prop"],
};

const GUIDE_SYSTEM = `You are an elite strength & conditioning coach writing a concise, ACCURATE how-to guide for one specific exercise.
Return ONLY valid JSON matching the schema — no prose outside JSON.
Every field must describe THIS exact exercise (respect its name and equipment) — never generic filler.
- primaryMuscles / secondaryMuscles: the muscles THIS exercise actually trains. Use these exact terms where applicable so they map to the app's muscle diagram: Chest, Upper Chest, Front Delts, Side Delts, Rear Delts, Shoulders, Traps, Biceps, Triceps, Forearms, Lats, Back, Upper Back, Lower Back, Abs, Core, Obliques, Quads, Hamstrings, Glutes, Calves. (Cardio moves can list "Cardio".)
- steps: 2–4 short, ordered execution instructions specific to this movement.
- cues: 2–3 form tips that improve quality/safety for this movement.
- mistakes: 2–3 common errors specific to this movement.
- breathing: one short sentence on the breathing pattern.
- pattern: the movement archetype that best matches how this exercise LOOKS when performed (for an animated side-view demo). Choose EXACTLY one:
  • squat — knee-dominant squat (back/front/goblet squat, leg press)
  • hinge — hip hinge (deadlift, RDL, good morning, kettlebell swing)
  • press_flat — horizontal/lying press (bench press, push-up, dip, chest fly)
  • press_over — vertical/overhead press (overhead/shoulder press, handstand/pike push-up)
  • raise — arms out to the side or front (lateral/front/rear-delt raise, reverse fly, face pull)
  • row — bent-over horizontal pull (barbell/dumbbell/cable row)
  • pulldown — vertical pull (pull-up, chin-up, lat pulldown, muscle-up)
  • curl — elbow flexion (biceps curls of any kind)
  • extension — triceps elbow extension (pushdown, skull crusher, overhead extension)
  • lunge — split-stance leg work (lunge, split squat, step-up)
  • bridge — hip extension off the floor/bench (hip thrust, glute bridge)
  • core — trunk/ab work (plank, crunch, leg raise, rollout, twist)
  • leg_machine — seated single-joint leg isolation (leg extension, leg curl)
  • calf — calf raise
  • cardio — locomotion/conditioning (run, row erg, bike, jump rope, burpee, jumping jack)
- load: what the hands hold — "bar" (barbell/EZ-bar/fixed bar), "db" (dumbbells/kettlebell/handles), or "none" (bodyweight, machine, or cardio).
- prop: supporting surface — "bench" (lying/incline on a bench), "seat" (seated machine), "floor" (standing or on the floor), or "none".
Keep every string concise and practical.`;

export async function generateExerciseGuide(
  name: string,
  muscleGroup?: string,
  equipment?: string
): Promise<ExerciseGuide> {
  const key = config.geminiApiKey.trim();
  if (!key) return fallbackGuide(muscleGroup);

  const prompt = `Exercise: ${name}
${muscleGroup ? `Primary muscle group: ${muscleGroup}` : ""}
${equipment ? `Equipment: ${equipment}` : ""}

Write the how-to guide for performing "${name}" with correct form.`;

  try {
    const res = await fetch(ENDPOINT(config.geminiModel, key), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: GUIDE_SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          responseMimeType: "application/json",
          responseSchema: guideSchema,
        },
      }),
    });
    if (!res.ok) {
      if (res.status === 429) throw new Error("QUOTA_EXCEEDED");
      throw new Error(`Gemini guide error ${res.status}`);
    }
    const data: any = await res.json();
    const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini returned an empty guide response.");
    return normalizeGuide(JSON.parse(text) as ExerciseGuide, muscleGroup);
  } catch (err) {
    if (err instanceof Error && err.message === "QUOTA_EXCEEDED") throw err;
    return fallbackGuide(muscleGroup);
  }
}

function normalizeGuide(g: ExerciseGuide, muscleGroup?: string): ExerciseGuide {
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean) : [];
  const fb = fallbackGuide(muscleGroup);
  const primary = arr(g.primaryMuscles);
  const secondary = arr(g.secondaryMuscles);
  return {
    primaryMuscles: primary.length ? primary : fb.primaryMuscles,
    secondaryMuscles: secondary.length ? secondary : undefined,
    steps: arr(g.steps).length ? arr(g.steps) : fb.steps,
    cues: arr(g.cues).length ? arr(g.cues) : fb.cues,
    mistakes: arr(g.mistakes).length ? arr(g.mistakes) : fb.mistakes,
    breathing: typeof g.breathing === "string" && g.breathing.trim() ? g.breathing.trim() : fb.breathing,
    // Only keep the animation hints if they're valid; the client falls back to
    // its own keyword guess when these are absent.
    pattern: GUIDE_PATTERNS.includes(g.pattern as GuidePattern) ? g.pattern : undefined,
    load: GUIDE_LOADS.includes(g.load as GuideLoad) ? g.load : undefined,
    prop: GUIDE_PROPS.includes(g.prop as GuideProp) ? g.prop : undefined,
  };
}

// Generic guidance used when there is no Gemini key or the call fails.
function fallbackGuide(muscleGroup?: string): ExerciseGuide {
  return {
    primaryMuscles: muscleGroup && muscleGroup !== "Full Body" ? [muscleGroup] : [],
    steps: [
      "Set up in a stable position with a braced core and neutral spine.",
      "Move through a full, controlled range of motion.",
      "Pause briefly at the peak contraction, then return under control.",
    ],
    cues: [
      "Control both the lifting and lowering phases — no momentum.",
      "Keep tension on the target muscle throughout.",
    ],
    mistakes: ["Using momentum to move the weight.", "Cutting the range of motion short."],
    breathing: "Exhale during the effort, inhale on the return.",
  };
}

// ── AI exercise identification (name → muscle group + equipment + guide) ─────
// Single-pass call: takes just a name, returns everything needed to populate
// the exercises table. Used by the "AI Assist" button in ExercisePicker.

const MUSCLE_GROUPS_ENUM = [
  "Chest", "Back", "Shoulders", "Biceps", "Triceps",
  "Legs", "Glutes", "Core", "Cardio", "Full Body",
] as const;

const identifySchema = {
  type: "object",
  properties: {
    muscleGroup: { type: "string", enum: [...MUSCLE_GROUPS_ENUM] },
    equipment: { type: "string" },
    guide: {
      type: "object",
      properties: {
        primaryMuscles: { type: "array", items: { type: "string" } },
        secondaryMuscles: { type: "array", items: { type: "string" } },
        steps: { type: "array", items: { type: "string" } },
        cues: { type: "array", items: { type: "string" } },
        mistakes: { type: "array", items: { type: "string" } },
        breathing: { type: "string" },
        pattern: { type: "string", enum: [...GUIDE_PATTERNS] },
        load: { type: "string", enum: [...GUIDE_LOADS] },
        prop: { type: "string", enum: [...GUIDE_PROPS] },
      },
      required: ["primaryMuscles", "steps", "cues", "mistakes", "breathing", "pattern", "load", "prop"],
    },
  },
  required: ["muscleGroup", "equipment", "guide"],
};

const IDENTIFY_SYSTEM = `You are an elite strength & conditioning coach.
Given an exercise name, return a JSON object with three fields:
1. "muscleGroup": the single primary muscle group from the allowed enum.
2. "equipment": short description of typical equipment (e.g. "Barbell", "Dumbbell", "Bodyweight", "Cable", "Machine", "Resistance Band").
3. "guide": a complete how-to guide for the exercise.

Guide rules — be specific to THIS exercise:
- primaryMuscles / secondaryMuscles: exact muscles trained; use: Chest, Upper Chest, Front Delts, Side Delts, Rear Delts, Shoulders, Traps, Biceps, Triceps, Forearms, Lats, Back, Upper Back, Lower Back, Abs, Core, Obliques, Quads, Hamstrings, Glutes, Calves (or "Cardio").
- steps: 2–4 short ordered execution instructions.
- cues: 2–3 form tips for quality/safety.
- mistakes: 2–3 common errors.
- breathing: one short sentence on the breathing pattern.
- pattern: movement archetype — squat | hinge | press_flat | press_over | raise | row | pulldown | curl | extension | lunge | bridge | core | leg_machine | calf | cardio.
- load: "bar" | "db" | "none".
- prop: "bench" | "seat" | "floor" | "none".
Return ONLY valid JSON — no prose outside the JSON object.`;

export async function identifyExercise(name: string): Promise<{
  muscleGroup: MuscleGroup;
  equipment: string;
  guide: ExerciseGuide;
}> {
  const key = config.geminiApiKey.trim();
  if (!key) {
    return { muscleGroup: "Full Body", equipment: "Other", guide: fallbackGuide() };
  }

  const prompt = `Identify this exercise and write a complete guide: "${name}"`;

  try {
    const res = await fetch(ENDPOINT(config.geminiModel, key), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: IDENTIFY_SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          responseMimeType: "application/json",
          responseSchema: identifySchema,
        },
      }),
    });
    if (!res.ok) {
      if (res.status === 429) throw new Error("QUOTA_EXCEEDED");
      throw new Error(`Gemini identify error ${res.status}`);
    }
    const data: any = await res.json();
    const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini returned an empty identify response.");
    const parsed = JSON.parse(text);
    const muscleGroup = (MUSCLE_GROUPS_ENUM as readonly string[]).includes(parsed.muscleGroup)
      ? (parsed.muscleGroup as MuscleGroup)
      : "Full Body";
    const equipment =
      typeof parsed.equipment === "string" && parsed.equipment.trim()
        ? parsed.equipment.trim()
        : "Other";
    const guide = normalizeGuide(parsed.guide ?? {}, muscleGroup);
    return { muscleGroup, equipment, guide };
  } catch (err) {
    if (err instanceof Error && err.message === "QUOTA_EXCEEDED") throw err;
    return { muscleGroup: "Full Body", equipment: "Other", guide: fallbackGuide() };
  }
}

// ── Local deterministic fallback (works with no Gemini key) ───────────────────
function localProgram(profile: UserProfile): AIProgramResponse {
  const bw = profile.equipment === "bodyweight";
  const w = (gym: number) => (bw ? 0 : profile.units === "lb" ? Math.round(gym * 2.2) : gym);
  const scheme =
    profile.goal === "strength" ? [5, 5, 5]
    : profile.goal === "endurance" || profile.goal === "weight_loss" ? [15, 15, 15]
    : [10, 10, 10];
  const sets = (weight: number) => scheme.map((reps) => ({ reps, weight }));

  const push: AIGeneratedRoutine = {
    name: "Push Day", dayLabel: "Day 1", description: "Chest, shoulders & triceps",
    exercises: [
      { name: bw ? "Push-up" : "Barbell Bench Press", muscleGroup: "Chest", equipment: bw ? "Bodyweight" : "Barbell", restSeconds: 120, sets: sets(w(40)) },
      { name: bw ? "Dip" : "Dumbbell Shoulder Press", muscleGroup: "Shoulders", equipment: bw ? "Bodyweight" : "Dumbbell", restSeconds: 90, sets: sets(w(15)) },
      { name: "Lateral Raise", muscleGroup: "Shoulders", equipment: "Dumbbell", restSeconds: 60, sets: sets(w(8)) },
      { name: bw ? "Plank" : "Tricep Pushdown", muscleGroup: "Triceps", equipment: bw ? "Bodyweight" : "Cable", restSeconds: 60, sets: sets(w(20)) },
    ],
  };
  const pull: AIGeneratedRoutine = {
    name: "Pull Day", dayLabel: "Day 2", description: "Back & biceps",
    exercises: [
      { name: "Pull-up", muscleGroup: "Back", equipment: "Bodyweight", restSeconds: 120, sets: sets(0) },
      { name: bw ? "Single-Arm Dumbbell Row" : "Barbell Row", muscleGroup: "Back", equipment: bw ? "Dumbbell" : "Barbell", restSeconds: 90, sets: sets(w(40)) },
      { name: "Face Pull", muscleGroup: "Shoulders", equipment: "Cable", restSeconds: 60, sets: sets(w(15)) },
      { name: bw ? "Hammer Curl" : "Barbell Curl", muscleGroup: "Biceps", equipment: bw ? "Dumbbell" : "Barbell", restSeconds: 60, sets: sets(w(20)) },
    ],
  };
  const legs: AIGeneratedRoutine = {
    name: "Leg Day", dayLabel: "Day 3", description: "Quads, hamstrings & glutes",
    exercises: [
      { name: bw ? "Goblet Squat" : "Barbell Back Squat", muscleGroup: "Legs", equipment: bw ? "Dumbbell" : "Barbell", restSeconds: 150, sets: sets(w(60)) },
      { name: "Romanian Deadlift", muscleGroup: "Legs", equipment: bw ? "Dumbbell" : "Barbell", restSeconds: 120, sets: sets(w(50)) },
      { name: "Bulgarian Split Squat", muscleGroup: "Legs", equipment: "Dumbbell", restSeconds: 90, sets: sets(w(15)) },
      { name: "Calf Raise", muscleGroup: "Legs", equipment: "Machine", restSeconds: 45, sets: sets(w(40)) },
    ],
  };
  const upper: AIGeneratedRoutine = {
    name: "Upper Body", dayLabel: "Day 1", description: "Full upper body",
    exercises: [...push.exercises.slice(0, 2), ...pull.exercises.slice(0, 2)],
  };
  const lower: AIGeneratedRoutine = {
    name: "Lower Body", dayLabel: "Day 2", description: "Full lower body",
    exercises: legs.exercises,
  };
  const full: AIGeneratedRoutine = {
    name: "Full Body", dayLabel: "Day 1", description: "Balanced full-body session",
    exercises: [push.exercises[0], pull.exercises[1], legs.exercises[0], legs.exercises[1]],
  };

  const splits: Record<number, AIGeneratedRoutine[]> = {
    1: [full], 2: [upper, lower], 3: [push, pull, legs],
    4: [upper, lower, push, pull], 5: [push, pull, legs, upper, lower],
    6: [push, pull, legs, push, pull, legs],
  };
  const chosen = splits[Math.min(6, Math.max(1, profile.daysPerWeek))] || splits[3];
  const routines = chosen.map((r, i) => ({ ...r, dayLabel: `Day ${i + 1}` }));

  return {
    programName: `${goalLabel(profile.goal)} • ${profile.daysPerWeek}-Day Split`,
    weeks: 4,
    summary: `A ${profile.daysPerWeek}-day ${goalLabel(profile.goal).toLowerCase()} program tailored to your equipment and experience. (Generated locally — set a Gemini API key on the server for fully AI-personalized programming.)`,
    routines,
  };
}
