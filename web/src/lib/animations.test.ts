import { describe, expect, it } from "vitest";
import { knownArchetype } from "./animations";

// The stick figure used to fall back to "squat" for anything it couldn't place,
// so a cable crossover, a Pallof press and a farmer's carry all animated as a
// barbell squat. Now that a real demo video sits above it, the figure is only
// worth rendering when we actually know the movement — these tests guard the
// "don't know" half, which is the half that was lying.

describe("knownArchetype", () => {
  it("honours an AI-supplied pattern over name guessing", () => {
    expect(knownArchetype("Some Novel Machine Thing", "pulldown")).toBe("pulldown");
  });

  it("ignores a pattern that isn't a real archetype", () => {
    expect(knownArchetype("Barbell Back Squat", "interpretive-dance")).toBe("squat");
  });

  it("resolves seed-library exercises exactly", () => {
    expect(knownArchetype("Barbell Bench Press")).toBe("press_flat");
    expect(knownArchetype("Lat Pulldown")).toBe("pulldown");
  });

  it("keeps the specific-before-generic keyword ordering", () => {
    expect(knownArchetype("Seated Leg Curl")).toBe("leg_machine");
    expect(knownArchetype("Hammer Curl")).toBe("curl");
    expect(knownArchetype("Tricep Pushdown")).toBe("extension");
    expect(knownArchetype("Concept2 Rowing Machine")).toBe("cardio");
  });

  it("returns undefined instead of a wrong archetype for the long tail", () => {
    // Previously every one of these animated as a squat.
    expect(knownArchetype("Pallof Press")).toBeUndefined();
    expect(knownArchetype("Farmer's Carry")).toBeUndefined();
    expect(knownArchetype("Turkish Get-Up")).toBeUndefined();
    expect(knownArchetype("Cable Crossover")).toBeUndefined();
  });

  it("still recognises a real squat", () => {
    expect(knownArchetype("Goblet Squat")).toBe("squat");
  });
});
