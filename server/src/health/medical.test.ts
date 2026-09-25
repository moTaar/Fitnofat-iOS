// Unit tests for the medical helper's safety-critical, non-networked logic:
// the emergency screen, the marker parsing that turns model text into database
// writes, and the reconciliation that keeps a re-review from trampling the
// user's own progress. All of it fails quietly in production if it regresses —
// a missed red flag or a reset checklist doesn't throw, it just does the wrong
// thing — so it's pinned down here.

import { afterEach, describe, expect, it } from "vitest";
import { config } from "../config";
import { reconcileIssues } from "./memory";
import { buildChatBrief } from "./privacy";
import {
  __reasoning, activeProvider, localReview, modelLabel, parseMedicalReply, profileGaps,
} from "./reasoning";
import {
  boundedData, detectRedFlags, EMERGENCY_NOTICE, issueKey, normalizeIssue, normalizeRecord,
  normalizeRule, normalizeRules,
} from "./safety";
import type { AIHealthReview, HealthIssue, HealthProfile, UserProfile } from "../types";

const { medicalFetch, hostOf, extractJsonArrayAfter } = __reasoning;

const profile = (over: Partial<UserProfile> = {}): UserProfile =>
  ({
    name: "Test",
    goal: "general",
    equipment: "full_gym",
    experience: "beginner",
    category: "mixed",
    daysPerWeek: 3,
    sessionMinutes: 60,
    units: "kg",
    ...over,
  }) as UserProfile;

const healthProfile = (over: Partial<HealthProfile> = {}): HealthProfile => ({
  conditions: [],
  allergies: [],
  medications: [],
  surgeries: [],
  familyHistory: [],
  ...over,
});

const issue = (over: Partial<HealthIssue> = {}): HealthIssue => ({
  id: "id-1",
  key: "left-shoulder-pain",
  title: "Left shoulder pain",
  category: "pain",
  status: "in_progress",
  severity: "moderate",
  progress: 50,
  actionPlan: [{ step: "Daily band external rotations", done: true }, { step: "Drop overhead press" }],
  metrics: [{ label: "Pain (0-10)", latest: 4, latestAt: 1000 }],
  redFlags: [],
  source: "ai",
  createdAt: 1,
  updatedAt: 2,
  ...over,
});

describe("detectRedFlags", () => {
  it("catches emergency symptoms", () => {
    expect(detectRedFlags("I've had chest pain since this morning")).toContain("chest pain or pressure");
    expect(detectRedFlags("can't breathe properly after the run")).toContain("difficulty breathing");
    expect(detectRedFlags("I passed out at the gym")).toContain("loss of consciousness");
    expect(detectRedFlags("been thinking about killing myself")).toContain("thoughts of self-harm");
    expect(detectRedFlags("I don't want to hurt myself but it crosses my mind")).toContain(
      "thoughts of self-harm"
    );
    expect(detectRedFlags("there's blood in my urine")).toContain("bleeding");
  });

  it("ignores ordinary training talk", () => {
    expect(detectRedFlags("my chest is sore after bench press")).toEqual([]);
    expect(detectRedFlags("I want to lose 5 kg and eat more protein")).toEqual([]);
    expect(detectRedFlags("")).toEqual([]);
  });

  it("does not report the same flag twice", () => {
    const flags = detectRedFlags("chest pain, and more chest pain");
    expect(flags.filter((f) => f === "chest pain or pressure")).toHaveLength(1);
  });
});

describe("normalizeIssue", () => {
  it("clamps unknown enum values to safe defaults", () => {
    const result = normalizeIssue({
      title: "Low ferritin",
      category: "haematology",
      severity: "catastrophic",
      confidence: "certain",
      summary: "Ferritin is low.",
    });
    expect(result).toMatchObject({ category: "other", severity: "moderate" });
    expect(result?.confidence).toBeUndefined();
  });

  it("derives a key from the title when the model omits one", () => {
    expect(normalizeIssue({ title: "Left Shoulder Pain!" })?.key).toBe("left-shoulder-pain");
  });

  it("rejects an issue with no title", () => {
    expect(normalizeIssue({ summary: "something" })).toBeNull();
  });

  it("caps plan steps, metrics and flags so one reply can't bloat a row", () => {
    const result = normalizeIssue({
      title: "Sleep debt",
      actionPlan: Array.from({ length: 30 }, (_, i) => ({ step: `step ${i}` })),
      metrics: Array.from({ length: 30 }, (_, i) => ({ label: `m${i}` })),
      redFlags: Array.from({ length: 30 }, (_, i) => `flag ${i}`),
    });
    expect(result!.actionPlan.length).toBeLessThanOrEqual(8);
    expect(result!.metrics.length).toBeLessThanOrEqual(5);
    expect(result!.redFlags.length).toBeLessThanOrEqual(5);
  });

  it("accepts plain strings where objects are expected", () => {
    const result = normalizeIssue({ title: "X", actionPlan: ["Walk daily"], metrics: ["Steps"] });
    expect(result!.actionPlan[0].step).toBe("Walk daily");
    expect(result!.metrics[0].label).toBe("Steps");
  });
});

