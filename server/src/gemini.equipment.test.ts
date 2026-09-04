// Unit tests for the equipment constraint model — the layer that stops the AI
// programming gear the athlete doesn't own. It fails silently when it regresses
// (the user just gets a program they can't perform), so it's worth pinning down.

import { describe, expect, it } from "vitest";
import { __equipment } from "./gemini";
import type { AIProgramResponse, UserProfile } from "./types";

const {
  detectTokens,
  allowedTokens,
  exerciseViolations,
  findEquipmentViolations,
  enforceEquipment,
} = __equipment;

const profile = (over: Partial<UserProfile> = {}): UserProfile =>
  ({
    name: "Test",
    goal: "hypertrophy",
    equipment: "full_gym",
    experience: "intermediate",
    category: "weightlifting",
    daysPerWeek: 4,
    sessionMinutes: 60,
    units: "kg",
    ...over,
  }) as UserProfile;

describe("detectTokens", () => {
  it("detects each restricted implement from an exercise name", () => {
    expect(detectTokens("Barbell Back Squat")).toEqual(["barbell"]);
    expect(detectTokens("Dumbbell Bench Press")).toEqual(["dumbbell"]);
    expect(detectTokens("Cable Fly")).toEqual(["cable"]);
    expect(detectTokens("Leg Press Machine")).toEqual(["machine"]);
    expect(detectTokens("Kettlebell Swing")).toEqual(["kettlebell"]);
  });

  it("understands the common abbreviations and misspellings", () => {
    expect(detectTokens("DB Curl")).toContain("dumbbell");
    expect(detectTokens("Dumbell Row")).toContain("dumbbell");
    expect(detectTokens("KB Snatch")).toContain("kettlebell");
    expect(detectTokens("EZ-Bar Curl")).toContain("barbell");
  });

  it("treats implicit cable movements as cable work", () => {
    // These names never say "cable" but cannot be done without a stack.
    expect(detectTokens("Lat Pulldown")).toContain("cable");
    expect(detectTokens("Tricep Pushdown")).toContain("cable");
    expect(detectTokens("Face Pull")).toContain("cable");
  });

  it("recognises named machines without the word machine", () => {
    expect(detectTokens("Hack Squat")).toContain("machine");
    expect(detectTokens("Pec Deck")).toContain("machine");
    expect(detectTokens("Smith Squat")).toContain("machine");
  });

  it("does not flag bodyweight staples", () => {
    // Push-ups, dips and pull-ups must never count as violations, or a
    // bodyweight athlete ends up with an empty program.
    expect(detectTokens("Push-Up")).toEqual([]);
    expect(detectTokens("Pull-Up")).toEqual([]);
    expect(detectTokens("Bodyweight Dip")).toEqual([]);
    expect(detectTokens("Plank")).toEqual([]);
  });

  it("resolves a banded variant of a cable movement to the band only", () => {
    // "Banded Lat Pulldown" needs a band, not a cable stack — flagging both
    // would wrongly exclude it for a resistance-band athlete.
    const tokens = detectTokens("Banded Lat Pulldown");
    expect(tokens).toEqual(["resistance_band"]);
    expect(tokens).not.toContain("cable");
  });

  it("detects several implements in one name", () => {
    expect(detectTokens("Dumbbell and Barbell Complex").sort()).toEqual(["barbell", "dumbbell"]);
  });
});

describe("allowedTokens — presets", () => {
  it("returns null (no restriction) for a full gym", () => {
    expect(allowedTokens(profile({ equipment: "full_gym" }))).toBeNull();
  });

  it("grants nothing for a bodyweight athlete", () => {
    expect([...allowedTokens(profile({ equipment: "bodyweight" }))!]).toEqual([]);
  });

  it("grants the implements the preset covers", () => {
    expect([...allowedTokens(profile({ equipment: "dumbbells" }))!]).toEqual(["dumbbell"]);
    expect([...allowedTokens(profile({ equipment: "home_gym" }))!].sort()).toEqual([
      "barbell",
      "dumbbell",
    ]);
    expect([...allowedTokens(profile({ equipment: "machines" }))!].sort()).toEqual([
      "cable",
      "machine",
    ]);
  });
});

