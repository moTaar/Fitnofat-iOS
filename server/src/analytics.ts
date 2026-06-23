import { estimate1RM } from "./util";
import type { LoggedExercise, UserProfile } from "./types";

export interface SessionLite {
  startedAt: number; // epoch ms
  totalVolume: number;
  exercises: LoggedExercise[];
}

const DAY = 86_400_000;

function currentStreak(history: SessionLite[]): number {
  if (history.length === 0) return 0;
  const days = new Set(history.map((h) => new Date(h.startedAt).toDateString()));
  let streak = 0;
  let cursor = new Date();
  if (!days.has(cursor.toDateString())) cursor = new Date(cursor.getTime() - DAY);
  while (days.has(cursor.toDateString())) {
    streak += 1;
    cursor = new Date(cursor.getTime() - DAY);
  }
  return streak;
}

interface Trend {
  name: string;
  sessions: number;
  first: number;
  last: number;
  deltaPct: number;
  stalled: boolean;
}

function exerciseTrends(history: SessionLite[]): Trend[] {
  const byName = new Map<string, number[]>();
  [...history].reverse().forEach((s) => {
    s.exercises.forEach((ex) => {
      const best = ex.sets.reduce((m, st) => Math.max(m, estimate1RM(st.weight, st.reps)), 0);
      if (best <= 0) return;
      const arr = byName.get(ex.name) ?? [];
      arr.push(best);
      byName.set(ex.name, arr);
    });
  });
  const trends: Trend[] = [];
  byName.forEach((points, name) => {
    const first = points[0];
    const last = points[points.length - 1];
    const deltaPct = first > 0 ? Math.round(((last - first) / first) * 1000) / 10 : 0;
    const recent = points.slice(-3);
    const stalled = points.length >= 3 && Math.max(...recent) <= Math.min(...recent) + 0.5;
    trends.push({ name, sessions: points.length, first, last, deltaPct, stalled });
  });
  return trends.sort((a, b) => b.sessions - a.sessions);
}

export function buildRefreshSummary(history: SessionLite[], profile: UserProfile): string {
  const cutoff = Date.now() - 28 * DAY;
  const last28 = history.filter((h) => h.startedAt >= cutoff);
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
      const tag = t.stalled ? "STALLED" : t.deltaPct > 0 ? `+${t.deltaPct}%` : `${t.deltaPct}%`;
      lines.push(`   • ${t.name}: ${t.first}→${t.last} ${profile.units} over ${t.sessions} sessions [${tag}]`);
    });
  } else {
    lines.push("- No completed sets yet; keep prescriptions conservative.");
  }
  return lines.join("\n");
}