describe("normalizeRecord", () => {
  it("falls back to `note` for an unknown kind", () => {
    expect(normalizeRecord({ title: "Something", kind: "mri" })?.kind).toBe("note");
  });

  it("clamps a future date to now", () => {
    const future = new Date(Date.now() + 86_400_000 * 365).toISOString();
    const at = normalizeRecord({ title: "Blood panel", occurredAt: future })!.occurredAt!;
    expect(at).toBeLessThanOrEqual(Date.now());
  });

  it("leaves occurredAt unset when the date is unparseable", () => {
    expect(normalizeRecord({ title: "X", occurredAt: "last tuesday" })?.occurredAt).toBeUndefined();
  });

  it("drops oversized or non-object data rather than truncating it", () => {
    expect(boundedData({ ferritin: 18 })).toEqual({ ferritin: 18 });
    expect(boundedData(["not", "an", "object"])).toEqual({});
    expect(boundedData({ blob: "x".repeat(5000) })).toEqual({});
  });
});

describe("parseMedicalReply", () => {
  it("extracts a trackable issue and keeps the prose above it", () => {
    const raw = `I'll track that for you.
[ISSUE]
{"key":"low-protein","title":"Protein intake below target","category":"nutrition","severity":"low","summary":"Averaging 90 g against a 140 g target.","actionPlan":[{"step":"Add a 30 g shake after training","cadence":"training days"}],"metrics":[{"label":"Daily protein","unit":"g","target":"140"}],"redFlags":[]}`;
    const reply = parseMedicalReply(raw, "gemini-2.5-pro (Gemini)");
    expect(reply.type).toBe("issue");
    expect(reply.text).toBe("I'll track that for you.");
    expect(reply.issue?.key).toBe("low-protein");
    expect(reply.model).toBe("gemini-2.5-pro (Gemini)");
  });

  it("extracts a history record", () => {
    const raw = `Noted.
[RECORD]
{"kind":"lab","title":"Ferritin 18 ng/mL","detail":"Below range","data":{"ferritin":18}}`;
    const reply = parseMedicalReply(raw, "m");
    expect(reply.type).toBe("record");
    expect(reply.record).toMatchObject({ kind: "lab", title: "Ferritin 18 ng/mL" });
  });

  it("never leaks raw marker JSON when the payload is malformed", () => {
    const reply = parseMedicalReply("Tracking it.\n[ISSUE]\n{broken json", "m");
    expect(reply.type).toBe("message");
    expect(reply.text).not.toContain("{");
    expect(reply.text).not.toContain("[ISSUE]");
  });

  it("strips the suggestions marker into chips", () => {
    const reply = parseMedicalReply("Eat more fibre.\n[SUGGESTIONS: How much? | Give me meals]", "m");
    expect(reply.type).toBe("message");
    expect(reply.text).toBe("Eat more fibre.");
    expect(reply.suggestions).toEqual(["How much?", "Give me meals"]);
  });

  it("prepends the emergency notice when the user's own words raised a flag", () => {
    const reply = parseMedicalReply("Here's some advice on stretching.", "m", ["chest pain or pressure"]);
    expect(reply.urgent).toBe(true);
    expect(reply.text.startsWith(EMERGENCY_NOTICE)).toBe(true);
  });

  it("escalates even when the flag is only in the model's own reply", () => {
    const reply = parseMedicalReply("That sounds like anaphylaxis.", "m");
    expect(reply.urgent).toBe(true);
    expect(reply.redFlags).toContain("possible anaphylaxis");
  });

  it("does not mark an ordinary reply urgent", () => {
    const reply = parseMedicalReply("Aim for 1.6 g/kg of protein.", "m");
    expect(reply.urgent).toBe(false);
    expect(reply.text).not.toContain("emergency");
  });
});

