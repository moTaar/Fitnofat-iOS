import type { LoggedExercise, UserProfile, WorkoutSession } from "./types";
import { estimate1RM } from "./utils";
import { cardioMinutes, exerciseDuration, resolveKind } from "./calories";
import { startOfWeek, isAfter, subDays, format } from "date-fns";

export interface WeekStats {
  trained: number;
  goal: number;
  volume: number;
  calories: number;
  pct: number;
}

export function weekStats(
  history: WorkoutSession[],
  goalDays: number
): WeekStats {
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 }).getTime();
  const thisWeek = history.filter((h) => h.startedAt >= weekStart);
  const trained = thisWeek.length;
  const volume = thisWeek.reduce((v, h) => v + h.totalVolume, 0);
  const calories = thisWeek.reduce((v, h) => v + (h.calories ?? 0), 0);
  return {
    trained,
    goal: goalDays,
    volume,
    calories,
    pct: goalDays > 0 ? Math.min(100, (trained / goalDays) * 100) : 0,
  };
}

export function currentStreak(history: WorkoutSession[]): number {
  if (history.length === 0) return 0;
  // Count consecutive calendar days (looking back) that had a session.
  const days = new Set(
    history.map((h) => new Date(h.startedAt).toDateString())
  );
  let streak = 0;
  let cursor = new Date();
  // Allow today to be missing without breaking streak.
  if (!days.has(cursor.toDateString())) cursor = subDays(cursor, 1);
  while (days.has(cursor.toDateString())) {
    streak += 1;
    cursor = subDays(cursor, 1);
  }
  return streak;
}

// Which performance metric best describes an exercise's progress.
//   e1rm     → weighted lifts (estimated 1-rep max)
//   reps     → bodyweight strength (best single-set reps)
//   duration → cardio / holds measured in minutes
//   distance → distance cardio in km
export type TrendMetric = "e1rm" | "reps" | "duration" | "distance";

export interface ExerciseTrend {
  name: string;
  metric: TrendMetric;
  unit: string; // display unit ("reps", "min", "km"); e1rm is unit-less here (UI adds kg/lb)
  sessions: number;
  first: number;
  last: number;
  best: number;
  bestAt: number; // timestamp of the best value (for PRs)
  deltaPct: number;
  stalled: boolean;
}

// Decide the metric for an exercise from its kind + the data actually logged.
function metricFor(ex: Pick<LoggedExercise, "kind" | "muscleGroup" | "sets">): TrendMetric {
  const hasWeight = ex.sets.some((s) => (s.weight ?? 0) > 0 && (s.reps ?? 0) > 0);
  if (hasWeight) return "e1rm";
  const kind = resolveKind(ex);
  if (kind === "cardio") {
    return ex.sets.some((s) => (s.distanceKm ?? 0) > 0) ? "distance" : "duration";
  }
  if (kind === "hold") return "duration";
  return "reps"; // bodyweight strength
}

// The single per-session value for an exercise under a given metric.
function valueFor(ex: Pick<LoggedExercise, "kind" | "muscleGroup" | "restSeconds" | "sets">, metric: TrendMetric): number {
  switch (metric) {
    case "e1rm":
      return ex.sets.reduce((m, s) => Math.max(m, estimate1RM(s.weight, s.reps)), 0);
    case "reps":
      return ex.sets.reduce((m, s) => Math.max(m, s.reps ?? 0), 0);
    case "distance":
      return ex.sets.reduce((sum, s) => sum + (s.distanceKm ?? 0), 0);
    case "duration":
      return Math.round((exerciseDuration(ex) / 60) * 10) / 10; // minutes
  }
}

const UNIT: Record<TrendMetric, string> = { e1rm: "", reps: "reps", duration: "min", distance: "km" };

/**
 * Per-exercise progress over time across ALL modalities — weighted lifts (e1RM),
 * bodyweight strength (best reps), and cardio/holds (minutes or km). No exercise
 * is dropped, so AI-logged cardio and bodyweight work finally show up.
 */
export function exerciseTrends(history: WorkoutSession[]): ExerciseTrend[] {
  const byName = new Map<string, { metric: TrendMetric; points: { ts: number; value: number }[] }>();
  // history is newest-first; reverse to chronological
  [...history].reverse().forEach((session) => {
    session.exercises.forEach((ex) => {
      const metric = metricFor(ex);
      const value = valueFor(ex, metric);
      if (value <= 0) return;
      const entry = byName.get(ex.name) ?? { metric, points: [] };
      entry.metric = metric; // latest wins if an exercise changed modality
      entry.points.push({ ts: session.startedAt, value });
      byName.set(ex.name, entry);
    });
  });

  const trends: ExerciseTrend[] = [];
  byName.forEach(({ metric, points }, name) => {
    const first = points[0].value;
    const last = points[points.length - 1].value;
    const bestPoint = points.reduce((m, p) => (p.value > m.value ? p : m), points[0]);
    const deltaPct = first > 0 ? ((last - first) / first) * 100 : 0;
    // Stalled: 3+ sessions and no improvement in the last 3.
    const recent = points.slice(-3).map((p) => p.value);
    const stalled = points.length >= 3 && Math.max(...recent) <= Math.min(...recent) + 0.5;
    trends.push({
      name,
      metric,
      unit: UNIT[metric],
      sessions: points.length,
      first,
      last,
      best: bestPoint.value,
      bestAt: bestPoint.ts,
      deltaPct: Math.round(deltaPct * 10) / 10,
      stalled,
    });
  });
  return trends.sort((a, b) => b.sessions - a.sessions);
}

