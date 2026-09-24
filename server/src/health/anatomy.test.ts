// The anatomy layer's numbers are handed to the model as conclusions it is told
// not to second-guess, so a wrong "improving" here is repeated with confidence.

import { describe, expect, it } from "vitest";
import {
  betterWhen, bodyCalcs, daysSinceCheckIn, meetsTarget, metricTrend, regionLoad, regionsIn, trendLine,
} from "./anatomy";
import type { HealthIssue, HealthIssueEvent, UserProfile } from "../types";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 24);

const reading = (metric: string, value: number, daysAgo: number): HealthIssueEvent => ({
  id: `${metric}-${daysAgo}`,
  issueId: "i",
  kind: "measurement",
  metric,
  value,
  createdAt: NOW - daysAgo * DAY,
});

const issue = (over: Partial<HealthIssue> = {}): HealthIssue => ({
  id: "i",
  key: "k",
  title: "Something",
  category: "pain",
  status: "open",
  severity: "moderate",
  progress: 0,
  actionPlan: [],
  metrics: [],
  redFlags: [],
  source: "ai",
  createdAt: NOW - 60 * DAY,
  updatedAt: NOW - 60 * DAY,
  ...over,
});

describe("metricTrend", () => {
  it("calls a falling pain score improving", () => {
    const i = issue({ events: [reading("Pain", 7, 20), reading("Pain", 4, 1)] });
    const t = metricTrend(i, { label: "Pain" });
    expect(t).toMatchObject({ first: 7, latest: 4, readings: 2, direction: "improving", spanDays: 19 });
  });

  it("calls a falling sleep target worsening when higher is better", () => {
    const i = issue({ events: [reading("Sleep", 7.5, 14), reading("Sleep", 6, 0)] });
    expect(metricTrend(i, { label: "Sleep", target: "at least 7" }).direction).toBe("worsening");
  });

  it("treats a move within 5% as steady", () => {
    const i = issue({ events: [reading("Pain", 4, 10), reading("Pain", 3.9, 0)] });
    expect(metricTrend(i, { label: "Pain" }).direction).toBe("steady");
  });

  it("does not judge a metric whose good direction is unknown", () => {
    const i = issue({ events: [reading("Resting HR", 60, 10), reading("Resting HR", 66, 0)] });
    expect(metricTrend(i, { label: "Resting HR" }).direction).toBe("rising");
  });

  it("matches event metrics case-insensitively and in time order", () => {
    const i = issue({ events: [reading("pain ", 3, 0), reading("PAIN", 8, 30)] });
    expect(metricTrend(i, { label: "Pain" })).toMatchObject({ first: 8, latest: 3 });
  });

  it("falls back to the metric's own latest reading when there are no events", () => {
    const i = issue({ events: [] });
    expect(metricTrend(i, { label: "Pain", latest: 5, latestAt: NOW }).direction).toBe("single");
    expect(metricTrend(i, { label: "Pain" }).direction).toBe("none");
  });

  it("says whether a numeric target is met", () => {
    const i = issue({ events: [reading("Pain", 5, 9), reading("Pain", 1, 0)] });
    const t = metricTrend(i, { label: "Pain", target: "< 2" });
    expect(t.onTarget).toBe(true);
    expect(trendLine(t)).toContain("target < 2 — met");
  });
});

describe("targets", () => {
  it("reads which end is good from the target, then the label", () => {
    expect(betterWhen({ label: "Steps", target: "≥ 8000" })).toBe("higher");
    expect(betterWhen({ label: "Weight", target: "trending down" })).toBe("lower");
    expect(betterWhen({ label: "Pain (0-10)" })).toBe("lower");
    expect(betterWhen({ label: "Resting HR" })).toBeUndefined();
  });

  it("evaluates numeric targets", () => {
    expect(meetsTarget(1.5, "< 2")).toBe(true);
    expect(meetsTarget(7, "at least 7")).toBe(true);
    expect(meetsTarget(140, "under 130")).toBe(false);
    expect(meetsTarget(3, "trending down")).toBeUndefined();
  });
});

describe("regions", () => {
  it("maps everyday words onto canonical regions", () => {
    expect(regionsIn("patellar tendon and my achilles")).toEqual(["knee", "lower leg"]);
    expect(regionsIn("lower back tightness")).toEqual(["lower back"]);
    expect(regionsIn("a headache")).toEqual(["head"]);
  });

  it("counts open issues per region and ignores closed ones", () => {
    const load = regionLoad([
      issue({ bodyRegion: "left knee" }),
      issue({ bodyRegion: "right knee" }),
      issue({ title: "Shoulder impingement" }),
      issue({ bodyRegion: "wrist", status: "resolved" }),
    ]);
    expect(load).toEqual([
      { region: "knee", open: 2 },
      { region: "shoulder", open: 1 },
    ]);
  });
});

describe("checks and calculations", () => {
  it("counts days since the last check-in, ignoring AI reviews", () => {
    const i = issue({
      events: [
        reading("Pain", 4, 12),
        { id: "r", issueId: "i", kind: "ai_review", createdAt: NOW - DAY },
      ],
    });
    expect(daysSinceCheckIn(i, NOW)).toBe(12);
    expect(daysSinceCheckIn(issue({ events: [] }), NOW)).toBeUndefined();
  });

  it("computes BMI and protein per kilo", () => {
    const calcs = bodyCalcs(
      { bodyweightKg: 80, heightCm: 180 } as UserProfile,
      { trainingDay: { targets: { calories: 2600, protein: 160, carbs: 300, fats: 80 } } } as any
    );
    expect(calcs).toEqual({ bmi: 24.7, bmiCategory: "healthy range", proteinPerKg: 2 });
    expect(bodyCalcs({} as UserProfile)).toEqual({});
  });
});
