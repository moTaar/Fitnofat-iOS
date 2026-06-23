import type { UserProfile, WorkoutSession } from "./types";
import { estimate1RM } from "./utils";
import { startOfWeek, isAfter, subDays } from "date-fns";

export interface WeekStats {
  trained: number;
  goal: number;
  volume: number;
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
  return {
    trained,
    goal: goalDays,
    volume,
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

interface ExerciseTrend {
  name: string;
  sessions: number;
  first1RM: number;
  last1RM: number;
  deltaPct: number;
  stalled: boolean;
}

/** Per-exercise best estimated 1RM over time + whether it has stalled. */
export function exerciseTrends(history: WorkoutSession[]): ExerciseTrend[] {
  const byName = new Map<string, { ts: number; best1RM: number }[]>();
  // history is newest-first; reverse to chronological
  [...history].reverse().forEach((session) => {
    session.exercises.forEach((ex) => {
      const best = ex.sets.reduce(
        (m, s) => Math.max(m, estimate1RM(s.weight, s.reps)),
        0
      );
      if (best <= 0) return;
      const arr = byName.get(ex.name) ?? [];
      arr.push({ ts: session.startedAt, best1RM: best });
      byName.set(ex.name, arr);
    });
  });

  const trends: ExerciseTrend[] = [];
  byName.forEach((points, name) => {
    const first = points[0].best1RM;
    const last = points[points.length - 1].best1RM;
    const deltaPct = first > 0 ? ((last - first) / first) * 100 : 0;
    // Stalled: 3+ sessions and no improvement in the last 3.
    const recent = points.slice(-3).map((p) => p.best1RM);
    const stalled =
      points.length >= 3 && Math.max(...recent) <= Math.min(...recent) + 0.5;
    trends.push({
      name,
      sessions: points.length,
      first1RM: first,
      last1RM: last,
      deltaPct: Math.round(deltaPct * 10) / 10,
      stalled,
    });
  });
  return trends.sort((a, b) => b.sessions - a.sessions);
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
  const avgPerWeek = (last28.length / 4).toFixed(1);
  const trends = exerciseTrends(history);

  const lines: string[] = [];
  lines.push(`- Sessions completed (last 4 weeks): ${last28.length}`);
  lines.push(`- Average sessions/week: ${avgPerWeek} (goal: ${profile.daysPerWeek})`);
  lines.push(`- Total volume (last 4 weeks): ${Math.round(totalVolume)} ${profile.units}`);
  lines.push(`- Current streak: ${currentStreak(history)} days`);

  if (trends.length) {
    lines.push("- Per-exercise estimated 1RM trend:");
    trends.slice(0, 12).forEach((t) => {
      const tag = t.stalled
        ? "STALLED"
        : t.deltaPct > 0
          ? `+${t.deltaPct}%`
          : `${t.deltaPct}%`;
      lines.push(
        `   • ${t.name}: ${t.first1RM}→${t.last1RM} ${profile.units} over ${t.sessions} sessions [${tag}]`
      );
    });
  } else {
    lines.push("- No completed sets yet; keep prescriptions conservative.");
  }
  return lines.join("\n");
}
