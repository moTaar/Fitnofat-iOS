import { describe, expect, it } from "vitest";
import { HALF_LIFE_DAYS, muscleLoads, regionsFor, targetsFor } from "./muscles";
import { profileGaps } from "./healthProfile";
import type { HealthProfile, LoggedExercise, MuscleGroup, WorkoutSession } from "./types";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 25, 12);

function ex(name: string, muscleGroup: MuscleGroup, sets = 3, extra: Partial<LoggedExercise> = {}): LoggedExercise {
  return {
    exerciseId: name,
    name,
    muscleGroup,
    restSeconds: 90,
    sets: Array.from({ length: sets }, () => ({ weight: 50, reps: 8, completed: true })),
    ...extra,
  };
}

function session(daysAgo: number, exercises: LoggedExercise[]): WorkoutSession {
  return {
    id: `s-${daysAgo}-${exercises[0]?.name}`,
    routineName: "Test",
    startedAt: NOW - daysAgo * DAY,
    durationSec: 3600,
    exercises,
    totalVolume: 0,
    synced: true,
  };
}

describe("regionsFor", () => {
  it("does not let a specific phrase also match the generic one", () => {
    expect([...regionsFor(["Front Delts"])]).toEqual(["delts"]);
    expect([...regionsFor(["Rear Delts"])]).toEqual(["delts_b"]);
    expect([...regionsFor(["Lower Back"])]).toEqual(["lowerback"]);
  });

  it("matches at word starts only", () => {
    expect(regionsFor(["Ankle Stability"]).size).toBe(0);
    expect([...regionsFor(["Abs"])]).toEqual(["abs"]);
    expect(regionsFor(["Lateral"]).has("lats")).toBe(false);
  });

  it("expands broad names", () => {
    expect(regionsFor(["Legs"])).toEqual(new Set(["quads", "hamstrings", "glutes"]));
  });
});

describe("targetsFor", () => {
  it("uses a supplied guide over the muscle group", () => {
    const t = targetsFor(ex("Mystery Lift", "Chest"), {
      primaryMuscles: ["Glutes"],
      secondaryMuscles: ["Hamstrings", "Glutes"],
    } as never);
    expect([...t.primary]).toEqual(["glutes"]);
    expect([...t.secondary]).toEqual(["hamstrings"]); // primary never doubles as secondary
  });

  it("falls back to the muscle group when nothing names the muscles", () => {
    const t = targetsFor(ex("Some Custom Curl", "Biceps"));
    expect(t.primary.has("biceps")).toBe(true);
  });
});

describe("muscleLoads", () => {
  it("lights the trained muscle and leaves the rest untouched", () => {
    const loads = muscleLoads([session(0, [ex("Some Custom Curl", "Biceps", 4)])], [], NOW);
    expect(loads.biceps.load).toBe(4);
    expect(loads.biceps.setsThisWeek).toBe(4);
    expect(loads.biceps.intensity).toBeGreaterThan(0);
    expect(loads.quads.load).toBe(0);
    expect(loads.quads.intensity).toBe(0);
  });

  it("halves the load every half-life", () => {
    const fresh = muscleLoads([session(0, [ex("Some Custom Curl", "Biceps", 4)])], [], NOW);
    const old = muscleLoads([session(HALF_LIFE_DAYS, [ex("Some Custom Curl", "Biceps", 4)])], [], NOW);
    expect(old.biceps.load).toBeCloseTo(fresh.biceps.load / 2, 1);
    expect(old.biceps.intensity).toBeLessThan(fresh.biceps.intensity);
  });

  it("grows with more training", () => {
    const once = muscleLoads([session(1, [ex("Some Custom Curl", "Biceps")])], [], NOW);
    const twice = muscleLoads(
      [session(1, [ex("Some Custom Curl", "Biceps")]), session(3, [ex("Some Custom Curl", "Biceps")])],
      [],
      NOW
    );
    expect(twice.biceps.intensity).toBeGreaterThan(once.biceps.intensity);
  });

  it("counts secondary muscles at half weight", () => {
    const loads = muscleLoads([session(0, [ex("Some Custom Press", "Chest", 4)])], [], NOW);
    expect(loads.chest.load).toBe(4);
    expect(loads.triceps.load).toBe(2);
    expect(loads.triceps.setsThisWeek).toBe(0); // only direct sets are counted
  });

  it("records when a muscle was last trained and ignores the far past", () => {
    const loads = muscleLoads(
      [session(2, [ex("Some Custom Curl", "Biceps")]), session(200, [ex("Some Custom Squat", "Legs")])],
      [],
      NOW
    );
    expect(loads.biceps.lastTrainedAt).toBe(NOW - 2 * DAY);
    expect(loads.quads.load).toBe(0);
  });

  it("picks up AI guides stored on library exercises", () => {
    const loads = muscleLoads(
      [session(0, [ex("Pallof Press", "Core", 3)])],
      [{ name: "Pallof Press", guide: { primaryMuscles: ["Obliques"] } as never }],
      NOW
    );
    expect(loads.obliques.load).toBe(3);
    expect(loads.abs.load).toBe(0);
  });
});

describe("profileGaps", () => {
  const health = (over: Partial<HealthProfile> = {}): HealthProfile => ({
    conditions: [], allergies: [], medications: [], surgeries: [], familyHistory: [], ...over,
  });
  const body = { bodyweightKg: 80, heightCm: 180, age: 30 };

  it("names what is missing", () => {
    expect(profileGaps(null, null)).toEqual(["body stats", "medical background"]);
    expect(profileGaps({ ...body, age: undefined }, health({ notes: "fine" }))).toEqual(["body stats"]);
  });

  it("accepts a healthy background with no conditions", () => {
    expect(profileGaps(body, health({ smoking: "never" }))).toEqual([]);
    expect(profileGaps(body, health({ notes: "   " }))).toEqual(["medical background"]);
  });
});
