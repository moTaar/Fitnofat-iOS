// Muscle regions shared by the per-exercise MuscleMap and the History heatmap,
// plus the training-load model behind the heatmap.
//
// The heatmap answers "which muscles am I training, and which am I leaving
// behind?". Every logged set deposits load on the muscles it works (a full set
// on the primary movers, half on the secondaries), and that load decays with a
// one-week half-life. So a muscle glows while you keep hitting it and fades if
// you stop — balance shows up as an even body, neglect as a pale patch.

import type { Exercise, ExerciseGuide, LoggedExercise, MuscleGroup, WorkoutSession } from "./types";
import { guideFor, hasGuide } from "./guides";
import { resolveKind } from "./calories";

export type MuscleRegion =
  | "chest" | "delts" | "delts_b" | "traps" | "biceps" | "triceps" | "forearms"
  | "lats" | "lowerback" | "abs" | "obliques" | "quads" | "hamstrings" | "glutes" | "calves";

export const REGION_LABEL: Record<MuscleRegion, string> = {
  chest: "Chest",
  delts: "Front delts",
  delts_b: "Rear delts",
  traps: "Traps",
  biceps: "Biceps",
  triceps: "Triceps",
  forearms: "Forearms",
  lats: "Lats & upper back",
  lowerback: "Lower back",
  abs: "Abs",
  obliques: "Obliques",
  quads: "Quads",
  hamstrings: "Hamstrings",
  glutes: "Glutes",
  calves: "Calves",
};

export const REGIONS = Object.keys(REGION_LABEL) as MuscleRegion[];

const FULL_BODY: MuscleRegion[] = ["quads", "glutes", "hamstrings", "chest", "lats", "delts", "abs"];

// Keyword → regions, most specific first. Guides and AI output name muscles
// loosely ("Upper Chest", "Front Delts", "Legs"), so this is a prefix match —
// and each phrase is consumed once matched, so "Front Delts" doesn't also hit
// the generic "delt" and light up the rear delts, nor "Lower back" the lats.
const KEYWORD_REGIONS: [string, MuscleRegion[]][] = [
  ["full body", FULL_BODY],
  ["upper chest", ["chest"]],
  ["front delt", ["delts"]],
  ["rear delt", ["delts_b"]],
  ["side delt", ["delts", "delts_b"]],
  ["lower back", ["lowerback"]],
  ["upper back", ["lats", "traps"]],
  ["mid back", ["lats"]],
  ["erector", ["lowerback"]],
  ["chest", ["chest"]],
  ["shoulder", ["delts", "delts_b"]],
  ["delt", ["delts", "delts_b"]],
  ["trap", ["traps"]],
  ["bicep", ["biceps"]],
  ["brachialis", ["biceps"]],
  ["tricep", ["triceps"]],
  ["forearm", ["forearms"]],
  ["grip", ["forearms"]],
  ["arms", ["biceps", "triceps"]],
  ["lat", ["lats"]],
  ["back", ["lats"]],
  ["oblique", ["obliques"]],
  ["core", ["abs"]],
  ["ab", ["abs"]],
  ["quad", ["quads"]],
  ["hamstring", ["hamstrings"]],
  ["glute", ["glutes"]],
  ["calves", ["calves"]],
  ["calf", ["calves"]],
  ["legs", ["quads", "hamstrings", "glutes"]],
];

/** Regions named by a list of free-text muscle names ("Front Delts", "Core"…). */
export function regionsFor(names: string[]): Set<MuscleRegion> {
  const out = new Set<MuscleRegion>();
  for (const n of names) {
    // "Lateral" (as in a raise) is not the lats.
    let rest = n.toLowerCase().replace(/lateral/g, " ");
    for (const [kw, regs] of KEYWORD_REGIONS) {
      // Anchored to a word start, so "ab" is Abs but not "stability".
      const re = new RegExp(`\\b${kw}`, "g");
      if (rest.search(re) === -1) continue;
      regs.forEach((r) => out.add(r));
      rest = rest.replace(re, " ");
    }
  }
  return out;
}

// Used when an exercise has no guide naming its muscles — every logged
// exercise carries a muscle group, so nothing drops off the map.
const GROUP_REGIONS: Record<MuscleGroup, { primary: MuscleRegion[]; secondary: MuscleRegion[] }> = {
  Chest: { primary: ["chest"], secondary: ["delts", "triceps"] },
  Back: { primary: ["lats"], secondary: ["biceps", "delts_b", "traps"] },
  Shoulders: { primary: ["delts", "delts_b"], secondary: ["triceps", "traps"] },
  Biceps: { primary: ["biceps"], secondary: ["forearms"] },
  Triceps: { primary: ["triceps"], secondary: [] },
  Legs: { primary: ["quads", "hamstrings", "glutes"], secondary: ["calves"] },
  Glutes: { primary: ["glutes"], secondary: ["hamstrings"] },
  Core: { primary: ["abs"], secondary: ["obliques"] },
  Cardio: { primary: [], secondary: ["quads", "calves"] },
  "Full Body": { primary: [], secondary: FULL_BODY },
};