describe("allowedTokens — explicit preferences override the preset", () => {
  it("removes an implement the preset granted", () => {
    const allowed = allowedTokens(
      profile({ equipment: "home_gym", equipmentPrefs: { freeWeights: "exclude" } })
    )!;
    expect(allowed.has("barbell")).toBe(false);
    expect(allowed.has("dumbbell")).toBe(false);
  });

  it("adds an implement the preset withheld", () => {
    const allowed = allowedTokens(
      profile({ equipment: "bodyweight", equipmentPrefs: { bands: "include" } })
    )!;
    expect(allowed.has("resistance_band")).toBe(true);
  });

  it("constrains an otherwise-unrestricted full-gym athlete", () => {
    // A full-gym user who excludes machines should stop getting machine work,
    // even though the preset itself imposes no restriction.
    const allowed = allowedTokens(
      profile({ equipment: "full_gym", equipmentPrefs: { machines: "exclude" } })
    );
    expect(allowed).not.toBeNull();
    expect(allowed!.has("machine")).toBe(false);
    expect(allowed!.has("cable")).toBe(false);
    expect(allowed!.has("barbell")).toBe(true);
  });

  it("changes nothing when no preference is set", () => {
    expect(allowedTokens(profile({ equipment: "dumbbells", equipmentPrefs: {} }))).toEqual(
      allowedTokens(profile({ equipment: "dumbbells" }))
    );
  });

  it("treats freeWeights as every hand-held implement, not just dumbbells", () => {
    const allowed = allowedTokens(
      profile({ equipment: "bodyweight", equipmentPrefs: { freeWeights: "include" } })
    )!;
    expect(allowed.has("dumbbell")).toBe(true);
    expect(allowed.has("barbell")).toBe(true);
    expect(allowed.has("kettlebell")).toBe(true);
  });
});

describe("exerciseViolations", () => {
  const allowed = new Set(["dumbbell"]) as Set<any>;

  it("flags equipment the athlete lacks", () => {
    expect(
      exerciseViolations({ name: "Barbell Row", equipment: "Barbell" } as any, allowed)
    ).toEqual(["barbell"]);
  });

  it("passes movements within the allowance", () => {
    expect(
      exerciseViolations({ name: "Dumbbell Row", equipment: "Dumbbell" } as any, allowed)
    ).toEqual([]);
  });

  it("catches gear declared only in the equipment field", () => {
    // The model sometimes gives a neutral name and reveals the machine in
    // `equipment` — both fields have to be checked.
    expect(
      exerciseViolations({ name: "Chest Press", equipment: "Machine" } as any, allowed)
    ).toEqual(["machine"]);
  });
});

// ── Whole-program checks ─────────────────────────────────────────────────────
const program = (): AIProgramResponse =>
  ({
    summary: "test",
    routines: [
      {
        name: "Upper",
        dayLabel: "Mon",
        exercises: [
          { name: "Push-Up", equipment: "Bodyweight", sets: [] },
          { name: "Barbell Bench Press", equipment: "Barbell", sets: [] },
          { name: "Dumbbell Row", equipment: "Dumbbell", sets: [] },
        ],
      },
      {
        name: "Lower",
        dayLabel: "Wed",
        exercises: [{ name: "Hack Squat", equipment: "Machine", sets: [] }],
      },
    ],
  }) as unknown as AIProgramResponse;

describe("findEquipmentViolations", () => {
  it("reports nothing when the athlete is unrestricted", () => {
    expect(findEquipmentViolations(program(), null)).toEqual([]);
  });

  it("reports every offending exercise with its routine and missing gear", () => {
    const found = findEquipmentViolations(program(), new Set(["dumbbell"]) as Set<any>);
    expect(found).toEqual([
      { routine: "Upper", name: "Barbell Bench Press", tokens: ["barbell"] },
      { routine: "Lower", name: "Hack Squat", tokens: ["machine"] },
    ]);
  });
});

describe("enforceEquipment", () => {
  it("leaves an unrestricted program untouched", () => {
    const p = program();
    expect(enforceEquipment(p, null)).toBe(p);
  });

  it("drops the non-compliant exercises", () => {
    const out = enforceEquipment(program(), new Set(["dumbbell"]) as Set<any>);
    expect(out.routines[0].exercises.map((e) => e.name)).toEqual(["Push-Up", "Dumbbell Row"]);
  });

  it("never ships an empty training day", () => {
    // If every movement in a routine is non-compliant, keeping the originals is
    // strictly better than handing the user a blank day.
    const out = enforceEquipment(program(), new Set(["dumbbell"]) as Set<any>);
    expect(out.routines[1].exercises).toHaveLength(1);
    expect(out.routines[1].exercises[0].name).toBe("Hack Squat");
  });

  it("does not mutate the program it was given", () => {
    const p = program();
    enforceEquipment(p, new Set(["dumbbell"]) as Set<any>);
    expect(p.routines[0].exercises).toHaveLength(3);
  });
});
