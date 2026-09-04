// Tests for the progress analytics. These feed both the History charts and the
// summary the AI refresh reasons over, so a silent regression here quietly
// corrupts the training program the user is handed.

import { describe, expect, it } from "vitest";
import {
  currentStreak,
  exerciseSeries,
  exerciseTrends,
  personalRecords,
  rangeSummary,
  weekStats,
} from "./analytics";
import type { LoggedExercise, MuscleGroup, WorkoutSession } from "./types";

const DAY = 86_400_000;

/** A session `daysAgo` days back, at midday so it can't straddle a boundary. */
function session(daysAgo: number, exercises: Partial<LoggedExercise>[], over: Partial<WorkoutSession> = {}): WorkoutSession {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return {
    id: `s${daysAgo}-${Math.random()}`,
    routineName: "Test Day",
    startedAt: d.getTime() - daysAgo * DAY,
    endedAt: d.getTime() - daysAgo * DAY + 3_600_000,
    durationSec: 3600,
    totalVolume: 1000,
    calories: 300,
    synced: true,
    exercises: exercises.map((e, i) => ({
      exerciseId: `e${i}`,
      name: `Exercise ${i}`,
      muscleGroup: "Chest",
      sets: [],
      ...e,
    })) as LoggedExercise[],
    ...over,
  } as WorkoutSession;
}

const lift = (
  name: string,
  weight: number,
  reps: number,
  muscleGroup: MuscleGroup = "Chest"
): Partial<LoggedExercise> => ({
  name,
  muscleGroup,
  sets: [{ weight, reps, completed: true }] as LoggedExercise["sets"],
});

describe("currentStreak", () => {
  it("is 0 with no history", () => {
    expect(currentStreak([])).toBe(0);
  });

  it("counts consecutive training days ending today", () => {
    expect(currentStreak([session(0, []), session(1, []), session(2, [])])).toBe(3);
  });

  it("does not break when today has no session yet", () => {
    // Someone who trained yesterday and hasn't been in today still has a
    // streak — breaking it at midnight would be punishing and wrong.
    expect(currentStreak([session(1, []), session(2, [])])).toBe(2);
  });

  it("stops at the first missed day", () => {
    expect(currentStreak([session(0, []), session(1, []), session(3, [])])).toBe(2);
  });

  it("counts two sessions on one day once", () => {
    expect(currentStreak([session(0, []), session(0, []), session(1, [])])).toBe(2);
  });

  it("is 0 when the last session is too long ago", () => {
    expect(currentStreak([session(5, [])])).toBe(0);
  });
});

describe("weekStats", () => {
  it("reports zero progress against a goal with no sessions", () => {
    const s = weekStats([], 4);
    expect(s).toMatchObject({ trained: 0, goal: 4, volume: 0, pct: 0 });
  });

  it("sums volume and calories for the current week only", () => {
    // 30 days back is definitely outside this week whatever day it is today.
    const s = weekStats([session(0, []), session(30, [])], 4);
    expect(s.trained).toBe(1);
    expect(s.volume).toBe(1000);
    expect(s.calories).toBe(300);
  });

  it("caps completion at 100% when the goal is beaten", () => {
    const s = weekStats([session(0, []), session(0, []), session(0, [])], 2);
    expect(s.pct).toBe(100);
  });

  it("does not divide by a zero goal", () => {
    expect(weekStats([session(0, [])], 0).pct).toBe(0);
  });
});

describe("exerciseTrends", () => {
  it("returns nothing for an empty history", () => {
    expect(exerciseTrends([])).toEqual([]);
  });

  it("tracks a weighted lift by estimated 1RM and reports improvement", () => {
    const history = [
      session(0, [lift("Bench Press", 100, 5)]),
      session(7, [lift("Bench Press", 90, 5)]),
      session(14, [lift("Bench Press", 80, 5)]),
    ];
    const [trend] = exerciseTrends(history);
    expect(trend.name).toBe("Bench Press");
    expect(trend.metric).toBe("e1rm");
    expect(trend.sessions).toBe(3);
    // history is newest-first, so `first` must be the OLDEST session.
    expect(trend.first).toBeLessThan(trend.last);
    expect(trend.deltaPct).toBeGreaterThan(0);
    expect(trend.best).toBe(trend.last);
  });

  it("flags a lift as stalled when the last three sessions are flat", () => {
    const flat = [
      session(0, [lift("Squat", 100, 5)]),
      session(7, [lift("Squat", 100, 5)]),
      session(14, [lift("Squat", 100, 5)]),
    ];
    expect(exerciseTrends(flat)[0].stalled).toBe(true);
  });

  it("does not flag a progressing lift as stalled", () => {
    const rising = [
      session(0, [lift("Squat", 120, 5)]),
      session(7, [lift("Squat", 110, 5)]),
      session(14, [lift("Squat", 100, 5)]),
    ];
    expect(exerciseTrends(rising)[0].stalled).toBe(false);
  });

  it("needs at least three sessions before calling anything stalled", () => {
    const two = [session(0, [lift("Squat", 100, 5)]), session(7, [lift("Squat", 100, 5)])];
    expect(exerciseTrends(two)[0].stalled).toBe(false);
  });

  it("keeps bodyweight work, measuring it in reps rather than dropping it", () => {
    const history = [
      session(0, [lift("Pull-Up", 0, 12, "Back")]),
      session(7, [lift("Pull-Up", 0, 8, "Back")]),
    ];
    const [trend] = exerciseTrends(history);
    expect(trend.metric).toBe("reps");
    expect(trend.first).toBe(8);
    expect(trend.last).toBe(12);
  });

  it("orders exercises by how much data each has", () => {
    const history = [
      session(0, [lift("Bench Press", 100, 5), lift("Fly", 20, 12)]),
      session(7, [lift("Bench Press", 95, 5)]),
      session(14, [lift("Bench Press", 90, 5)]),
    ];
    expect(exerciseTrends(history).map((t) => t.name)).toEqual(["Bench Press", "Fly"]);
  });
});

describe("exerciseSeries", () => {
  it("returns chronological points for one exercise", () => {
    const history = [
      session(0, [lift("Bench Press", 100, 5)]),
      session(7, [lift("Bench Press", 90, 5)]),
    ];
    const series = exerciseSeries(history, "Bench Press");
    expect(series.points).toHaveLength(2);
    expect(series.points[0].value).toBeLessThan(series.points[1].value);
  });

  it("returns nothing for an exercise that was never logged", () => {
    expect(exerciseSeries([session(0, [lift("Bench Press", 100, 5)])], "Deadlift").points).toEqual([]);
  });
});

describe("personalRecords", () => {
  it("reports the best-ever value per exercise", () => {
    const history = [
      session(0, [lift("Bench Press", 90, 5)]), // most recent, but not the best
      session(7, [lift("Bench Press", 110, 5)]),
      session(14, [lift("Bench Press", 100, 5)]),
    ];
    const [pr] = personalRecords(history);
    expect(pr.name).toBe("Bench Press");
    // 110 × (1 + 5/30) = 128.3 → 128
    expect(pr.value).toBe(128);
  });

  it("is empty with no history", () => {
    expect(personalRecords([])).toEqual([]);
  });
});

describe("rangeSummary", () => {
  it("counts only sessions inside the window", () => {
    const history = [session(1, []), session(10, []), session(90, [])];
    expect(rangeSummary(history, 28).sessions).toBe(2);
  });

  it("is all zeroes for an empty history", () => {
    const s = rangeSummary([], 28);
    expect(s.sessions).toBe(0);
    expect(s.volume).toBe(0);
  });
});