export interface MuscleTargets {
  primary: Set<MuscleRegion>;
  secondary: Set<MuscleRegion>;
}

/** Which regions one exercise works: its guide if it has one, else its muscle group. */
export function targetsFor(
  ex: Pick<LoggedExercise, "name" | "muscleGroup">,
  guide?: ExerciseGuide
): MuscleTargets {
  const g = guide ?? (hasGuide(ex.name) ? guideFor(ex.name) : undefined);
  if (g) {
    const primary = regionsFor(g.primaryMuscles);
    const secondary = regionsFor(g.secondaryMuscles ?? []);
    primary.forEach((r) => secondary.delete(r));
    if (primary.size || secondary.size) return { primary, secondary };
  }
  const fallback = GROUP_REGIONS[ex.muscleGroup] ?? { primary: [], secondary: [] };
  return { primary: new Set(fallback.primary), secondary: new Set(fallback.secondary) };
}

// ── Training load over time ─────────────────────────────────────────────────

const DAY_MS = 86_400_000;
/** Load halves every week without training. */
export const HALF_LIFE_DAYS = 7;
// Past this, a session contributes under 2% — not worth iterating.
const LOOKBACK_DAYS = HALF_LIFE_DAYS * 6;
// Sets-equivalent at which a muscle reads ~63% intense. At a steady ~10 hard
// sets a week (the low end of a typical hypertrophy dose) the decayed load sits
// near 15, which lands at ~78% — so "fully lit" means genuinely well trained.
const SATURATION = 10;
const SECONDARY_WEIGHT = 0.5;

export interface MuscleLoad {
  region: MuscleRegion;
  /** Decayed set-equivalents. */
  load: number;
  /** 0–1, for colour. */
  intensity: number;
  /** Direct (primary) sets in the last 7 days — the number people actually count. */
  setsThisWeek: number;
  lastTrainedAt?: number;
}

// Set-equivalents one logged exercise is worth. Lifting counts its sets; a
// cardio block counts one set per 15 minutes (capped), so a long run registers
// on the legs without swamping a real leg day.
function setEquivalents(ex: LoggedExercise): number {
  if (resolveKind(ex) === "cardio") {
    const minutes = ex.sets.reduce((m, s) => m + (s.durationSec ?? 0), 0) / 60;
    return Math.min(3, Math.max(1, minutes / 15));
  }
  return ex.sets.length;
}

/**
 * Per-region training load as of `now`. `library` supplies AI-written guides for
 * custom exercises; seed exercises fall back to the built-in guides.
 */
export function muscleLoads(
  history: WorkoutSession[],
  library: Pick<Exercise, "name" | "guide">[] = [],
  now = Date.now()
): Record<MuscleRegion, MuscleLoad> {
  const guides = new Map<string, ExerciseGuide>();
  for (const e of library) if (e.guide) guides.set(e.name.toLowerCase(), e.guide);

  const out = Object.fromEntries(
    REGIONS.map((region) => [region, { region, load: 0, intensity: 0, setsThisWeek: 0 }])
  ) as Record<MuscleRegion, MuscleLoad>;

  const cutoff = now - LOOKBACK_DAYS * DAY_MS;
  const weekAgo = now - 7 * DAY_MS;
  for (const session of history) {
    const at = session.startedAt;
    if (at < cutoff || at > now) continue;
    const decay = Math.pow(0.5, (now - at) / DAY_MS / HALF_LIFE_DAYS);
    for (const ex of session.exercises) {
      const sets = setEquivalents(ex);
      if (sets <= 0) continue;
      const { primary, secondary } = targetsFor(ex, guides.get(ex.name.toLowerCase()));
      const deposit = (regions: Set<MuscleRegion>, weight: number) => {
        for (const r of regions) {
          const m = out[r];
          m.load += sets * weight * decay;
          if (weight === 1 && at >= weekAgo) m.setsThisWeek += sets;
          if (!m.lastTrainedAt || at > m.lastTrainedAt) m.lastTrainedAt = at;
        }
      };
      deposit(primary, 1);
      deposit(secondary, SECONDARY_WEIGHT);
    }
  }

  for (const m of Object.values(out)) {
    m.load = Math.round(m.load * 10) / 10;
    m.setsThisWeek = Math.round(m.setsThisWeek);
    m.intensity = 1 - Math.exp(-m.load / SATURATION);
  }
  return out;
}
