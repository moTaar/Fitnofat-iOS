// ── Calorie estimation (MET-based) ────────────────────────────────────────────
// kcal = MET × bodyweightKg × hours. Mirror of `web/src/lib/calories.ts` (the two
// live in separate packages and can't share an import). Keep the MET tables and
// duration heuristics in sync when changing either side.

export type ExerciseKind = "strength" | "cardio" | "hold";

export const DEFAULT_BODYWEIGHT_KG = 75;

const MET: Record<ExerciseKind, { easy: number; moderate: number; hard: number }> = {
  cardio: { easy: 6, moderate: 8.5, hard: 11 },
  strength: { easy: 3.5, moderate: 5, hard: 6 },
  hold: { easy: 2.5, moderate: 3.5, hard: 4.5 },
};

const SECONDS_PER_REP = 3;

interface SetLike {
  reps?: number;
  durationSec?: number;
  rpe?: number;
}
interface ExerciseLike {
  kind?: ExerciseKind;
  muscleGroup?: string;
  restSeconds?: number;
  sets: SetLike[];
}

export function resolveKind(ex: ExerciseLike): ExerciseKind {
  if (ex.kind) return ex.kind;
  return ex.muscleGroup === "Cardio" ? "cardio" : "strength";
}

function intensityBucket(sets: SetLike[]): "easy" | "moderate" | "hard" {
  const rpes = sets
    .map((s) => s.rpe)
    .filter((r): r is number => typeof r === "number" && r > 0);
  if (!rpes.length) return "moderate";
  const avg = rpes.reduce((a, b) => a + b, 0) / rpes.length;
  if (avg <= 4) return "easy";
  if (avg <= 7) return "moderate";
  return "hard";
}

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

export function estimateExerciseCalories(
  ex: ExerciseLike,
  bodyweightKg = DEFAULT_BODYWEIGHT_KG
): number {
  const seconds = exerciseDuration(ex);
  if (seconds <= 0) return 0;
  const met = MET[resolveKind(ex)][intensityBucket(ex.sets)];
  const kcal = met * (bodyweightKg || DEFAULT_BODYWEIGHT_KG) * (seconds / 3600);
  return Math.round(kcal);
}

export function estimateSessionCalories(
  exercises: ExerciseLike[],
  bodyweightKg = DEFAULT_BODYWEIGHT_KG
): number {
  return exercises.reduce((sum, ex) => sum + estimateExerciseCalories(ex, bodyweightKg), 0);
}
