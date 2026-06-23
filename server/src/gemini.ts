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
  full_gym: "a fully-equipped commercial gym (barbells, machines, cables, dumbbells)",
  home_gym: "a home gym with a barbell, rack, bench and adjustable dumbbells",
  dumbbells: "only a pair of adjustable dumbbells and a bench",
  bodyweight: "bodyweight only (no equipment)",
};

const SYSTEM = `You are an elite strength & conditioning coach and certified personal trainer.
You design safe, evidence-based, progressively-overloaded training programs.
You ALWAYS return valid JSON that matches the provided schema exactly — no prose outside JSON.
Use realistic starting weights for the experience level (use 0 weight for bodyweight movements).
Pick exercises that fit the available equipment. Distribute volume sensibly across the week.
muscleGroup MUST be one of: Chest, Back, Shoulders, Biceps, Triceps, Legs, Glutes, Core, Cardio, Full Body.`;

function generatePrompt(p: UserProfile): string {
  return `Create a personalized training program.

Athlete profile:
- Name: ${p.name || "Athlete"}
- Primary goal: ${goalLabel(p.goal)}
- Experience: ${p.experience}
- Equipment available: ${EQUIPMENT_TEXT[p.equipment]}
- Training days per week: ${p.daysPerWeek}
- Target session length: ${p.sessionMinutes} minutes
- Units: ${p.units}
${p.bodyweightKg ? `- Bodyweight: ${p.bodyweightKg} ${p.units}` : ""}
${p.notes ? `- Notes / limitations: ${p.notes}` : ""}

Produce exactly ${p.daysPerWeek} distinct routines (one per training day).
Each routine should contain 4-7 exercises appropriate to the goal.
Provide a concise "summary" (2-3 sentences) explaining the program design rationale.`;
}

function refreshPrompt(p: UserProfile, analytics: string): string {
  return `The athlete has completed a training block. Evolve their program for the NEXT iteration.

Athlete profile:
- Goal: ${goalLabel(p.goal)}
- Experience: ${p.experience}
- Equipment: ${EQUIPMENT_TEXT[p.equipment]}
- Days per week: ${p.daysPerWeek}
- Units: ${p.units}

Recent performance analytics:
${analytics}

Apply intelligent progression:
- Increase load/reps on exercises that are progressing well (progressive overload).
- Swap out exercises that have STALLED (no progress / plateaued) for effective alternatives.
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
