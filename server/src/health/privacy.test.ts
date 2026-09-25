// The privacy layer is the only thing standing between the full health record
// and the cloud model, and every way it can fail is silent: an over-inclusive
// brief still gets a good answer, so nobody notices the cholesterol panel rode
// along on a knee question. These tests pin down what is sent, what is not, and
// what is scrubbed on the way out.

import { describe, expect, it } from "vitest";
import type { HealthMemory } from "./memory";
import { ago, buildChatBrief, buildReviewBrief, extractFocus, minimizeTranscript, Redactor } from "./privacy";
import type { HealthIssue, HealthProfile, HealthRecord, HealthRule, UserProfile } from "../types";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 24);

const profile = (over: Partial<UserProfile> = {}): UserProfile =>
  ({
    name: "Amina Benali",
    goal: "strength",
    equipment: "full_gym",
    experience: "intermediate",
    category: "mixed",
    daysPerWeek: 4,
    sessionMinutes: 60,
    units: "kg",
    age: 34,
    sex: "female",
    bodyweightKg: 64,
    heightCm: 168,
    ...over,
  }) as UserProfile;

const health = (over: Partial<HealthProfile> = {}): HealthProfile => ({
  conditions: ["hypothyroidism"],
  allergies: ["penicillin"],
  medications: [{ name: "Levothyroxine", dose: "50µg", schedule: "mornings" }],
  surgeries: ["ACL reconstruction 2019"],
  familyHistory: ["father: heart attack at 52"],
  bloodType: "O+",
  sleepHours: 6,
  notes: "Works night shifts twice a week. Call me on 06 12 34 56 78 if needed. Left knee clicks on stairs.",
  ...over,
});

let seq = 0;
const issue = (over: Partial<HealthIssue> = {}): HealthIssue => ({
  id: `i${++seq}`,
  key: "left-knee-pain",
  title: "Left knee pain",
  category: "pain",
  status: "in_progress",
  severity: "moderate",
  progress: 40,
  bodyRegion: "left knee",
  actionPlan: [{ step: "Spanish squats", done: true }, { step: "Cut running volume" }],
  metrics: [{ label: "Pain (0-10)", target: "< 2" }],
  redFlags: [],
  source: "ai",
  createdAt: NOW - 40 * DAY,
  updatedAt: NOW - 2 * DAY,
  events: [
    { id: "e1", issueId: "x", kind: "measurement", metric: "Pain (0-10)", value: 7, createdAt: NOW - 21 * DAY },
    { id: "e2", issueId: "x", kind: "measurement", metric: "Pain (0-10)", value: 5, createdAt: NOW - 10 * DAY },
    { id: "e3", issueId: "x", kind: "measurement", metric: "Pain (0-10)", value: 4, createdAt: NOW - 2 * DAY },
  ],
  ...over,
});

const record = (over: Partial<HealthRecord> = {}): HealthRecord => ({
  id: `r${++seq}`,
  kind: "lab",
  title: "Lipid panel",
  detail: "LDL 4.1 mmol/L, HDL 1.2",
  occurredAt: NOW - 90 * DAY,
  data: {},
  source: "user",
  createdAt: NOW - 90 * DAY,
  ...over,
});

const rule = (over: Partial<HealthRule> = {}): HealthRule => ({
  id: `u${++seq}`,
  key: "less-running",
  domain: "physical",
  direction: "less",
  subject: "Running on the knee",
  status: "active",
  source: "ai",
  userEdited: false,
  createdAt: NOW - 5 * DAY,
  updatedAt: NOW - 5 * DAY,
  ...over,
});

const memory = (over: Partial<HealthMemory> = {}): HealthMemory => ({
  profile: profile(),
  health: health(),
  issues: [
    issue(),
    issue({
      key: "high-ldl", title: "High LDL cholesterol", category: "metabolic", bodyRegion: undefined,
      metrics: [], events: [],
    }),
    issue({
      key: "reflux", title: "Night-time reflux", category: "nutrition", bodyRegion: undefined,
      metrics: [], events: [],
    }),
  ],
  records: [
    record(),
    record({ kind: "injury", title: "Twisted knee on trail run", detail: "Swelling for 3 days", occurredAt: NOW - 30 * DAY }),
    record({ kind: "note", title: "Dermatology visit", detail: "Mole checked, benign", occurredAt: NOW - 400 * DAY }),
  ],
  rules: [
    rule(),
    rule({ key: "avoid-tomato-late", domain: "nutrition", direction: "avoid", subject: "Tomato sauce after 8pm" }),
  ],
  trainingContext: "- Sessions completed (last 4 weeks): 14",
  ...over,
});