describe("rules", () => {
  it("clamps unknown domain and direction to safe defaults", () => {
    const r = normalizeRule({ subject: "Espresso after 16:00", domain: "sleep", direction: "ban" });
    // "less" rather than "avoid": a bad guess should under-restrict, not over-.
    expect(r).toMatchObject({ domain: "lifestyle", direction: "less" });
  });

  it("derives a key that keeps opposite directions on the same subject apart", () => {
    const less = normalizeRule({ subject: "Coffee", direction: "less" })!;
    const more = normalizeRule({ subject: "Coffee", direction: "more" })!;
    expect(less.key).not.toBe(more.key);
  });

  it("rejects a rule with no subject", () => {
    expect(normalizeRule({ detail: "sometime", direction: "avoid" })).toBeNull();
  });

  it("drops repeats of the same key and caps how many one reply can add", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ subject: `Thing ${i}`, direction: "less" }));
    expect(normalizeRules(many).length).toBeLessThanOrEqual(6);
    const dupes = [{ subject: "Tomato sauce at night" }, { subject: "Tomato sauce at night" }];
    expect(normalizeRules(dupes)).toHaveLength(1);
  });

  it("accepts either a bare array or an object wrapping one", () => {
    expect(normalizeRules([{ subject: "Walk 20 min" }])).toHaveLength(1);
    expect(normalizeRules({ rules: [{ subject: "Walk 20 min" }] })).toHaveLength(1);
  });
});

describe("extractJsonArrayAfter", () => {
  it("stops at the array's end so a following marker survives", () => {
    const raw = 'Here you go.\n[RULES]\n[{"subject":"Orange juice at night","direction":"avoid"}]\n[ISSUE]\n{"title":"Reflux"}';
    const { json, rest } = extractJsonArrayAfter(raw, "[RULES]");
    expect(json).toHaveLength(1);
    expect(rest).toContain("[ISSUE]");
    expect(rest).not.toContain("[RULES]");
    expect(rest).not.toContain("Orange juice");
  });

  it("is not fooled by brackets inside strings", () => {
    const raw = '[RULES]\n[{"subject":"Chips [the salty kind]","direction":"less"}]';
    const { json } = extractJsonArrayAfter(raw, "[RULES]");
    expect(json[0].subject).toBe("Chips [the salty kind]");
  });

  it("drops an unbalanced payload rather than leaking it into the reply", () => {
    const { json, rest } = extractJsonArrayAfter('Noted.\n[RULES]\n[{"subject":"x"', "[RULES]");
    expect(json).toBeNull();
    expect(rest).toBe("Noted.");
  });

  it("leaves text alone when the marker is absent", () => {
    const { json, rest } = extractJsonArrayAfter("Just an answer.", "[RULES]");
    expect(json).toBeNull();
    expect(rest).toBe("Just an answer.");
  });
});

describe("parseMedicalReply with rules", () => {
  it("attaches rules to a plain message and keeps them out of the text", () => {
    const raw = 'Cut those out after 8pm.\n[RULES]\n[{"subject":"Tomato sauce within 3h of bed","domain":"nutrition","direction":"avoid","reason":"Reflux at night"}]';
    const reply = parseMedicalReply(raw, "m");
    expect(reply.type).toBe("message");
    expect(reply.text).toBe("Cut those out after 8pm.");
    expect(reply.rules).toHaveLength(1);
    expect(reply.rules![0]).toMatchObject({ direction: "avoid", domain: "nutrition" });
  });

  it("carries rules alongside a tracked issue in the same reply", () => {
    const raw = `I'll track the reflux and note what to change.
[RULES]
[{"subject":"Orange juice after 20:00","domain":"nutrition","direction":"avoid"}]
[ISSUE]
{"key":"night-reflux","title":"Night-time reflux","category":"medical","severity":"moderate","summary":"Burning after late acidic meals.","actionPlan":[{"step":"Last meal 3h before bed"}]}`;
    const reply = parseMedicalReply(raw, "m");
    expect(reply.type).toBe("issue");
    expect(reply.issue?.key).toBe("night-reflux");
    expect(reply.rules).toHaveLength(1);
    expect(reply.text).not.toContain("[");
  });

  it("still prepends the emergency notice when rules are present", () => {
    const raw = 'Careful.\n[RULES]\n[{"subject":"Heavy lifting","direction":"avoid"}]';
    const reply = parseMedicalReply(raw, "m", ["chest pain or pressure"]);
    expect(reply.urgent).toBe(true);
    expect(reply.text.startsWith(EMERGENCY_NOTICE)).toBe(true);
    expect(reply.rules).toHaveLength(1);
  });
});