/** Chronological per-session values for one exercise, for its detail chart. */
export function exerciseSeries(
  history: WorkoutSession[],
  name: string
): { points: { date: string; value: number }[]; metric: TrendMetric; unit: string } {
  let metric: TrendMetric = "reps";
  const points: { date: string; value: number }[] = [];
  [...history].reverse().forEach((session) => {
    session.exercises
      .filter((ex) => ex.name === name)
      .forEach((ex) => {
        metric = metricFor(ex);
        const value = valueFor(ex, metric);
        if (value > 0) points.push({ date: format(session.startedAt, "MMM d"), value });
      });
  });
  return { points, metric, unit: UNIT[metric] };
}

// ── Aggregate dashboards ──────────────────────────────────────────────────────

export interface RangeSummary {
  sessions: number;
  volume: number;
  calories: number;
  cardioMin: number;
}

/** Totals over the last `days` (default 28) — powers the progress summary cards. */
export function rangeSummary(history: WorkoutSession[], days = 28): RangeSummary {
  const cutoff = subDays(new Date(), days).getTime();
  const inRange = history.filter((h) => h.startedAt >= cutoff);
  return {
    sessions: inRange.length,
    volume: inRange.reduce((v, h) => v + h.totalVolume, 0),
    calories: inRange.reduce((v, h) => v + (h.calories ?? 0), 0),
    cardioMin: inRange.reduce((v, h) => v + cardioMinutes(h), 0),
  };
}

export interface WeekPoint {
  label: string; // e.g. "May 6"
  week: number; // start-of-week timestamp
  calories: number;
  volume: number;
  cardioMin: number;
  sessions: number;
}

/** Per-week aggregates for the last `weeks` weeks (oldest → newest) for charts. */
export function weeklySeries(history: WorkoutSession[], weeks = 8): WeekPoint[] {
  const buckets = new Map<number, WeekPoint>();
  const earliest = startOfWeek(subDays(new Date(), (weeks - 1) * 7), { weekStartsOn: 1 }).getTime();
  // Seed empty weeks so the chart shows a continuous timeline.
  for (let i = 0; i < weeks; i++) {
    const wk = startOfWeek(subDays(new Date(), (weeks - 1 - i) * 7), { weekStartsOn: 1 }).getTime();
    buckets.set(wk, { label: format(wk, "MMM d"), week: wk, calories: 0, volume: 0, cardioMin: 0, sessions: 0 });
  }
  history.forEach((h) => {
    const wk = startOfWeek(h.startedAt, { weekStartsOn: 1 }).getTime();
    if (wk < earliest) return;
    const b = buckets.get(wk);
    if (!b) return;
    b.calories += h.calories ?? 0;
    b.volume += h.totalVolume;
    b.cardioMin += cardioMinutes(h);
    b.sessions += 1;
  });
  return [...buckets.values()].sort((a, b) => a.week - b.week);
}

export interface PersonalRecord {
  name: string;
  metric: TrendMetric;
  value: number;
  unit: string;
  at: number;
}

/** Best-ever value per exercise (its PR), most recent first. */
export function personalRecords(history: WorkoutSession[]): PersonalRecord[] {
  return exerciseTrends(history)
    .map((t) => ({ name: t.name, metric: t.metric, value: t.best, unit: t.unit, at: t.bestAt }))
    .sort((a, b) => b.at - a.at);
}

/** Builds the natural-language analytics summary packaged for the AI refresh. */
export function buildRefreshSummary(
  history: WorkoutSession[],
  profile: UserProfile
): string {
  const last28 = history.filter((h) =>
    isAfter(h.startedAt, subDays(new Date(), 28).getTime())
  );
  const totalVolume = last28.reduce((v, h) => v + h.totalVolume, 0);
  const totalCalories = last28.reduce((v, h) => v + (h.calories ?? 0), 0);
  const totalCardioMin = last28.reduce((v, h) => v + cardioMinutes(h), 0);
  const avgPerWeek = (last28.length / 4).toFixed(1);
  const trends = exerciseTrends(history);

  // Per-metric unit label for the trend line (e1RM uses the athlete's weight unit).
  const unitFor = (t: ExerciseTrend) => (t.metric === "e1rm" ? profile.units : t.unit);

  const lines: string[] = [];
  lines.push(`- Sessions completed (last 4 weeks): ${last28.length}`);
  lines.push(`- Average sessions/week: ${avgPerWeek} (goal: ${profile.daysPerWeek})`);
  lines.push(`- Total volume (last 4 weeks): ${Math.round(totalVolume)} ${profile.units}`);
  lines.push(`- Calories burned (last 4 weeks): ${Math.round(totalCalories)} kcal`);
  lines.push(`- Cardio minutes (last 4 weeks): ${Math.round(totalCardioMin)} min`);
  lines.push(`- Current streak: ${currentStreak(history)} days`);

  if (trends.length) {
    lines.push("- Per-exercise progress trend:");
    trends.slice(0, 12).forEach((t) => {
      const tag = t.stalled ? "STALLED" : t.deltaPct > 0 ? `+${t.deltaPct}%` : `${t.deltaPct}%`;
      lines.push(
        `   • ${t.name} (${t.metric}): ${t.first}→${t.last} ${unitFor(t)} over ${t.sessions} sessions [${tag}]`
      );
    });
  } else {
    lines.push("- No completed sets yet; keep prescriptions conservative.");
  }
  return lines.join("\n");
}
