import { slugify } from "./exercises";

// Procedural stick-figure demos. Instead of shipping a video/GIF per exercise,
// every movement is described by TWO key poses that the renderer interpolates
// and loops (ping-pong). One renderer + a handful of archetypes covers the
// whole library at almost no storage/token cost.

export type Pt = [number, number];
export interface Pose {
  head: Pt;
  sh: Pt; // shoulder
  el: Pt; // elbow
  ha: Pt; // hand
  hip: Pt;
  kn: Pt; // knee
  ft: Pt; // foot
}
export type Load = "bar" | "db" | "none";
export type Prop = "floor" | "bench" | "seat" | "none";
export interface Anim {
  frames: [Pose, Pose];
  speedMs: number;
  load: Load;
  prop: Prop;
}

const P = (head: Pt, sh: Pt, el: Pt, ha: Pt, hip: Pt, kn: Pt, ft: Pt): Pose => ({
  head, sh, el, ha, hip, kn, ft,
});

// Side view, facing right, in a 100×100 box. Ground ≈ y92.
const ARCH: Record<string, Anim> = {
  squat: {
    frames: [
      P([50, 16], [50, 30], [44, 34], [40, 30], [50, 52], [50, 72], [50, 92]),
      P([46, 28], [47, 42], [41, 46], [37, 42], [52, 60], [60, 74], [50, 92]),
    ],
    speedMs: 1100, load: "bar", prop: "floor",
  },
  hinge: {
    frames: [
      P([50, 16], [50, 30], [50, 42], [52, 54], [50, 52], [50, 72], [50, 92]),
      P([30, 40], [40, 46], [44, 56], [48, 66], [56, 52], [54, 72], [50, 92]),
    ],
    speedMs: 1200, load: "bar", prop: "floor",
  },
  press_flat: {
    frames: [
      P([26, 60], [40, 62], [40, 56], [40, 50], [64, 64], [78, 60], [90, 74]),
      P([26, 60], [40, 62], [40, 50], [40, 34], [64, 64], [78, 60], [90, 74]),
    ],
    speedMs: 1100, load: "bar", prop: "bench",
  },
  press_over: {
    frames: [
      P([50, 16], [50, 30], [46, 38], [44, 32], [50, 54], [50, 74], [50, 92]),
      P([50, 16], [50, 30], [48, 20], [50, 9], [50, 54], [50, 74], [50, 92]),
    ],
    speedMs: 1100, load: "bar", prop: "floor",
  },
  raise: {
    frames: [
      P([50, 16], [50, 30], [52, 40], [54, 52], [50, 54], [50, 74], [50, 92]),
      P([50, 16], [50, 30], [58, 34], [70, 33], [50, 54], [50, 74], [50, 92]),
    ],
    speedMs: 1100, load: "db", prop: "floor",
  },
  row: {
    frames: [
      P([34, 34], [40, 40], [38, 50], [38, 62], [52, 52], [52, 72], [50, 92]),
      P([34, 34], [40, 40], [46, 44], [46, 50], [52, 52], [52, 72], [50, 92]),
    ],
    speedMs: 1000, load: "bar", prop: "floor",
  },
  pulldown: {
    frames: [
      P([50, 18], [50, 32], [48, 22], [50, 11], [50, 56], [50, 76], [50, 92]),
      P([50, 18], [50, 32], [44, 36], [42, 42], [50, 56], [50, 76], [50, 92]),
    ],
    speedMs: 1100, load: "bar", prop: "none",
  },
  curl: {
    frames: [
      P([50, 16], [50, 30], [52, 42], [54, 54], [50, 54], [50, 74], [50, 92]),
      P([50, 16], [50, 30], [52, 42], [48, 32], [50, 54], [50, 74], [50, 92]),
    ],
    speedMs: 1000, load: "db", prop: "floor",
  },
  extension: {
    frames: [
      P([50, 16], [50, 30], [50, 38], [48, 30], [50, 54], [50, 74], [50, 92]),
      P([50, 16], [50, 30], [50, 38], [52, 50], [50, 54], [50, 74], [50, 92]),
    ],
    speedMs: 1000, load: "bar", prop: "floor",
  },
  lunge: {
    frames: [
      P([50, 16], [50, 30], [46, 40], [44, 46], [50, 50], [52, 70], [54, 92]),
      P([50, 28], [50, 42], [46, 52], [44, 58], [50, 62], [58, 76], [54, 92]),
    ],
    speedMs: 1100, load: "db", prop: "floor",
  },
  bridge: {
    frames: [
      P([24, 72], [34, 70], [36, 76], [40, 78], [56, 72], [72, 58], [80, 72]),
      P([24, 72], [34, 70], [36, 76], [40, 78], [56, 56], [72, 56], [80, 72]),
    ],
    speedMs: 1100, load: "none", prop: "floor",
  },
  core: {
    frames: [
      P([26, 66], [36, 68], [33, 78], [30, 84], [60, 66], [74, 70], [88, 80]),
      P([26, 64], [36, 66], [33, 76], [30, 84], [60, 62], [74, 66], [88, 78]),
    ],
    speedMs: 1600, load: "none", prop: "floor",
  },
  leg_machine: {
    frames: [
      P([50, 26], [50, 40], [46, 50], [44, 58], [50, 60], [64, 60], [64, 80]),
      P([50, 26], [50, 40], [46, 50], [44, 58], [50, 60], [64, 60], [82, 56]),
    ],
    speedMs: 1000, load: "none", prop: "seat",
  },
  calf: {
    frames: [
      P([50, 18], [50, 32], [52, 44], [54, 54], [50, 54], [50, 74], [50, 92]),
      P([50, 12], [50, 26], [52, 38], [54, 48], [50, 48], [50, 70], [50, 92]),
    ],
    speedMs: 800, load: "none", prop: "floor",
  },
  cardio: {
    frames: [
      P([52, 16], [51, 30], [56, 38], [60, 46], [50, 52], [44, 70], [40, 86]),
      P([52, 16], [51, 30], [44, 38], [40, 44], [50, 52], [56, 72], [60, 90]),
    ],
    speedMs: 560, load: "none", prop: "floor",
  },
};