describe("reconcileIssues", () => {
  const review = (over: Partial<AIHealthReview> = {}): AIHealthReview => ({
    summary: "s",
    issues: [],
    resolvedKeys: [],
    ...over,
  });

  it("creates issues the tracker has never seen", () => {
    const result = reconcileIssues([], review({ issues: [normalizeIssue({ title: "Poor sleep" })!] }));
    expect(result.create).toHaveLength(1);
    expect(result.update).toHaveLength(0);
  });

  it("updates an existing issue instead of duplicating it", () => {
    const proposed = normalizeIssue({
      key: "left-shoulder-pain",
      title: "Left shoulder impingement",
      severity: "high",
      summary: "Now reproducible overhead.",
    })!;
    const result = reconcileIssues([issue()], review({ issues: [proposed] }));
    expect(result.create).toHaveLength(0);
    expect(result.update[0]).toMatchObject({ id: "id-1", key: "left-shoulder-pain" });
    expect(result.update[0].patch.severity).toBe("high");
  });

  it("never touches user-owned status and progress", () => {
    const proposed = normalizeIssue({ key: "left-shoulder-pain", title: "Left shoulder pain" })!;
    const { patch } = reconcileIssues([issue()], review({ issues: [proposed] })).update[0];
    expect(patch).not.toHaveProperty("status");
    expect(patch).not.toHaveProperty("progress");
  });

  it("keeps steps the user already ticked", () => {
    const proposed = normalizeIssue({
      key: "left-shoulder-pain",
      title: "Left shoulder pain",
      actionPlan: [{ step: "Daily band external rotations" }, { step: "Add face pulls" }],
    })!;
    const { patch } = reconcileIssues([issue()], review({ issues: [proposed] })).update[0];
    expect(patch.actionPlan).toEqual([
      { step: "Daily band external rotations", done: true },
      { step: "Add face pulls" },
    ]);
  });

  it("keeps recorded readings when a metric is rewritten", () => {
    const proposed = normalizeIssue({
      key: "left-shoulder-pain",
      title: "Left shoulder pain",
      metrics: [{ label: "Pain (0-10)", target: "< 2" }],
    })!;
    const { patch } = reconcileIssues([issue()], review({ issues: [proposed] })).update[0];
    expect(patch.metrics?.[0]).toMatchObject({ label: "Pain (0-10)", target: "< 2", latest: 4 });
  });

  it("does not reopen an issue the user resolved or dismissed", () => {
    const proposed = normalizeIssue({ key: "left-shoulder-pain", title: "Left shoulder pain" })!;
    for (const status of ["resolved", "dismissed"] as const) {
      const result = reconcileIssues([issue({ status })], review({ issues: [proposed] }));
      expect(result.create).toHaveLength(0);
      expect(result.update).toHaveLength(0);
    }
  });

  it("only suggests resolving issues that are tracked and still open", () => {
    const existing = [issue(), issue({ id: "id-2", key: "old-thing", status: "resolved" })];
    const result = reconcileIssues(
      existing,
      review({ resolvedKeys: ["left-shoulder-pain", "old-thing", "never-heard-of-it"] })
    );
    expect(result.resolvedSuggestions).toEqual(["left-shoulder-pain"]);
  });
});

