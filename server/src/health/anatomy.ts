// Layer 4 — Anatomy & mobility: structured tracking and trend analysis.
//
// Pure, deterministic, local. The arithmetic a language model is worst at and a
// few lines of code are best at — "is this pain score actually going down?",
// "what is 150 g of protein per kilo of this person?" — is done here, and only
// the conclusion is handed to the reasoning layer. That has two payoffs: the
// numbers are right, and the raw reading-by-reading log never has to leave the
// server for the model to know which way things are heading.

import type { HealthIssue, IssueMetric, NutritionPlan, UserProfile } from "../types";

const DAY = 86_400_000;

// ── Body regions ─────────────────────────────────────────────────────────────
// A small canonical vocabulary, so "my knee", "patellar tendon" and an issue
// whose bodyRegion is "Left knee" all land on the same region. Used both to
// group the tracker by region and, in privacy.ts, to decide which issues and
// records a question is actually about.

const REGIONS: { region: string; pattern: RegExp }[] = [
  { region: "head", pattern: /\b(head|headaches?|migraines?|jaw|tmj|concussion)\b/i },
  { region: "neck", pattern: /\b(neck|cervical|traps?)\b/i },
  { region: "shoulder", pattern: /\b(shoulders?|rotator cuff|deltoids?|delts?|labrum)\b/i },
  { region: "elbow", pattern: /\b(elbows?|tennis elbow|golfer'?s elbow)\b/i },
  { region: "wrist/hand", pattern: /\b(wrists?|hands?|fingers?|thumbs?|carpal)\b/i },
  { region: "chest", pattern: /\b(chest|pecs?|pectorals?|ribs?|sternum)\b/i },
  { region: "upper back", pattern: /\b(upper back|thoracic|lats?|rhomboids?|shoulder blades?)\b/i },
  { region: "lower back", pattern: /\b(lower back|low back|lumbar|sciatica|disc|spine|back pain)\b/i },
  { region: "abdomen", pattern: /\b(abs|abdomen|abdominal|core|stomach|hernia|gut)\b/i },
  { region: "hip", pattern: /\b(hips?|glutes?|groin|hip flexors?|piriformis)\b/i },
  { region: "thigh", pattern: /\b(hamstrings?|quads?|quadriceps|thighs?|adductors?|it band)\b/i },
  { region: "knee", pattern: /\b(knees?|patell\w*|acl|mcl|meniscus)\b/i },
  { region: "lower leg", pattern: /\b(calf|calves|shins?|achilles|tibia)\b/i },
  { region: "ankle/foot", pattern: /\b(ankles?|feet|foot|heels?|plantar|toes?|arch)\b/i },
];

/** Canonical body regions mentioned in free text, in vocabulary order. */
export function regionsIn(text: string | undefined): string[] {
  if (!text) return [];
  return REGIONS.filter(({ pattern }) => pattern.test(text)).map(({ region }) => region);
}

/** The regions an issue concerns — its own bodyRegion first, then its wording. */
export function issueRegions(issue: HealthIssue): string[] {
  const fromField = regionsIn(issue.bodyRegion);
  if (fromField.length) return fromField;
  return regionsIn(`${issue.title} ${issue.summary ?? ""}`);
}

/** Open issues per body region, busiest first — the tracker seen as a body map. */
export function regionLoad(issues: HealthIssue[]): { region: string; open: number }[] {
  const counts = new Map<string, number>();
  for (const issue of issues) {
    if (issue.status === "resolved" || issue.status === "dismissed") continue;
    for (const region of issueRegions(issue)) counts.set(region, (counts.get(region) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([region, open]) => ({ region, open }))
    .sort((a, b) => b.open - a.open || a.region.localeCompare(b.region));
}

// ── Metric trends ────────────────────────────────────────────────────────────

export type TrendDirection =
  | "improving" // moving toward the good end
  | "worsening" // moving away from it
  | "steady"    // within noise of where it started
  | "rising"    // moving, but which way is good is unknown
  | "falling"
  | "single"    // one reading — a level, not a trend
  | "none";     // nothing recorded

export interface MetricTrend {
  label: string;
  unit?: string;
  target?: string;
  readings: number;
  first?: number;
  latest?: number;
  spanDays?: number;
  direction: TrendDirection;
  /** Whether the latest reading meets the target, when the target is numeric. */
  onTarget?: boolean;
}

/**
 * Which end of a metric is the good one. Read from the target first ("< 2",
 * "at least 7", "trending down"), then from what the label measures — a pain or
 * severity score is always better lower. Undefined when it genuinely can't be
 * told, and then the trend is reported as rising/falling, not judged.
 */
export function betterWhen(metric: Pick<IssueMetric, "label" | "target">): "lower" | "higher" | undefined {
  const target = (metric.target ?? "").trim();
  if (/^(<|≤|under\b|below\b|less than\b|max\b|no more than\b)/i.test(target)) return "lower";
  if (/^(>|≥|over\b|above\b|at least\b|min\b|more than\b)/i.test(target)) return "higher";
  if (/\b(down|decreas\w*|reduc\w*|lower|fewer)\b/i.test(target)) return "lower";
  if (/\b(up|increas\w*|higher|more)\b/i.test(target)) return "higher";
  if (/\b(pain|severity|stiffness|swelling|symptoms?|episodes?|flare\w*|headaches?|nausea|reflux|cravings?|fatigue|soreness)\b/i.test(metric.label)) {
    return "lower";
  }
  return undefined;
}

/** Whether `value` meets a numeric target like "< 2", "≥ 7.5" or "under 130". */
export function meetsTarget(value: number, target: string | undefined): boolean | undefined {
  if (!target) return undefined;
  const m = target
    .trim()
    .match(/^(<=|>=|<|>|≤|≥|under|below|over|above|at least|at most|max|min)\s*(-?\d+(?:\.\d+)?)/i);
  if (!m) return undefined;
  const op = m[1].toLowerCase();
  const n = Number(m[2]);
  if (op === "<" || op === "under" || op === "below") return value < n;
  if (op === "<=" || op === "≤" || op === "at most" || op === "max") return value <= n;
  if (op === ">" || op === "over" || op === "above") return value > n;
  return value >= n; // >=, ≥, at least, min
}

/** The trend of one metric, from the issue's measurement events. */
export function metricTrend(issue: HealthIssue, metric: IssueMetric): MetricTrend {
  const label = metric.label.trim().toLowerCase();
  const points = (issue.events ?? [])
    .filter((e) => e.value != null && e.metric?.trim().toLowerCase() === label)
    .map((e) => ({ at: e.createdAt, value: e.value as number }))
    .sort((a, b) => a.at - b.at);
  // A metric can carry a latest reading with no event behind it (set by hand,
  // or older than the events window). Count it rather than report "none".
  if (!points.length && metric.latest != null) {
    points.push({ at: metric.latestAt ?? issue.updatedAt, value: metric.latest });
  }

  const base: MetricTrend = {
    label: metric.label,
    unit: metric.unit,
    target: metric.target,
    readings: points.length,
    direction: "none",
  };
  if (!points.length) return base;

  const first = points[0];
  const latest = points[points.length - 1];
  const withLevel: MetricTrend = {
    ...base,
    first: first.value,
    latest: latest.value,
    spanDays: Math.round((latest.at - first.at) / DAY),
    onTarget: meetsTarget(latest.value, metric.target),
  };
  if (points.length < 2) return { ...withLevel, direction: "single" };

  const delta = latest.value - first.value;
  // 5% of the starting value counts as noise, so a pain score of 4 → 3.9 is
  // "steady", not a victory.
  const noise = Math.max(Math.abs(first.value) * 0.05, 0.01);
  if (Math.abs(delta) <= noise) return { ...withLevel, direction: "steady" };

  const better = betterWhen(metric);
  if (!better) return { ...withLevel, direction: delta > 0 ? "rising" : "falling" };
  const improving = better === "lower" ? delta < 0 : delta > 0;
  return { ...withLevel, direction: improving ? "improving" : "worsening" };
}

/** Days since the person last logged anything against an issue. */
export function daysSinceCheckIn(issue: HealthIssue, now = Date.now()): number | undefined {
  const stamps = [
    ...(issue.events ?? []).filter((e) => e.kind !== "ai_review").map((e) => e.createdAt),
    ...issue.metrics.map((m) => m.latestAt).filter((t): t is number => t != null),
  ];
  if (!stamps.length) return undefined;
  return Math.max(0, Math.floor((now - Math.max(...stamps)) / DAY));
}

function spanLabel(days: number): string {
  if (days < 14) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  return `${Math.round(days / 30)} months`;
}

/** One trend as the line the reasoning layer reads. */
export function trendLine(t: MetricTrend): string {
  const unit = t.unit ?? "";
  if (t.direction === "none") return `${t.label}: no readings yet${t.target ? ` (target ${t.target})` : ""}`;
  const target =
    t.target == null
      ? ""
      : t.onTarget == null
        ? `; target ${t.target}`
        : `; target ${t.target} — ${t.onTarget ? "met" : "not yet met"}`;
  if (t.direction === "single") return `${t.label}: ${t.latest}${unit} (one reading)${target}`;
  return `${t.label}: ${t.first}${unit} → ${t.latest}${unit} over ${spanLabel(t.spanDays ?? 0)} ` +
    `(${t.readings} readings), ${t.direction}${target}`;
}

// ── Health calculations ──────────────────────────────────────────────────────

export interface BodyCalcs {
  bmi?: number;
  bmiCategory?: string;
  /** The plan's training-day protein target per kilo of bodyweight. */
  proteinPerKg?: number;
}

export function bodyCalcs(profile: UserProfile, plan?: NutritionPlan | null): BodyCalcs {
  const out: BodyCalcs = {};
  const kg = profile.bodyweightKg;
  const cm = profile.heightCm;
  if (kg && cm) {
    const bmi = kg / (cm / 100) ** 2;
    out.bmi = Math.round(bmi * 10) / 10;
    out.bmiCategory =
      bmi < 18.5 ? "underweight" : bmi < 25 ? "healthy range" : bmi < 30 ? "overweight" : "obese range";
  }
  const protein = plan?.trainingDay?.targets?.protein;
  if (kg && protein) out.proteinPerKg = Math.round((protein / kg) * 10) / 10;
  return out;
}