// Exact slug → archetype for the seed library.
const SLUG_MAP: Record<string, keyof typeof ARCH> = {
  "barbell-bench-press": "press_flat",
  "dumbbell-bench-press": "press_flat",
  "incline-dumbbell-press": "press_flat",
  "close-grip-bench-press": "press_flat",
  "push-up": "press_flat",
  dip: "press_flat",
  "pull-up": "pulldown",
  "chin-up": "pulldown",
  "lat-pulldown": "pulldown",
  "barbell-row": "row",
  "seated-cable-row": "row",
  "single-arm-dumbbell-row": "row",
  deadlift: "hinge",
  "romanian-deadlift": "hinge",
  "kettlebell-swing": "hinge",
  "overhead-press": "press_over",
  "dumbbell-shoulder-press": "press_over",
  "lateral-raise": "raise",
  "face-pull": "raise",
  "rear-delt-fly": "raise",
  "cable-chest-fly": "raise",
  "barbell-curl": "curl",
  "dumbbell-curl": "curl",
  "hammer-curl": "curl",
  "cable-curl": "curl",
  "tricep-pushdown": "extension",
  "overhead-tricep-extension": "extension",
  "skull-crusher": "extension",
  "barbell-back-squat": "squat",
  "front-squat": "squat",
  "leg-press": "squat",
  "goblet-squat": "squat",
  "walking-lunge": "lunge",
  "bulgarian-split-squat": "lunge",
  "leg-extension": "leg_machine",
  "leg-curl": "leg_machine",
  "hip-thrust": "bridge",
  "glute-bridge": "bridge",
  "cable-kickback": "bridge",
  "calf-raise": "calf",
  plank: "core",
  "hanging-leg-raise": "core",
  "cable-crunch": "core",
  "russian-twist": "core",
  "ab-wheel-rollout": "core",
  "treadmill-run": "cardio",
  "rowing-machine": "cardio",
  "jump-rope": "cardio",
  burpee: "cardio",
};

export type Archetype = keyof typeof ARCH;

