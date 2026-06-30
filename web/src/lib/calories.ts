// ── Calorie estimation (MET-based) ────────────────────────────────────────────
// kcal = MET × bodyweightKg × hours. Estimates are intentionally approximate and
// always user-editable in the UI — they exist to make progress feel alive, not
// to claim lab precision (this is exactly how Strong/Hevy/Apple treat burn).
//
// NOTE: this logic is mirrored in `server/src/calories.ts` (separate package, so
// it can't be imported). Keep the two in sync when changing the MET tables.

import type { ExerciseKind, LoggedExercise, LoggedSet, WorkoutSession } from "./types";

export const DEFAULT_BODYWEIGHT_KG = 75;

// MET values per movement family and intensity bucket. Cardio spans easy-walk to
// hard-run; strength is "weight training" (general → vigorous); holds/yoga are low.
const MET: Record<ExerciseKind, { easy: number; moderate: number; hard: number }> = {
  cardio: { easy: 6, moderate: 8.5, hard: 11 },
  strength: { easy: 3.5, moderate: 5, hard: 6 },
  hold: { easy: 2.5, moderate: 3.5, hard: 4.5 },
};

// Seconds we assume each rep of a strength movement takes (concentric + eccentric).
const SECONDS_PER_REP = 3;

type SetLike = Pick<LoggedSet, "reps" | "durationSec" | "rpe">;
type ExerciseLike = {
  kind?: ExerciseKind;
  muscleGroup?: string;
  restSeconds?: number;
  sets: SetLike[];
};

// Resolve an exercise's kind, inferring from the muscle group for legacy rows
// that predate the `kind` field.
export function resolveKind(ex: ExerciseLike): ExerciseKind {
  if (ex.kind) return ex.kind;
  return ex.muscleGroup === "Cardio" ? "cardio" : "strength";
}

function intensityBucket(sets: SetLike[]): "easy" | "moderate" | "hard" {
  const rpes = sets.map((s) => s.rpe).filter((r): r is number => typeof r === "number" && r > 0);
  if (!rpes.length) return "moderate";
  const avg = rpes.reduce((a, b) => a + b, 0) / rpes.length;
  if (avg <= 4) return "easy";
  if (avg <= 7) return "moderate";
  return "hard";
}

// Effective working duration of an exercise, in seconds.
//  • cardio/hold: explicit set durations; falls back to the legacy "reps = minutes"
//    encoding so old AI-logged sessions still estimate sensibly.
//  • strength: Σ sets × (reps × SECONDS_PER_REP) + rest between sets.
export function exerciseDuration(ex: ExerciseLike): number {
  const kind = resolveKind(ex);
  const explicit = ex.sets.reduce((sum, s) => sum + (s.durationSec ?? 0), 0);
  if (explicit > 0) return explicit;

  if (kind === "cardio" || kind === "hold") {
    // Legacy fallback: a single set whose `reps` held the minutes performed.
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

// Total cardio (+ hold) minutes in a session — used by the progress dashboard.
export function cardioMinutes(session: Pick<WorkoutSession, "exercises">): number {
  return Math.round(
    (session.exercises as LoggedExercise[])
      .filter((ex) => resolveKind(ex) !== "strength")
      .reduce((sum, ex) => sum + exerciseDuration(ex), 0) / 60
  );
}
