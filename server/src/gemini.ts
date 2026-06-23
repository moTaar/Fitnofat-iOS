import { config } from "./config";
import { goalLabel } from "./util";
import type {
  AIGeneratedRoutine,
  AIProgramResponse,
  MuscleGroup,
  UserProfile,
} from "./types";

const ENDPOINT = (model: string, key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

const responseSchema = {
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
                equipment: { type: "string" },
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
Pick exercises that fit the available equipment AND the athlete's preferred workout style/category.
Distribute volume sensibly across the week.
muscleGroup MUST be one of: Chest, Back, Shoulders, Biceps, Triceps, Legs, Glutes, Core, Cardio, Full Body.`;

function equipmentDescription(p: UserProfile): string {
  if (p.equipment === "mixed" && p.equipmentMix?.length) {
    return `a custom mix: ${p.equipmentMix.join(", ")}`;
  }
  return EQUIPMENT_TEXT[p.equipment] ?? "equipment the athlete describes in their notes";
}

function generatePrompt(p: UserProfile): string {
  return `Create a personalized training program.

Athlete profile:
- Name: ${p.name || "Athlete"}
- Primary goal: ${goalLabel(p.goal)}
- Preferred workout style: ${CATEGORY_TEXT[p.category ?? "mixed"]}
- Experience: ${p.experience}
- Equipment available: ${equipmentDescription(p)}
- Training days per week: ${p.daysPerWeek}
- Target session length: ${p.sessionMinutes} minutes
- Units: ${p.units}
${p.bodyweightKg ? `- Bodyweight: ${p.bodyweightKg} ${p.units}` : ""}
${p.notes ? `- Notes / limitations: ${p.notes}` : ""}

Produce exactly ${p.daysPerWeek} distinct routines (one per training day).
Each routine should contain 4-7 exercises that strongly reflect the athlete's preferred workout style.
Provide a concise "summary" (2-3 sentences) explaining the program design rationale.`;
}

function refreshPrompt(p: UserProfile, analytics: string): string {
  return `The athlete has completed a training block. Evolve their program for the NEXT iteration.

Athlete profile:
- Goal: ${goalLabel(p.goal)}
- Preferred workout style: ${CATEGORY_TEXT[p.category ?? "mixed"]}
- Experience: ${p.experience}
- Equipment: ${equipmentDescription(p)}
- Days per week: ${p.daysPerWeek}
- Units: ${p.units}

Recent performance analytics:
${analytics}

Apply intelligent progression:
- Increase load/reps on exercises that are progressing well (progressive overload).
- Swap out exercises that have STALLED (no progress / plateaued) for effective alternatives that still match the preferred workout style.
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

async function callGemini(prompt: string): Promise<AIProgramResponse> {
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
        responseSchema,
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

export async function generateProgram(p: UserProfile): Promise<AIProgramResponse> {
  try {
    return await callGemini(generatePrompt(p));
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
    return await callGemini(refreshPrompt(p, analytics));
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

Optional (ask only if the conversation feels natural):
8. Their name
9. Any injuries or preferences

IMPORTANT — after every question (not at [DONE]), append a suggestions line on its own line:
[SUGGESTIONS: option1 | option2 | option3 | option4]
Tailor the options to the question. Examples:
- Goal question → [SUGGESTIONS: Build muscle | Lose weight | Get stronger | Stay fit]
- Category question → [SUGGESTIONS: Calisthenics | Weightlifting | Mixed | Cardio]
- Equipment question → [SUGGESTIONS: Full gym | Bodyweight | Dumbbells | Resistance bands | Custom mix]
- Experience question → [SUGGESTIONS: Beginner (<1 yr) | Intermediate (1–3 yrs) | Advanced (3+ yrs)]
- Days/week question → [SUGGESTIONS: 3 days | 4 days | 5 days | 2 days]
- Session length question → [SUGGESTIONS: 45 min | 60 min | 30 min | 90 min]
- Units question → [SUGGESTIONS: kg | lb]
- Name question → [SUGGESTIONS: Skip]
- Injuries/preferences question → [SUGGESTIONS: No injuries | Skip]
Use 2–5 short options that cover the most common answers. Keep each option under 25 chars.

Once you have answers for items 1–7, end with a short friendly closing sentence then:
[DONE]
{"goal":"<strength|hypertrophy|weight_loss|endurance|general>","category":"<calisthenics|weightlifting|cardio|yoga_pilates|mixed|other>","equipment":"<full_gym|home_gym|dumbbells|bodyweight|resistance_bands|machines|kettlebells|mixed|other>","equipmentMix":["item1","item2"],"experience":"<beginner|intermediate|advanced>","daysPerWeek":<1-6>,"sessionMinutes":<30|45|60|90>,"units":"<kg|lb>","name":"<name or empty string>","notes":"<notes or empty string>"}
Note: only include "equipmentMix" when equipment is "mixed". List the specific items the user mentioned (e.g. ["Dumbbells","Resistance bands","Bodyweight"]).

Do NOT include [SUGGESTIONS: ...] on the [DONE] line.`;

function detectOnboardingSuggestions(text: string): string[] | undefined {
  const t = text.toLowerCase();
  if (/goal|aim|objective|trying to|want to achieve|looking to/.test(t))
    return ["Build muscle", "Lose weight", "Get stronger", "Stay fit"];
  if (/style|type of (workout|training)|calisthenics|weightlifting|cardio|yoga|mix/.test(t))
    return ["Calisthenics", "Weightlifting", "Cardio", "Mixed"];
  if (/equipment|gym|dumbbells|bodyweight|resistance|machine|kettlebell/.test(t))
    return ["Full gym", "Bodyweight", "Dumbbells", "Resistance bands", "Custom mix"];
  if (/experience|beginner|intermediate|advanced|how long.*train|trained|training for/.test(t))
    return ["Beginner (<1 yr)", "Intermediate (1–3 yrs)", "Advanced (3+ yrs)"];
  if (/days.*(per|a) week|how (many|often).*day|times.*(per|a) week|days.*train/.test(t))
    return ["3 days", "4 days", "5 days", "2 days"];
  if (/minute|session.*(length|long|duration)|how long.*session|long.*workout|each.*session/.test(t))
    return ["45 min", "60 min", "30 min", "90 min"];
  if (/unit|kg\b|lb\b|pound|kilogram/.test(t))
    return ["kg", "lb"];
  return undefined;
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
        notes: p.notes ?? "",
      };
      return { type: "done", text: closingText || "Perfect, building your program now!", profile };
    } catch {
      throw new Error("Failed to parse profile from AI response.");
    }
  }

  // Parse optional [SUGGESTIONS: a | b | c] marker from the question.
  const sugMatch = raw.match(/\[SUGGESTIONS:\s*([^\]]+)\]/i);
  const text = raw.replace(/\[SUGGESTIONS:[^\]]*\]/i, "").trim();
  // Always guarantee topic-appropriate chips — Gemini sometimes omits or repeats wrong ones.
  const suggestions = detectOnboardingSuggestions(text) ??
    (sugMatch ? sugMatch[1].split("|").map((s) => s.trim()).filter(Boolean) : undefined);

  return { type: "question", text, suggestions };
}

// ── Ongoing coaching chat (for already-onboarded users) ──────────────────────
// Unlike chatOnboarding, this never re-runs the interview. It answers training
// questions and adjusts the existing routines on request, using a stronger model
// with thinking + Google Search grounding for accurate, current advice.

export interface CoachReply {
  type: "message" | "update";
  text: string;
  suggestions?: string[];
  program?: AIProgramResponse; // present when type === "update"
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

For purely informational replies, do NOT output [UPDATE]. You MAY append a final line [SUGGESTIONS: option | option | option] with 2-4 short, relevant follow-up actions (e.g. "Make it harder | Add more cardio | Explain this plan").`;
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

  // Routine-update path.
  const updIdx = raw.indexOf("[UPDATE]");
  if (updIdx !== -1) {
    const after = raw.slice(updIdx + 8);
    const start = after.indexOf("{");
    const end = after.lastIndexOf("}");
    const closingText = raw.slice(0, updIdx).trim();
    if (start !== -1 && end > start) {
      try {
        const program = normalize(JSON.parse(after.slice(start, end + 1)) as AIProgramResponse);
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

export interface ExerciseGuide {
  primaryMuscles: string[];
  secondaryMuscles?: string[];
  steps: string[];
  cues: string[];
  mistakes: string[];
  breathing?: string;
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
  },
  required: ["primaryMuscles", "steps", "cues", "mistakes", "breathing"],
};

const GUIDE_SYSTEM = `You are an elite strength & conditioning coach writing a concise how-to guide for a single exercise.
Return ONLY valid JSON matching the schema — no prose outside JSON.
- primaryMuscles / secondaryMuscles: anatomical muscle names. Use these exact terms where applicable so they map to the app's muscle diagram: Chest, Upper Chest, Front Delts, Side Delts, Rear Delts, Shoulders, Traps, Biceps, Triceps, Forearms, Lats, Back, Upper Back, Lower Back, Abs, Core, Obliques, Quads, Hamstrings, Glutes, Calves. (Cardio moves can list "Cardio".)
- steps: 2–4 short, ordered execution instructions.
- cues: 2–3 form tips that improve quality/safety.
- mistakes: 2–3 common errors to avoid.
- breathing: one short sentence on breathing pattern.
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
