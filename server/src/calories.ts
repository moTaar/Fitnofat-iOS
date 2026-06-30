// ── Calorie estimation (MET-based, ACSM formula) ──────────────────────────────
// kcal/min = MET × 3.5 × bodyweightKg / 200  (ACSM, Compendium of Physical
// Activities). Mirror of `web/src/lib/calories.ts` — keep the MET tables and
// resolution logic in sync. MET resolution is layered cache → table → generic;
// a "generic" result is the signal to ask the AI for a precise MET once.

export type ExerciseKind = "strength" | "cardio" | "hold";
export type MetSource = "cache" | "table" | "generic";

export const DEFAULT_BODYWEIGHT_KG = 75;

const GENERIC_MET: Record<ExerciseKind, { easy: number; moderate: number; hard: number }> = {
  cardio: { easy: 6, moderate: 8.5, hard: 11 },
  strength: { easy: 3.5, moderate: 5, hard: 6 },
  hold: { easy: 2.5, moderate: 3.5, hard: 4.5 },
};

const MET_KEYWORDS: { re: RegExp; met: number }[] = [
  { re: /\b(jump rope|jump-rope|skipping rope|skip rope|double under)\b/, met: 11 },
  { re: /\b(sprint|sprinting|hill sprint)\b/, met: 14 },
  { re: /\b(run|running|jog|jogging|treadmill)\b/, met: 9.5 },
  { re: /\b(walk|walking|hike|hiking|ruck|rucking)\b/, met: 4.3 },
  { re: /\b(cycle|cycling|bike|biking|spin|spinning|peloton|airbike|air bike|assault bike)\b/, met: 7.5 },
  { re: /\b(row|rowing|erg|ski erg|skierg)\b/, met: 7 },
  { re: /\b(swim|swimming|laps)\b/, met: 8 },
  { re: /\b(elliptical|cross.?trainer|arc trainer)\b/, met: 5 },
  { re: /\b(stair|stairmaster|stepmill|step mill|step.?up)\b/, met: 8 },
  { re: /\b(burpee|hiit|high.?intensity|interval|metcon|circuit)\b/, met: 8 },
  { re: /\b(jumping jack|mountain climber|plyo|box jump|jump squat)\b/, met: 8 },
  { re: /\b(box|boxing|kickbox|muay|sparring|heavy bag)\b/, met: 7 },
  { re: /\b(power yoga|vinyasa|ashtanga|hot yoga)\b/, met: 4 },
  { re: /\b(yoga|tai chi|qigong|meditat)\b/, met: 2.5 },
  { re: /\b(pilates|barre)\b/, met: 3 },
  { re: /\b(stretch|mobility|foam roll|cooldown|cool.?down|warm.?up)\b/, met: 2.3 },
  { re: /\b(plank|wall sit|wall-sit|isometric|l-?sit|hollow hold|dead hang|hang)\b/, met: 3 },
];

interface SetLike {
  reps?: number;
  durationSec?: number;
  rpe?: number;
}
interface ExerciseLike {
  kind?: ExerciseKind;
  muscleGroup?: string;
  restSeconds?: number;
  name?: string;
  sets: SetLike[];
}

export function resolveKind(ex: ExerciseLike): ExerciseKind {
  if (ex.kind) return ex.kind;
  return ex.muscleGroup === "Cardio" ? "cardio" : "strength";
}

function avgRpe(sets: SetLike[]): number | null {
  const rpes = sets.map((s) => s.rpe).filter((r): r is number => typeof r === "number" && r > 0);
  if (!rpes.length) return null;
  return rpes.reduce((a, b) => a + b, 0) / rpes.length;
}

function intensityBucket(sets: SetLike[]): "easy" | "moderate" | "hard" {
  const avg = avgRpe(sets);
  if (avg == null) return "moderate";
  if (avg <= 4) return "easy";
  if (avg <= 7) return "moderate";
  return "hard";
}

function rpeMultiplier(sets: SetLike[]): number {
  const avg = avgRpe(sets);
  if (avg == null) return 1;
  return Math.min(1.3, Math.max(0.7, 0.7 + 0.06 * avg));
}

export function metFromName(name?: string): number | null {
  if (!name) return null;
  const t = ` ${name.toLowerCase()} `;
  for (const { re, met } of MET_KEYWORDS) if (re.test(t)) return met;
  return null;
}

export function resolveMet(ex: ExerciseLike, knownMet?: number | null): { met: number; source: MetSource } {
  if (knownMet && knownMet > 0) return { met: knownMet * rpeMultiplier(ex.sets), source: "cache" };
  const named = metFromName(ex.name);
  if (named != null) return { met: named * rpeMultiplier(ex.sets), source: "table" };
  return { met: GENERIC_MET[resolveKind(ex)][intensityBucket(ex.sets)], source: "generic" };
}

export function needsAiMet(ex: ExerciseLike, knownMet?: number | null): boolean {
  return resolveMet(ex, knownMet).source === "generic";
}

const SECONDS_PER_REP = 3;

export function exerciseDuration(ex: ExerciseLike): number {
  const kind = resolveKind(ex);
  const explicit = ex.sets.reduce((sum, s) => sum + (s.durationSec ?? 0), 0);
  if (explicit > 0) return explicit;
  if (kind === "cardio" || kind === "hold") {
    const legacyMinutes = ex.sets.reduce((sum, s) => sum + (s.reps ?? 0), 0);
    return legacyMinutes * 60;
  }
  const rest = ex.restSeconds ?? 60;
  return ex.sets.reduce((sum, s) => sum + (s.reps ?? 0) * SECONDS_PER_REP + rest, 0);
}

export function kcalFromMet(met: number, bodyweightKg: number, minutes: number): number {
  const kg = bodyweightKg || DEFAULT_BODYWEIGHT_KG;
  return ((met * 3.5 * kg) / 200) * minutes;
}

export function estimateExerciseCalories(
  ex: ExerciseLike,
  bodyweightKg = DEFAULT_BODYWEIGHT_KG,
  knownMet?: number | null
): number {
  const seconds = exerciseDuration(ex);
  if (seconds <= 0) return 0;
  const { met } = resolveMet(ex, knownMet);
  return Math.round(kcalFromMet(met, bodyweightKg, seconds / 60));
}