// Keyword fallback so AI-generated / custom exercises still animate sensibly
// when the AI guide didn't supply a pattern. Order matters — the most specific
// matches come first so e.g. "leg-extension"/"leg-curl" map to the seated
// leg-machine and not to the triceps-extension / biceps-curl archetypes, and
// cardio rowing isn't mistaken for a back row.
//
// Returns undefined when nothing matches. It used to return "squat", which is
// why a cable crossover, a Pallof press and a farmer's carry all animated as a
// barbell squat: a confidently wrong demo teaches bad form and casts doubt on
// the (correct) written steps beside it. Callers render no figure instead.
function guessArchetype(slug: string): Archetype | undefined {
  const has = (...k: string[]) => k.some((x) => slug.includes(x));

  // Cardio / conditioning first (some names contain "row").
  if (has("treadmill", "run", "sprint", "jog", "jump-rope", "jumprope", "skipping",
          "burpee", "rowing", "rower", "row-erg", "bike", "cycl", "elliptical",
          "stair", "jumping-jack", "high-knee", "mountain-climber", "skater"))
    return "cardio";

  // Single-joint leg machines BEFORE generic curl/extension.
  if (has("leg-extension", "leg-curl", "hamstring-curl", "quad-extension", "knee-extension"))
    return "leg_machine";
  if (has("calf", "soleus", "heel-raise")) return "calf";

  // Lower body.
  if (has("lunge", "split-squat", "step-up", "step-down")) return "lunge";
  if (has("hip-thrust", "thrust", "glute-bridge", "bridge", "kickback", "donkey-kick"))
    return "bridge";
  if (has("deadlift", "rdl", "good-morning", "hinge", "swing", "pull-through"))
    return "hinge";
  if (has("squat", "leg-press", "hack")) return "squat";

  // Upper-body push.
  if (has("overhead", "shoulder-press", "ohp", "military", "push-press", "arnold",
          "handstand", "pike-push"))
    return "press_over";
  if (has("bench", "push-up", "pushup", "chest-press", "dip", "chaturanga", "floor-press"))
    return "press_flat";

  // Upper-body pull.
  if (has("pulldown", "pull-up", "pullup", "chin-up", "chinup", "chin", "muscle-up"))
    return "pulldown";
  if (has("row")) return "row";

  // Shoulder raises / flyes.
  if (has("lateral-raise", "lat-raise", "side-raise", "front-raise", "rear-delt",
          "reverse-fly", "reverse-flye", "fly", "flye", "face-pull"))
    return "raise";

  // Arms (triceps before biceps; pushdown/skull/tricep are extensions).
  if (has("pushdown", "skull", "tricep", "overhead-extension", "kickback")) return "extension";
  if (has("curl")) return "curl";
  if (has("extension")) return "extension";

  // Core / abs.
  if (has("plank", "crunch", "twist", "rollout", "sit-up", "situp", "leg-raise",
          "raise-leg", "knee-raise", "dead-bug", "hollow", "l-sit", "v-up",
          "bird-dog", "flutter", "bicycle", "ab-"))
    return "core";

  // Anything else with "raise" (e.g. an unusual raise variation).
  if (has("raise")) return "raise";

  return undefined;
}

const isArchetype = (v: unknown): v is Archetype =>
  typeof v === "string" && v in ARCH;

// Resolve the animation for an exercise. The AI guide's `pattern`/`load`/`prop`
// (when present and valid) take priority over name-based guessing, so freshly
// generated exercises animate correctly. `load`/`prop` can refine the archetype
// (e.g. a dumbbell vs. barbell variant) without changing the movement.
export function animationFor(
  name: string,
  opts?: { pattern?: string; load?: Load; prop?: Prop }
): Anim {
  const key = knownArchetype(name, opts?.pattern) ?? "squat";
  const base = ARCH[key];
  if (!opts?.load && !opts?.prop) return base;
  return { ...base, load: opts.load ?? base.load, prop: opts.prop ?? base.prop };
}

/**
 * The archetype for an exercise, or undefined when we genuinely don't know what
 * the movement looks like. Callers that can omit the demo entirely — which, now
 * that a real video sits above it, is all of them — should branch on this rather
 * than calling `animationFor` and rendering whatever comes back.
 */
export function knownArchetype(name: string, pattern?: string): Archetype | undefined {
  if (isArchetype(pattern)) return pattern;
  const slug = slugify(name);
  return SLUG_MAP[slug] ?? guessArchetype(slug);
}
