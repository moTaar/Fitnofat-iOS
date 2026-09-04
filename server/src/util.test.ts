import { describe, expect, it } from "vitest";
import { estimate1RM, goalLabel, slugify } from "./util";

describe("estimate1RM (Epley)", () => {
  it("returns the weight itself for a single", () => {
    expect(estimate1RM(100, 1)).toBe(100);
  });

  it("scales with reps", () => {
    // 100 * (1 + 5/30) = 116.67 → 117
    expect(estimate1RM(100, 5)).toBe(117);
    expect(estimate1RM(100, 10)).toBe(133);
  });

  it("is monotonic in both weight and reps", () => {
    expect(estimate1RM(100, 5)).toBeGreaterThan(estimate1RM(100, 3));
    expect(estimate1RM(120, 5)).toBeGreaterThan(estimate1RM(100, 5));
  });

  it("returns 0 for non-productive sets rather than NaN or a negative", () => {
    // Bodyweight and cardio entries arrive here with 0 weight; a 1RM is
    // meaningless for them and must not poison the analytics summary.
    expect(estimate1RM(0, 10)).toBe(0);
    expect(estimate1RM(100, 0)).toBe(0);
    expect(estimate1RM(-50, 5)).toBe(0);
    expect(estimate1RM(100, -3)).toBe(0);
  });
});

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Barbell Bench Press")).toBe("barbell-bench-press");
  });

  it("collapses runs of punctuation and trims the edges", () => {
    expect(slugify("  Dumbbell   Fly's!! ")).toBe("dumbbell-fly-s");
    expect(slugify("---Squat---")).toBe("squat");
  });

  it("is stable, so the same exercise name always hits the same cache row", () => {
    expect(slugify("Pull-Up")).toBe(slugify("Pull Up"));
    expect(slugify("PULL UP")).toBe(slugify("pull up"));
  });
});

describe("goalLabel", () => {
  it("maps known goals", () => {
    expect(goalLabel("hypertrophy")).toBe("Muscle (Hypertrophy)");
  });
  it("passes unknown goals through unchanged", () => {
    expect(goalLabel("mobility")).toBe("mobility");
  });
});
