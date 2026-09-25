import { describe, expect, it } from "vitest";
import {
  applyMeasurement, issuePatchToRow, keyBase, profileToRow, rowToExercise, rowToHealthProfile,
  rowToProfile, rowToSubscription, rowToWorkout, rulePatchToRow, uniqueKey, workoutToRow,
} from "./mappers";
import { toApiError } from "./db";
import { AuthExpiredError } from "./errors";
import { deepLinkToRoute } from "./native";

describe("profile mapping", () => {
  it("round-trips the fields the app edits", () => {
    const row = profileToRow("u1", {
      name: "Sam",
      goal: "strength",
      daysPerWeek: 4,
      equipmentPrefs: { machines: "exclude" },
      cuisine: "korean",
      onboarded: true,
    });
    expect(row).toMatchObject({
      user_id: "u1",
      name: "Sam",
      goal: "strength",
      days_per_week: 4,
      equipment_prefs: { machines: "exclude" },
      cuisine: "korean",
      onboarded: true,
    });
    // Unset fields are left out rather than nulled, so a partial update
    // doesn't wipe what it didn't mention.
    expect("bodyweight_kg" in row).toBe(false);

    const back = rowToProfile({ ...row, units: "kg", bodyweight_kg: "82.5" });
    expect(back.daysPerWeek).toBe(4);
    expect(back.bodyweightKg).toBe(82.5);
    expect(back.equipmentPrefs).toEqual({ machines: "exclude" });
  });
});

describe("workout mapping", () => {
  it("drops a routine id that isn't a uuid instead of failing the sync", () => {
    const base = { clientId: "c1", routineName: "Push", startedAt: 0, durationSec: 60.4, totalVolume: 100, exercises: [] };
    expect(workoutToRow("u", { ...base, routineId: "ses_local" }).routine_id).toBeNull();
    const uuid = "123e4567-e89b-12d3-a456-426614174000";
    const row = workoutToRow("u", { ...base, routineId: uuid });
    expect(row.routine_id).toBe(uuid);
    expect(row.duration_sec).toBe(60);
    expect(row.calories).toBe(0);
  });

  it("marks rows from the database as synced and parses numerics", () => {
    const w = rowToWorkout({
      id: "w1",
      client_id: "c1",
      routine_name: "Legs",
      started_at: "2026-01-02T10:00:00Z",
      ended_at: null,
      duration_sec: 3600,
      total_volume: "12000",
      calories: "412.5",
      exercises: [],
    });
    expect(w.synced).toBe(true);
    expect(w.totalVolume).toBe(12000);
    expect(w.calories).toBe(412.5);
    expect(w.endedAt).toBeUndefined();
  });
});

describe("exercise mapping", () => {
  it("uses the slug as the id and only AI rows as non-custom", () => {
    expect(rowToExercise({ slug: "x", name: "X", source: "ai", met: "3.5" })).toMatchObject({ id: "x", isCustom: false, met: 3.5 });
    expect(rowToExercise({ slug: "y", name: "Y", source: "custom", video_id: "abc" })).toMatchObject({ isCustom: true, videoId: "abc" });
  });
});

describe("subscription mapping", () => {
  it("treats a missing row as free", () => {
    expect(rowToSubscription(null)).toEqual({ plan: "free", status: "inactive", currentPeriodEnd: null });
  });
});

describe("health mapping", () => {
  it("gives an empty background for a user with no row", () => {
    expect(rowToHealthProfile(null)).toEqual({ conditions: [], allergies: [], medications: [], surgeries: [], familyHistory: [] });
  });

  it("stamps resolved_at from the status and clamps progress", () => {
    expect(issuePatchToRow({ status: "resolved" }).resolved_at).toEqual(expect.any(String));
    expect(issuePatchToRow({ status: "open" }).resolved_at).toBeNull();
    expect("resolved_at" in issuePatchToRow({ title: "x" })).toBe(false);
    expect(issuePatchToRow({ progress: 140 }).progress).toBe(100);
  });

  it("hands every edited rule to the user", () => {
    expect(rulePatchToRow({ status: "paused" })).toMatchObject({ status: "paused", user_edited: true });
  });

  it("mirrors a measurement onto the matching metric only", () => {
    const metrics = [{ label: "Pain", unit: "/10" }, { label: "Weight", unit: "kg" }];
    const out = applyMeasurement(metrics, " pain ", 4, 1000);
    expect(out[0]).toEqual({ label: "Pain", unit: "/10", latest: 4, latestAt: 1000 });
    expect(out[1]).toBe(metrics[1]);
  });
});

describe("keys", () => {
  it("slugs titles and finds the first free suffix", () => {
    expect(keyBase("Knee pain (left)!", "issue")).toBe("knee-pain-left");
    expect(keyBase("!!!", "issue")).toBe("issue");
    expect(uniqueKey("knee", [])).toBe("knee");
    expect(uniqueKey("knee", ["knee", "knee-2", "knee-brace"])).toBe("knee-3");
  });
});

describe("toApiError", () => {
  it("maps an expired JWT to AuthExpiredError", () => {
    const err = toApiError({ code: "PGRST301", message: "JWT expired", details: "", hint: "", name: "PostgrestError" } as never, 401);
    expect(err).toBeInstanceOf(AuthExpiredError);
  });

  it("maps a failed fetch to a friendly offline message", () => {
    const err = toApiError({ code: "", message: "TypeError: Failed to fetch", details: "", hint: "", name: "PostgrestError" } as never);
    expect(err.code).toBe("network");
    expect(err.message).toMatch(/offline/);
  });

  it("keeps the database's message and code otherwise", () => {
    const err = toApiError({ code: "23505", message: "duplicate key", details: "", hint: "", name: "PostgrestError" } as never, 409);
    expect(err.status).toBe(409);
    expect(err.code).toBe("23505");
  });
});

describe("deepLinkToRoute", () => {
  it("maps the password-reset link, keeping the token fragment", () => {
    expect(deepLinkToRoute("fitnofat://reset-password#access_token=abc&type=recovery", "fitnofat")).toBe(
      "/reset-password#access_token=abc&type=recovery"
    );
  });

  it("keeps query strings and nested paths", () => {
    expect(deepLinkToRoute("fitnofat://settings?billing=success", "fitnofat")).toBe("/settings?billing=success");
    expect(deepLinkToRoute("fitnofat:///routines/new", "fitnofat")).toBe("/routines/new");
    expect(deepLinkToRoute("fitnofat://", "fitnofat")).toBe("/");
  });

  it("ignores other schemes and odd paths", () => {
    expect(deepLinkToRoute("https://evil.example/reset-password", "fitnofat")).toBeNull();
    expect(deepLinkToRoute("fitnofat://..%2F..", "fitnofat")).toBeNull();
  });
});
