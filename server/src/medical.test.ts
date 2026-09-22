// Unit tests for the medical helper's safety-critical, non-networked logic:
// the emergency screen, the marker parsing that turns model text into database
// writes, and the reconciliation that keeps a re-review from trampling the
// user's own progress. All of it fails quietly in production if it regresses —
// a missed red flag or a reset checklist doesn't throw, it just does the wrong
// thing — so it's pinned down here.

import { afterEach, describe, expect, it } from "vitest";
import { config } from "./config";
import { __medical, activeProvider, EMERGENCY_NOTICE, modelLabel } from "./medical";
import type { AIHealthReview, HealthIssue, HealthProfile, UserProfile } from "./types";

const {
  detectRedFlags,
  normalizeIssue,
  normalizeRecord,
  boundedData,
  parseMedicalReply,
  localReview,
  reconcileIssues,
  issueKey,
  buildHealthContext,
  usesPredictShape,
  flattenTranscript,
  toOpenAiMessages,
} = __medical;

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
    const reply = parseMedicalReply(raw, "medlm-medium (Vertex AI)");
    expect(reply.type).toBe("issue");
    expect(reply.text).toBe("I'll track that for you.");
    expect(reply.issue?.key).toBe("low-protein");
    expect(reply.model).toBe("medlm-medium (Vertex AI)");
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

  it("never proposes resolving anything on its own", () => {
    expect(localReview(ctx()).resolvedKeys).toEqual([]);
  });
});

describe("prompt plumbing", () => {
  it("routes MedLM ids to the PaLM-era predict shape and Gemini ids to generateContent", () => {
    expect(usesPredictShape("medlm-medium")).toBe(true);
    expect(usesPredictShape("medlm-large")).toBe(true);
    expect(usesPredictShape("gemini-2.5-pro")).toBe(false);
  });

  it("flattens a transcript with the newest turn last", () => {
    const flat = flattenTranscript("SYSTEM", [
      { role: "user", content: "first" },
      { role: "model", content: "answer" },
      { role: "user", content: "newest" },
    ]);
    expect(flat).toContain("SYSTEM");
    expect(flat).toContain("Patient: first");
    expect(flat).toContain("Clinician: answer");
    expect(flat.indexOf("Patient: newest")).toBeGreaterThan(flat.indexOf("Clinician: answer"));
    expect(flat.trimEnd().endsWith("Clinician:")).toBe(true);
  });

  it("gives the model the issue keys it needs to update instead of duplicate", () => {
    const text = buildHealthContext({
      profile: profile({ age: 30 }),
      health: healthProfile({ conditions: ["asthma"], medications: [{ name: "Ventolin", dose: "100µg" }] }),
      issues: [issue()],
      records: [],
    });
    expect(text).toContain("[left-shoulder-pain]");
    expect(text).toContain("asthma");
    expect(text).toContain("Ventolin 100µg");
  });
});

describe("provider selection", () => {
  // `config` is read at call time, so the env-driven fields can be swapped per
  // test. Snapshot and restore them rather than leaking into the next test.
  const original = {
    provider: config.medicalProvider,
    baseUrl: config.medicalBaseUrl,
    geminiKey: config.geminiApiKey,
  };
  afterEach(() => {
    config.medicalProvider = original.provider;
    config.medicalBaseUrl = original.baseUrl;
    config.geminiApiKey = original.geminiKey;
  });

  it("prefers a self-hosted endpoint over the shared Gemini one on auto", () => {
    config.medicalProvider = "auto";
    config.medicalBaseUrl = "https://medgemma-abc.run.app/v1";
    config.geminiApiKey = "key";
    expect(activeProvider()).toBe("cloudrun");
  });

  it("falls to Gemini on auto when nothing is self-hosted", () => {
    config.medicalProvider = "auto";
    config.medicalBaseUrl = "";
    config.geminiApiKey = "key";
    expect(activeProvider()).toBe("gemini");
  });

  it("reports none rather than silently downgrading when cloudrun is forced but unset", () => {
    config.medicalProvider = "cloudrun";
    config.medicalBaseUrl = "";
    config.geminiApiKey = "key";
    expect(activeProvider()).toBe("none");
  });

  it("labels a self-hosted answer as such, so a fallback is visible", () => {
    config.medicalBaseUrl = "https://medgemma-abc.run.app/v1";
    expect(modelLabel("cloudrun")).toContain("self-hosted");
    expect(modelLabel("gemini")).toContain("Gemini");
    expect(modelLabel("none")).toBe("unavailable");
  });
});

describe("toOpenAiMessages", () => {
  it("puts the system prompt first and maps model turns to assistant", () => {
    const out = toOpenAiMessages("SYSTEM", [
      { role: "user", content: "hi" },
      { role: "model", content: "hello" },
    ]);
    expect(out).toEqual([
      { role: "system", content: "SYSTEM" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });

  it("sends attachments as data-URI image parts", () => {
    const out = toOpenAiMessages("S", [
      { role: "user", content: "read this", images: [{ mimeType: "image/jpeg", data: "AAAA" }] },
    ]);
    expect(out[1].content).toEqual([
      { type: "text", text: "read this" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } },
    ]);
  });

  it("omits the empty text part when a photo is sent with no caption", () => {
    const out = toOpenAiMessages("S", [
      { role: "user", content: "   ", images: [{ mimeType: "image/png", data: "BBBB" }] },
    ]);
    expect(out[1].content).toEqual([
      { type: "image_url", image_url: { url: "data:image/png;base64,BBBB" } },
    ]);
  });
});

describe("issueKey", () => {
  it("prefers the model's key but falls back to the title", () => {
    expect(issueKey("Low Ferritin", "whatever")).toBe("low-ferritin");
    expect(issueKey("", "Low ferritin")).toBe("low-ferritin");
    expect(issueKey("", "")).toBe("issue");
  });
});
