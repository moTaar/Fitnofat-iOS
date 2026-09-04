import { describe, expect, it } from "vitest";
import {
  DEFAULT_BODYWEIGHT_KG,
  estimateExerciseCalories,
  exerciseDuration,
  kcalFromMet,
  metFromName,
  needsAiMet,
  resolveKind,
  resolveMet,
} from "./calories";

describe("metFromName", () => {
  it("matches the cardio keyword table", () => {
    expect(metFromName("Treadmill Run")).toBe(9.5);
    expect(metFromName("Assault Bike")).toBe(7.5);
    expect(metFromName("Jump Rope")).toBe(11);
  });

  it("is case-insensitive", () => {
    expect(metFromName("SWIMMING")).toBe(metFromName("swimming"));
  });

  it("prefers the more specific entry when two could match", () => {
    // "power yoga" is listed above the generic "yoga" entry precisely so a
    // vinyasa session isn't costed like seated meditation.
    expect(metFromName("Power Yoga Flow")).toBe(4);
    expect(metFromName("Restorative Yoga")).toBe(2.5);
  });

  it("returns null for movements the table doesn't know", () => {
    expect(metFromName("Barbell Bench Press")).toBeNull();
    expect(metFromName("")).toBeNull();
    expect(metFromName(undefined)).toBeNull();
  });

  it("respects word boundaries rather than matching substrings", () => {
    // "row" must not fire on "Narrow Grip Press" — that would misprice a
    // pressing movement as steady-state cardio.
    expect(metFromName("Narrow Grip Bench Press")).toBeNull();
  });
});

describe("resolveKind", () => {
  it("trusts an explicit kind", () => {
    expect(resolveKind({ kind: "hold", muscleGroup: "Cardio", sets: [] })).toBe("hold");
  });
  it("infers cardio from the muscle group", () => {
    expect(resolveKind({ muscleGroup: "Cardio", sets: [] })).toBe("cardio");
  });
  it("defaults to strength", () => {
    expect(resolveKind({ muscleGroup: "Chest", sets: [] })).toBe("strength");
  });
});

describe("resolveMet layering", () => {
  const sets = [{ reps: 10 }];

  it("prefers a cached MET over the table", () => {
    const r = resolveMet({ name: "Treadmill Run", sets }, 12);
    expect(r.source).toBe("cache");
    expect(r.met).toBe(12); // no RPE data ⇒ multiplier of 1
  });

  it("falls back to the table when there is no cached value", () => {
    expect(resolveMet({ name: "Treadmill Run", sets }).source).toBe("table");
  });

  it("falls back to a generic MET for unknown movements", () => {
    expect(resolveMet({ name: "Barbell Bench Press", sets }).source).toBe("generic");
  });

  it("ignores a zero or negative cached MET", () => {
    // An unresolved lookup stores 0; treating that as authoritative would
    // report every session as burning nothing.
    expect(resolveMet({ name: "Treadmill Run", sets }, 0).source).toBe("table");
    expect(resolveMet({ name: "Treadmill Run", sets }, -5).source).toBe("table");
  });

  it("scales with RPE, clamped to the documented range", () => {
    const easy = resolveMet({ name: "Treadmill Run", sets: [{ reps: 10, rpe: 1 }] }, 10).met;
    const hard = resolveMet({ name: "Treadmill Run", sets: [{ reps: 10, rpe: 10 }] }, 10).met;
    expect(easy).toBeCloseTo(7.6, 5); // 0.7 + 0.06*1 = 0.76
    expect(hard).toBeCloseTo(13, 5); // clamped at 1.3
    expect(hard).toBeGreaterThan(easy);
  });
});

describe("needsAiMet", () => {
  it("is true only when we fell through to a generic estimate", () => {
    expect(needsAiMet({ name: "Barbell Bench Press", sets: [{ reps: 5 }] })).toBe(true);
    expect(needsAiMet({ name: "Treadmill Run", sets: [{ reps: 5 }] })).toBe(false);
    expect(needsAiMet({ name: "Anything", sets: [{ reps: 5 }] }, 8)).toBe(false);
  });
});

describe("exerciseDuration", () => {
  it("uses explicit per-set durations when present", () => {
    expect(exerciseDuration({ kind: "hold", sets: [{ durationSec: 45 }, { durationSec: 30 }] })).toBe(75);
  });

  it("reads cardio/hold reps as legacy minutes when no duration is recorded", () => {
    expect(exerciseDuration({ kind: "cardio", sets: [{ reps: 20 }] })).toBe(20 * 60);
  });

  it("estimates strength work from reps plus rest", () => {
    // 2 sets × (10 reps × 3s + 60s rest)
    expect(exerciseDuration({ kind: "strength", sets: [{ reps: 10 }, { reps: 10 }] })).toBe(180);
  });

  it("honours a custom rest interval", () => {
    expect(exerciseDuration({ kind: "strength", restSeconds: 120, sets: [{ reps: 10 }] })).toBe(150);
  });
});

describe("kcalFromMet", () => {
  it("follows the ACSM formula", () => {
    // 10 MET × 3.5 × 75kg / 200 = 13.125 kcal/min × 30 min
    expect(kcalFromMet(10, 75, 30)).toBeCloseTo(393.75, 4);
  });

  it("substitutes a default bodyweight when none is known", () => {
    expect(kcalFromMet(10, 0, 30)).toBe(kcalFromMet(10, DEFAULT_BODYWEIGHT_KG, 30));
  });
});

describe("estimateExerciseCalories", () => {
  it("returns 0 for an exercise with no recorded work", () => {
    expect(estimateExerciseCalories({ kind: "strength", sets: [] })).toBe(0);
  });

  it("scales with bodyweight", () => {
    const ex = { name: "Treadmill Run", kind: "cardio" as const, sets: [{ durationSec: 1800 }] };
    expect(estimateExerciseCalories(ex, 100)).toBeGreaterThan(estimateExerciseCalories(ex, 60));
  });

  it("produces a plausible figure for a half-hour run", () => {
    const kcal = estimateExerciseCalories(
      { name: "Treadmill Run", kind: "cardio", sets: [{ durationSec: 1800 }] },
      75
    );
    expect(kcal).toBeGreaterThan(250);
    expect(kcal).toBeLessThan(500);
  });
});