describe("localReview (no-model fallback)", () => {
  const ctx = (over: Partial<Parameters<typeof localReview>[0]> = {}) => ({
    profile: profile({ bodyweightKg: 80, heightCm: 180, age: 30 }),
    health: healthProfile({ conditions: ["asthma"] }),
    issues: [],
    records: [],
    ...over,
  });

  it("surfaces recorded injuries that nothing is tracking", () => {
    const result = localReview(
      ctx({
        records: [
          {
            id: "r1", kind: "injury", title: "Rolled left ankle",
            occurredAt: Date.now(), data: {}, source: "user", createdAt: Date.now(),
          },
        ],
      })
    );
    expect(result.issues.map((i) => i.key)).toContain("rolled-left-ankle");
  });

  it("does not duplicate something already tracked", () => {
    const result = localReview(
      ctx({
        issues: [issue({ key: "rolled-left-ankle", title: "Rolled left ankle" })],
        records: [
          {
            id: "r1", kind: "injury", title: "Rolled left ankle",
            occurredAt: Date.now(), data: {}, source: "user", createdAt: Date.now(),
          },
        ],
      })
    );
    expect(result.issues).toHaveLength(0);
  });

  it("asks for the missing profile fields any real reasoning depends on", () => {
    const result = localReview(ctx({ profile: profile(), health: healthProfile() }));
    expect(result.issues.map((i) => i.key)).toContain("complete-health-profile");
  });

  it("accepts a background with no conditions once any question is answered", () => {
    // A healthy athlete has nothing to list under conditions — that must not
    // leave "complete your profile" open forever.
    const result = localReview(ctx({ health: healthProfile({ smoking: "never" }) }));
    expect(result.issues.map((i) => i.key)).not.toContain("complete-health-profile");
  });

  it("names exactly what is missing", () => {
    expect(profileGaps(ctx({ health: healthProfile() }))).toEqual(["medical background"]);
    expect(profileGaps(ctx({ profile: profile({ bodyweightKg: 80, heightCm: 180 }) }))).toEqual([
      "body stats",
    ]);
    expect(profileGaps(ctx())).toEqual([]);
  });

  it("never proposes resolving anything on its own", () => {
    expect(localReview(ctx()).resolvedKeys).toEqual([]);
  });
});

describe("prompt plumbing", () => {
  it("gives the model the issue keys it needs to update instead of duplicate", () => {
    const { text } = buildChatBrief(
      {
        profile: profile({ age: 30 }),
        health: healthProfile({ conditions: ["asthma"], medications: [{ name: "Ventolin", dose: "100µg" }] }),
        issues: [issue()],
        records: [],
      },
      [{ role: "user", content: "My shoulder still aches when I press overhead" }]
    );
    expect(text).toContain("[left-shoulder-pain]");
    expect(text).toContain("asthma");
    expect(text).toContain("Ventolin 100µg");
  });
});

describe("provider selection", () => {
  // `config` is read at call time, so the env-driven fields can be swapped per
  // test. Snapshot and restore them rather than leaking into the next test.
  const original = { geminiKey: config.geminiApiKey };
  afterEach(() => {
    config.geminiApiKey = original.geminiKey;
  });

  it("answers on Gemini when there is a key", () => {
    config.geminiApiKey = "key";
    expect(activeProvider()).toBe("gemini");
  });

  it("reports none rather than pretending when there is no key", () => {
    config.geminiApiKey = "  ";
    expect(activeProvider()).toBe("none");
  });

  it("labels the model, so the user can see who answered", () => {
    expect(modelLabel("gemini")).toContain("Gemini");
    expect(modelLabel("none")).toBe("unavailable");
  });
});

describe("medicalFetch error classification", () => {
  // This used to report every failure as MEDICAL_TIMEOUT, so a broken URL failed
  // instantly while claiming to be slow — and raising the timeout, the obvious
  // fix, could never help.
  it("does not call a broken URL a timeout", async () => {
    const err = await medicalFetch("generativelanguage.googleapis.com/v1beta/models", {}).catch((e) => e);
    expect(err.message).toMatch(/^MEDICAL_NETWORK /);
    expect(err.message).not.toMatch(/TIMEOUT/);
  });

  it("says how long it took, since a real timeout takes the whole deadline", async () => {
    const err = await medicalFetch("not a url at all", {}).catch((e) => e);
    expect(err.message).toMatch(/after \d+ms/);
  });

  it("names scheme and host so a mistyped URL is visible in the log", () => {
    expect(hostOf("https://generativelanguage.googleapis.com/v1beta/models/x:generateContent"))
      .toBe("https://generativelanguage.googleapis.com");
    expect(hostOf("generativelanguage.googleapis.com/v1beta")).toMatch(/^unparseable URL/);
  });

  it("shows a misspelled scheme instead of hiding it behind a correct host", () => {
    // `ttps://` parses fine and keeps the right host; only the scheme is wrong.
    expect(hostOf("ttps://generativelanguage.googleapis.com/v1beta")).toBe(
      "ttps://generativelanguage.googleapis.com"
    );
  });
});

describe("issueKey", () => {
  it("prefers the model's key but falls back to the title", () => {
    expect(issueKey("Low Ferritin", "whatever")).toBe("low-ferritin");
    expect(issueKey("", "Low ferritin")).toBe("low-ferritin");
    expect(issueKey("", "")).toBe("issue");
  });
});