const ask = (content: string) => [{ role: "user" as const, content }];

describe("buildChatBrief — selection", () => {
  const knee = buildChatBrief(memory(), ask("My knee hurts going down stairs after squats"), NOW);

  it("sends what the question is about", () => {
    expect(knee.text).toContain("[left-knee-pain]");
    expect(knee.text).toContain("Twisted knee on trail run");
    expect(knee.text).toContain("Running on the knee");
  });

  it("does not send the rest of the record", () => {
    expect(knee.text).not.toContain("high-ldl");
    expect(knee.text).not.toContain("Lipid panel");
    expect(knee.text).not.toContain("Dermatology");
    expect(knee.text).not.toContain("Tomato sauce");
    expect(knee.text).not.toContain("heart attack");
  });

  it("always sends conditions, medications and allergies, whatever the question", () => {
    for (const brief of [knee, buildChatBrief(memory(), ask("Is decaf ok?"), NOW)]) {
      expect(brief.text).toContain("hypothyroidism");
      expect(brief.text).toContain("Levothyroxine 50µg mornings");
      expect(brief.text).toContain("penicillin");
    }
  });

  it("brings family history only to questions it bears on", () => {
    const heart = buildChatBrief(memory(), ask("Should I worry about my cholesterol?"), NOW);
    expect(heart.text).toContain("father: heart attack at 52");
    expect(heart.text).toContain("Lipid panel");
    expect(heart.text).not.toContain("[left-knee-pain]");
  });

  it("never sends blood type in a chat brief", () => {
    expect(knee.text).not.toContain("O+");
    expect(knee.disclosure.withheld).toContain("blood type");
  });

  it("sends only the note sentences that match, scrubbed", () => {
    expect(knee.text).toContain("Left knee clicks on stairs");
    expect(knee.text).not.toContain("night shifts");
  });

  it("falls back to the top of the worklist for a question with no subject", () => {
    const general = buildChatBrief(memory(), ask("Hi there"), NOW);
    expect(general.disclosure.topics).toEqual(["general"]);
    expect(general.text).toContain("[left-knee-pain]");
    expect(general.text).not.toContain("Lipid panel");
  });

  it("reads the last few user turns, so a follow-up keeps its subject", () => {
    const brief = buildChatBrief(
      memory(),
      [
        { role: "user", content: "I get reflux most nights" },
        { role: "model", content: "What do you usually eat late?" },
        { role: "user", content: "What about after 8pm?" },
      ],
      NOW
    );
    expect(brief.text).toContain("[reflux]");
  });
});

describe("buildChatBrief — computed locally", () => {
  it("sends the trend as a conclusion, not the readings", () => {
    const { text, disclosure } = buildChatBrief(memory(), ask("How is my knee doing?"), NOW);
    expect(text).toMatch(/Pain \(0-10\): 7 → 4 over 3 weeks \(3 readings\), improving; target < 2 — not yet met/);
    expect(text).toContain("BMI 22.7");
    expect(disclosure.computedLocally).toEqual(expect.arrayContaining(["BMI", "1 metric trend"]));
  });

  it("reports what was sent against what is held", () => {
    const { disclosure } = buildChatBrief(memory(), ask("My knee hurts after squats"), NOW);
    expect(disclosure.scope).toBe("question");
    expect(disclosure.sent.issues).toBe(1);
    expect(disclosure.held).toEqual({ issues: 3, records: 3, rules: 2 });
    expect(disclosure.topics).toEqual(expect.arrayContaining(["musculoskeletal", "training"]));
  });
});

describe("scrubbing", () => {
  it("removes the person's name, emails, phones, links and ID numbers", () => {
    const r = new Redactor("Amina Benali");
    const out = r.scrub(
      "Amina here, BENALI on the form. Mail amina@example.com, call +212 612 345 678 or 06 12 34 56 78, " +
        "see https://portal.example/lab/991 — patient no. MRN12345678."
    );
    expect(out).not.toMatch(/Amina|BENALI|example\.com|612 345|06 12|portal|12345678/);
    expect(r.count).toBeGreaterThanOrEqual(6);
  });

  it("leaves clinical numbers and dates alone", () => {
    const r = new Redactor("Amina Benali");
    const text = "BP 120/80, readings 120 125 118 122, LDL 4.1 mmol/L on 2024-05-12, ferritin 18";
    expect(r.scrub(text)).toBe(text);
    expect(r.count).toBe(0);
  });

  it("matches the name only in its capitalised form, so ordinary words survive", () => {
    const r = new Redactor("Will Grace");
    expect(r.scrub("I will say grace. Will asked.")).toBe("I will say grace. [name] asked.");
  });

  it("handles accented names", () => {
    expect(new Redactor("Élodie").scrub("Élodie's knee")).toBe("[name]'s knee");
  });

  it("scrubs the transcript as well as the brief", () => {
    const brief = buildChatBrief(memory(), ask("It's Amina — reach me at amina@example.com"), NOW);
    expect(brief.messages[0].content).toBe("It's [name] — reach me at [email]");
    expect(brief.disclosure.redactions).toBeGreaterThanOrEqual(2);
  });

  it("makes dates relative", () => {
    expect(ago(NOW - 3 * DAY, NOW)).toBe("3 days ago");
    expect(ago(NOW - 35 * DAY, NOW)).toBe("5 weeks ago");
    expect(ago(NOW - 800 * DAY, NOW)).toBe("2 years ago");
  });
});

describe("minimizeTranscript", () => {
  const img = [{ mimeType: "image/jpeg", data: "AAAA" }];

  it("keeps photos on the newest message only", () => {
    const out = minimizeTranscript(
      [
        { role: "user", content: "", images: img },
        { role: "model", content: "That panel shows low ferritin." },
        { role: "user", content: "And this one?", images: img },
      ],
      new Redactor()
    );
    expect(out[0].images).toBeUndefined();
    expect(out[0].content).toMatch(/not re-sent/);
    expect(out[2].images).toEqual(img);
  });

  it("sends the thread, not the archive", () => {
    const long = Array.from({ length: 30 }, (_, i) => ({
      role: (i % 2 ? "model" : "user") as "user" | "model",
      content: `turn ${i}`,
    }));
    const out = minimizeTranscript(long, new Redactor());
    expect(out).toHaveLength(12);
    expect(out[out.length - 1].content).toBe("turn 29");
  });
});

describe("buildReviewBrief", () => {
  const m = memory({
    issues: [
      ...memory().issues,
      issue({ key: "old-wrist", title: "Wrist sprain", status: "resolved", bodyRegion: "wrist" }),
    ],
  });
  const { text, disclosure } = buildReviewBrief(m, NOW);

  it("carries every open issue with its trend", () => {
    expect(text).toContain("[left-knee-pain]");
    expect(text).toContain("[high-ldl]");
    expect(text).toContain("improving");
  });

  it("lists closed issues as a key and title so they are not raised again", () => {
    expect(text).toContain("[old-wrist] Wrist sprain (resolved)");
  });

  it("sends the last six months in full and older history only as counts", () => {
    expect(text).toContain("Lipid panel");
    expect(text).not.toContain("Dermatology");
    expect(text).toContain("1 note");
    expect(disclosure.sent.records).toBe(2);
  });

  it("leaves the rules, blood type and exact identifiers at home", () => {
    expect(text).not.toContain("Tomato sauce");
    expect(text).not.toContain("O+");
    expect(text).not.toContain("06 12 34 56 78");
    expect(text).not.toContain("Amina");
    expect(disclosure.withheld).toEqual(expect.arrayContaining(["blood type", "do & don't rules"]));
  });

  it("maps open issues onto body regions", () => {
    expect(text).toContain("Open issues by body region: knee (1)");
  });
});

describe("extractFocus", () => {
  it("reads topics and regions without a model", () => {
    const focus = extractFocus("Can I take creatine with my levothyroxine? My shoulder is sore");
    expect(focus.topics).toEqual(expect.arrayContaining(["supplements", "medication", "musculoskeletal"]));
    expect(focus.regions).toEqual(["shoulder"]);
  });
});
