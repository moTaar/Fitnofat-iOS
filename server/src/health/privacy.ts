// Layer 6 — Privacy: what leaves the server, and in what form.
//
// The cloud model never sees the health record. It sees a BRIEF — a short,
// relevance-filtered summary assembled here from the record held in local
// memory — and a trimmed copy of the conversation. The pipeline for every call:
//
//   1. Extraction.   The question is read locally for topics (sleep, labs,
//                    digestion…), body regions and keywords.
//   2. Selection.    Only the issues, history entries, rules and background
//                    fields that match are chosen. A knee question does not
//                    carry the cholesterol panel, the family history or last
//                    year's dermatology note.
//   3. Computation.  Trends and body calculations are done by the anatomy layer
//                    and sent as conclusions ("pain 7 → 4 over 3 weeks,
//                    improving"), not as reading-by-reading logs.
//   4. Scrubbing.    Identifiers the model never needs are removed from every
//                    free-text field and from the transcript: the person's
//                    name, emails, phone and ID numbers, URLs. Dates become
//                    relative ("5 weeks ago").
//   5. Disclosure.   A `CloudDisclosure` records what was sent and what was held
//                    back; it rides on the reply so the UI can show it.
//
// One deliberate exception to "only what is relevant": conditions, current
// medications and allergies are ALWAYS sent, in full. Whether a condition bears
// on a question (diabetes on a foot blister, an anticoagulant on a bruise) is
// itself a clinical judgement, and a keyword matcher that got it wrong would
// have the model recommend a supplement that interacts with a prescription.
// They are a few short lines; the rest of the record is where the bulk and the
// sensitivity are.
//
// The consent gate (routes/health.ts `requireHealthConsent`) sits in front of
// all of this: without consent, not even the brief is built.

import { bodyCalcs, daysSinceCheckIn, issueRegions, metricTrend, regionLoad, regionsIn, trendLine } from "./anatomy";
import { CLOSED_STATUSES, type HealthMemory } from "./memory";
import type { ChatMessage } from "../gemini";
import type {
  HealthIssue, HealthIssueCategory, HealthRecord, HealthRecordKind, HealthRule, RuleDomain,
} from "../types";

const DAY = 86_400_000;

// Caps on what one brief may carry, whatever matches.
const CHAT_MAX_ISSUES = 5;
const CHAT_MAX_RECORDS = 8;
const CHAT_MAX_RULES = 8;
const REVIEW_MAX_RECORDS = 15;
const REVIEW_RECORD_WINDOW_DAYS = 180;
const DETAIL_CHARS = 160;
// How much of the conversation is re-sent each turn. Older turns have already
// been answered; the model needs the thread, not the archive.
const TRANSCRIPT_TURNS = 12;

// ── Scrubbing ────────────────────────────────────────────────────────────────

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL_RE = /\bhttps?:\/\/[^\s)]+/gi;
// Runs of digits with phone/ID punctuation. Candidates only — `isPhoneOrId`
// decides, so lab values ("LDL 3.2", "120/80"), a list of readings ("120 125
// 118") and dates survive.
const NUMBER_RUN = /(?<![\w.])\+?\d[\d\s().-]{6,}\d(?![\w])/g;
const ID_CODE = /\b[A-Z]{1,3}\d{6,}\b/g;
const DATE_LIKE = /\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.]\d{1,2}[/.]\d{2,4}/;
const GROUPED_PHONE = [
  /^0\d([ .-]?\d{2}){4}$/, // 06 12 34 56 78
  /^\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}$/, // (555) 123-4567
];

function isPhoneOrId(match: string): boolean {
  const trimmed = match.trim();
  const digits = trimmed.replace(/\D/g, "").length;
  if (digits < 9 || DATE_LIKE.test(trimmed)) return false;
  // International format, or one unbroken token (an ID, a phone typed solid).
  if (trimmed.startsWith("+") || !/\s/.test(trimmed)) return true;
  // Spaced digits are only a phone when grouped like one; otherwise they are
  // far more likely a list of readings.
  return GROUPED_PHONE.some((re) => re.test(trimmed));
}

/**
 * Removes identifiers from free text and counts what it removed. One per brief,
 * so the count covers everything that was sent.
 */
export class Redactor {
  count = 0;
  private names: RegExp[];

  constructor(name?: string) {
    // Each part of the person's name, matched in its capitalised form only, so
    // a name that is also a word ("Will", "Grace") does not eat ordinary prose.
    // Letter lookarounds rather than \b, which is ASCII-only and would never
    // match around an accented name.
    this.names = (name ?? "")
      .split(/\s+/)
      .map((part) => part.replace(/[^\p{L}'-]/gu, ""))
      .filter((part) => part.length >= 3)
      .map((part) => {
        const cap = part[0].toUpperCase() + part.slice(1).toLowerCase();
        return new RegExp(`(?<!\\p{L})(${escapeRe(cap)}|${escapeRe(part.toUpperCase())})(?!\\p{L})`, "gu");
      });
  }

  scrub(text: string | undefined): string {
    if (!text) return "";
    const swap = (label: string) => () => {
      this.count++;
      return label;
    };
    let out = text.replace(EMAIL, swap("[email]")).replace(URL_RE, swap("[link]"));
    out = out.replace(NUMBER_RUN, (match) => {
      if (!isPhoneOrId(match)) return match;
      this.count++;
      return "[number]";
    });
    out = out.replace(ID_CODE, swap("[id]"));
    for (const re of this.names) out = out.replace(re, swap("[name]"));
    return out;
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Coarse relative time — enough for clinical reasoning, less than a date. */
export function ago(ts: number, now = Date.now()): string {
  const days = Math.floor((now - ts) / DAY);
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 730) return `${Math.round(days / 30)} months ago`;
  return `${Math.round(days / 365)} years ago`;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

// ── Extraction: what is this question about? ─────────────────────────────────

export type Topic =
  | "nutrition" | "supplements" | "medication" | "sleep" | "stress" | "musculoskeletal"
  | "training" | "cardiovascular" | "metabolic" | "digestive" | "respiratory" | "skin"
  | "labs" | "substances";

const TOPICS: Record<Topic, RegExp> = {
  nutrition: /\b(diet\w*|eat\w*|foods?|meals?|protein|carbs?|carbohydrates?|fats?|calori\w*|kcal|macros?|fib(er|re)|sugar|snacks?|breakfast|lunch|dinner|fasting|vegan|vegetarian|keto|hydrat\w*|juice|coffee|caffeine|recipes?|cook\w*|cutting|bulking)\b/i,
  supplements: /\b(supplement\w*|creatine|whey|vitamins?|iron|magnesium|omega|fish oil|zinc|b12|d3|melatonin|multivitamin|electrolytes?|pre-?workout|ashwagandha|collagen)\b/i,
  medication: /\b(medications?|medicines?|meds|pills?|drugs?|dos(e|es|age|ing)|prescri\w*|tablets?|ibuprofen|paracetamol|acetaminophen|aspirin|nsaids?|antibiotics?|inhaler|insulin|statins?|levothyroxine|side effects?|interact\w*)\b/i,
  sleep: /\b(sleep\w*|insomnia|tired\w*|fatigue\w*|naps?|exhaust\w*|waking|bedtime|night shifts?|snor\w*)\b/i,
  stress: /\b(stress\w*|anxi\w*|mood|depress\w*|burn(ed|t)? ?out|overwhelm\w*|panic|mental|motivation|worr\w*)\b/i,
  musculoskeletal: /\b(pain\w*|hurts?|hurting|aches?|aching|sore\w*|injur\w*|strain\w*|sprain\w*|tendon\w*|tendin\w*|joints?|stiff\w*|swell\w*|mobility|range of motion|posture|rehab\w*|physio\w*|twinge|pulled|tweak\w*)\b/i,
  training: /\b(workouts?|train\w*|gym|lift\w*|squat\w*|deadlift\w*|bench\w*|running|cardio|exercis\w*|sessions?|reps?|deload|recovery|warm-?up|stretch\w*|program\w*|routine)\b/i,
  cardiovascular: /\b(heart|cardiac|cardiovascular|blood pressure|bp|hypertension|pulse|palpitat\w*|cholesterol|ldl|hdl|triglycerid\w*|circulation|dizz\w*)\b/i,
  metabolic: /\b(glucose|blood sugar|diabet\w*|insulin|a1c|hba1c|thyroid|tsh|metaboli\w*|weight|bmi|body ?fat|hormon\w*|testosterone|cortisol)\b/i,
  digestive: /\b(stomach|gut|reflux|heartburn|gerd|bloat\w*|digest\w*|constipat\w*|diarrh\w*|nause\w*|ibs|bowel|indigestion|cramps?)\b/i,
  respiratory: /\b(breath\w*|asthma\w*|lungs?|cough\w*|wheez\w*|inhaler|congest\w*)\b/i,
  skin: /\b(skin|rash\w*|acne|eczema|psoriasis|itch\w*|hives|moles?|sunburn|blisters?)\b/i,
  labs: /\b(labs?|blood ?(tests?|work|panel|results?)|bloodwork|test results?|panel|ferritin|ha?emoglobin|vitamin d|cholesterol|tsh|a1c|creatinine|psa|markers?)\b/i,
  substances: /\b(smok\w*|cigarett\w*|vap(e|ing)|alcohol|drinking|beers?|wine|booze|cannabis|weed|nicotine|hangover)\b/i,
};

const TOPIC_CATEGORIES: Record<Topic, HealthIssueCategory[]> = {
  nutrition: ["nutrition", "metabolic"],
  supplements: ["nutrition"],
  medication: ["medical"],
  sleep: ["sleep"],
  stress: ["stress"],
  musculoskeletal: ["injury", "pain"],
  training: ["injury", "pain"],
  cardiovascular: ["medical", "metabolic"],
  metabolic: ["metabolic", "nutrition"],
  digestive: ["nutrition", "medical"],
  respiratory: ["medical"],
  skin: ["medical"],
  labs: ["metabolic", "medical", "nutrition"],
  substances: ["lifestyle"],
};

const TOPIC_RECORD_KINDS: Partial<Record<Topic, HealthRecordKind[]>> = {
  labs: ["lab"],
  medication: ["medication"],
  supplements: ["medication"],
  cardiovascular: ["vitals", "lab"],
  metabolic: ["lab", "vitals"],
  musculoskeletal: ["injury", "surgery"],
};

const TOPIC_RULE_DOMAINS: Record<Topic, RuleDomain[]> = {
  nutrition: ["nutrition"],
  supplements: ["nutrition", "medical"],
  medication: ["medical"],
  sleep: ["lifestyle"],
  stress: ["lifestyle"],
  musculoskeletal: ["physical"],
  training: ["physical"],
  cardiovascular: ["medical", "lifestyle"],
  metabolic: ["nutrition", "medical"],
  digestive: ["nutrition"],
  respiratory: ["medical"],
  skin: ["medical"],
  labs: ["medical"],
  substances: ["lifestyle"],
};

// Words that carry no signal about WHICH part of the record a question is
// about. Generic symptom words ("pain", "sore") are here too: the topic layer
// already routes them, and as keywords they would match every pain issue.
const STOPWORDS = new Set(
  (
    "the and for but not you are was has had her his its our can any all how why who get got day now one two " +
    "too way use out off lot bit yes see say did let may own new old what that this with have from they been " +
    "were about would should could there their when where which while your after before because still really " +
    "just some much more less very does doing done make feel feeling felt like know want need help since also " +
    "into than then them these those being having take taking only over again lately recently today yesterday " +
    "week weeks month months year years time times thing things think good bad better worse okay fine normal " +
    "left right side both something anything pain pains painful hurt hurts sore issue issues problem problems " +
    "health question advice doctor mine myself will shall might getting going went come came tell told keep"
  ).split(" ")
);

function stem(word: string): string {
  for (const suffix of ["ing", "ed", "es", "s"]) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 4) return word.slice(0, -suffix.length);
  }
  return word;
}

function keywordsOf(text: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const word of (text ?? "").toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) ?? []) {
    if (!STOPWORDS.has(word)) out.add(stem(word));
  }
  return out;
}

export interface QueryFocus {
  topics: Topic[];
  regions: string[];
  keywords: Set<string>;
}

/** What a question is about — topics, body regions and keywords. Local, no model. */
export function extractFocus(text: string): QueryFocus {
  const topics = (Object.keys(TOPICS) as Topic[]).filter((t) => TOPICS[t].test(text));
  const regions = regionsIn(text);
  if (regions.length && !topics.includes("musculoskeletal")) topics.push("musculoskeletal");
  return { topics, regions, keywords: keywordsOf(text) };
}

// ── Selection ────────────────────────────────────────────────────────────────

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n;
}

// Weights: a shared body region is the strongest signal, a shared keyword next;
// a topic that merely matches the category is weak on its own and only counts
// when nothing more specific matched.
function scoreIssue(issue: HealthIssue, focus: QueryFocus): number {
  const regions = issueRegions(issue);
  const words = keywordsOf(`${issue.title} ${issue.summary ?? ""} ${issue.bodyRegion ?? ""}`);
  const categoryHit = focus.topics.some((t) => TOPIC_CATEGORIES[t].includes(issue.category));
  return (
    3 * regions.filter((r) => focus.regions.includes(r)).length +
    2 * overlap(focus.keywords, words) +
    (categoryHit ? 1 : 0)
  );
}

function scoreRecord(record: HealthRecord, focus: QueryFocus): number {
  const text = `${record.title} ${record.detail ?? ""}`;
  const kindHit = focus.topics.some((t) => TOPIC_RECORD_KINDS[t]?.includes(record.kind));
  return (
    3 * regionsIn(text).filter((r) => focus.regions.includes(r)).length +
    2 * overlap(focus.keywords, keywordsOf(text)) +
    (kindHit ? 1 : 0)
  );
}

function scoreRule(rule: HealthRule, focus: QueryFocus): number {
  const text = `${rule.subject} ${rule.detail ?? ""} ${rule.reason ?? ""}`;
  const domainHit = focus.topics.some((t) => TOPIC_RULE_DOMAINS[t].includes(rule.domain));
  return (
    3 * regionsIn(text).filter((r) => focus.regions.includes(r)).length +
    2 * overlap(focus.keywords, keywordsOf(text)) +
    (domainHit ? 1 : 0)
  );
}

/**
 * The items worth sending, best first. Anything with a specific match (score
 * ≥ 2: a region or a keyword) qualifies; when nothing does, a topic-level match
 * is the fallback — "I'm always tired" should still bring the sleep issue.
 */
function pick<T>(items: T[], score: (item: T) => number, max: number, tieBreak: (a: T, b: T) => number): T[] {
  const scored = items.map((item) => ({ item, s: score(item) })).filter((x) => x.s > 0);
  const strong = scored.filter((x) => x.s >= 2);
  return (strong.length ? strong : scored)
    .sort((a, b) => b.s - a.s || tieBreak(a.item, b.item))
    .slice(0, max)
    .map((x) => x.item);
}

const SEVERITY_RANK: Record<string, number> = { urgent: 0, high: 1, moderate: 2, low: 3 };
const bySeverity = (a: HealthIssue, b: HealthIssue) =>
  (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) || b.updatedAt - a.updatedAt;
const byRecency = (a: HealthRecord, b: HealthRecord) => b.occurredAt - a.occurredAt;
const byUpdated = (a: HealthRule, b: HealthRule) => b.updatedAt - a.updatedAt;

// ── Rendering ────────────────────────────────────────────────────────────────

function issueBlock(issue: HealthIssue, r: Redactor, now: number): string {
  const done = issue.actionPlan.filter((s) => s.done).length;
  const regions = issueRegions(issue);
  const lines = [
    `   • [${issue.key}] ${r.scrub(issue.title)} — ${issue.status}, ${issue.severity}, ${issue.progress}% done` +
      (issue.actionPlan.length ? `, ${done}/${issue.actionPlan.length} steps ticked` : "") +
      (regions.length ? `; region: ${regions.join(", ")}` : ""),
  ];
  for (const metric of issue.metrics) lines.push(`       ${trendLine(metricTrend(issue, metric))}`);
  const idle = daysSinceCheckIn(issue, now);
  if (idle != null && idle >= 7) lines.push(`       last check-in ${idle} days ago`);
  return lines.join("\n");
}

function recordLine(record: HealthRecord, r: Redactor, now: number): string {
  const detail = record.detail ? `: ${clip(r.scrub(record.detail), DETAIL_CHARS)}` : "";
  return `   • ${ago(record.occurredAt, now)} — [${record.kind}] ${r.scrub(record.title)}${detail}`;
}

const DIRECTION_WORD: Record<string, string> = {
  start: "START", more: "MORE", less: "LESS", avoid: "AVOID", keep: "KEEP",
};

function ruleLine(rule: HealthRule, r: Redactor): string {
  return `   • [${rule.key}] ${DIRECTION_WORD[rule.direction] ?? rule.direction}: ${r.scrub(rule.subject)}${
    rule.detail ? ` — ${clip(r.scrub(rule.detail), DETAIL_CHARS)}` : ""
  }${rule.status !== "active" ? ` (${rule.status})` : ""}${rule.userEdited ? " (edited by them)" : ""}`;
}

function list(values: string[], r: Redactor, empty = "none recorded"): string {
  return values.length ? values.map((v) => r.scrub(v)).join(", ") : empty;
}

/** The sentences of free-text notes that mention something the question is about. */
function relevantSentences(notes: string | undefined, focus: QueryFocus, max = 3): string[] {
  if (!notes) return [];
  return notes
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s && (overlap(focus.keywords, keywordsOf(s)) > 0 || regionsIn(s).some((x) => focus.regions.includes(x))))
    .slice(0, max);
}

// ── Disclosure ───────────────────────────────────────────────────────────────

/** What one cloud call was given, and what stayed on the server. */
export interface CloudDisclosure {
  scope: "question" | "review";
  /** What the question was read as being about. Empty for a review. */
  topics: string[];
  sent: { issues: number; records: number; rules: number };
  /** Totals held in local memory, for "2 of 9". */
  held: { issues: number; records: number; rules: number };
  /** Background sections that exist but were not relevant, so were not sent. */
  withheld: string[];
  /** What the anatomy layer worked out locally and sent as a conclusion. */
  computedLocally: string[];
  /** Identifiers scrubbed from the brief and the transcript. */
  redactions: number;
}

export interface CloudBrief {
  text: string;
  disclosure: CloudDisclosure;
}

export interface ChatBrief extends CloudBrief {
  /** The conversation as it may be sent: trimmed and scrubbed. */
  messages: ChatMessage[];
}

function personLines(memory: HealthMemory, r: Redactor, computed: string[]): string[] {
  const { profile: p, health: h, nutritionPlan } = memory;
  const calcs = bodyCalcs(p, nutritionPlan);
  if (calcs.bmi != null) computed.push("BMI");
  const body = [
    p.bodyweightKg != null ? `${p.bodyweightKg} kg` : null,
    p.heightCm != null ? `${p.heightCm} cm` : null,
    calcs.bmi != null ? `BMI ${calcs.bmi} (${calcs.bmiCategory})` : null,
  ].filter(Boolean);
  const meds = h.medications.length
    ? h.medications.map((m) => r.scrub([m.name, m.dose, m.schedule].filter(Boolean).join(" "))).join("; ")
    : "none recorded";
  return [
    "Person:",
    `- Age ${p.age ?? "unknown"}, sex ${p.sex ?? "unspecified"}${body.length ? `; ${body.join(", ")}` : ""}`,
    `- Training goal: ${p.goal}, ${p.daysPerWeek} days/week`,
    "",
    "Always complete — conditions, medications, allergies:",
    `- Conditions: ${list(h.conditions, r)}`,
    `- Medications: ${meds}`,
    `- Allergies: ${list(h.allergies, r)}`,
  ];
}

function hasValue(v: unknown): boolean {
  return Array.isArray(v) ? v.length > 0 : v != null && v !== "";
}

// Optional background sections, and the topics that make each one relevant.
const BACKGROUND: {
  name: string;
  topics: Topic[];
  present: (m: HealthMemory) => boolean;
  line: (m: HealthMemory, r: Redactor) => string;
}[] = [
  {
    name: "diet restrictions",
    topics: ["nutrition", "supplements", "digestive", "metabolic"],
    present: (m) => hasValue(m.profile.dietRestrictions),
    line: (m, r) => `- Dietary restrictions: ${list(m.profile.dietRestrictions ?? [], r, "none")}`,
  },
  {
    name: "sleep",
    topics: ["sleep", "stress", "training", "musculoskeletal"],
    present: (m) => m.health.sleepHours != null,
    line: (m) => `- Sleep: ${m.health.sleepHours} h/night`,
  },
  {
    name: "stress level",
    topics: ["stress", "sleep", "digestive", "cardiovascular"],
    present: (m) => hasValue(m.health.stressLevel),
    line: (m) => `- Stress: ${m.health.stressLevel}`,
  },
  {
    name: "smoking",
    topics: ["cardiovascular", "respiratory", "substances", "metabolic"],
    present: (m) => hasValue(m.health.smoking),
    line: (m) => `- Smoking: ${m.health.smoking}`,
  },
  {
    name: "alcohol",
    topics: ["substances", "sleep", "digestive", "metabolic", "nutrition", "medication"],
    present: (m) => hasValue(m.health.alcohol),
    line: (m) => `- Alcohol: ${m.health.alcohol}`,
  },
  {
    name: "past surgeries",
    topics: ["musculoskeletal", "training", "digestive"],
    present: (m) => hasValue(m.health.surgeries),
    line: (m, r) => `- Past surgeries: ${list(m.health.surgeries, r)}`,
  },
  {
    name: "family history",
    topics: ["cardiovascular", "metabolic", "labs"],
    present: (m) => hasValue(m.health.familyHistory),
    line: (m, r) => `- Family history: ${list(m.health.familyHistory, r)}`,
  },
];

/**
 * The brief for one chat turn: the always-sent core, plus only the parts of the
 * record that the recent conversation is actually about.
 */
export function buildChatBrief(memory: HealthMemory, messages: ChatMessage[], now = Date.now()): ChatBrief {
  const r = new Redactor(memory.profile.name);
  const computed: string[] = [];
  // Read the last few user turns, not just the newest: "what about at night?"
  // is still about the reflux two messages up.
  const recentUserText = messages
    .filter((m) => m.role === "user")
    .slice(-3)
    .map((m) => m.content)
    .join("\n");
  const focus = extractFocus(recentUserText);

  const matchedIssues = pick(memory.issues, (i) => scoreIssue(i, focus), CHAT_MAX_ISSUES, bySeverity);
  const records = pick(memory.records, (x) => scoreRecord(x, focus), CHAT_MAX_RECORDS, byRecency);
  const activeRules = (memory.rules ?? []).filter((x) => x.status !== "archived");
  const rules = pick(activeRules, (x) => scoreRule(x, focus), CHAT_MAX_RULES, byUpdated);
  // A question with no discernible subject ("what should I focus on?") gets the
  // top of the open worklist, a line each, rather than nothing or everything.
  const general = !focus.topics.length && !matchedIssues.length && !records.length && !rules.length;
  const issues = general
    ? memory.issues.filter((i) => !CLOSED_STATUSES.has(i.status)).sort(bySeverity).slice(0, CHAT_MAX_ISSUES)
    : matchedIssues;

  const background: string[] = [];
  const withheld: string[] = [];
  for (const section of BACKGROUND) {
    if (!section.present(memory)) continue;
    if (section.topics.some((t) => focus.topics.includes(t))) background.push(section.line(memory, r));
    else withheld.push(section.name);
  }
  if (memory.health.bloodType) withheld.push("blood type");
  const noteLines = relevantSentences(memory.health.notes, focus).map((s) => `- From their notes: "${clip(r.scrub(s), 240)}"`);
  if (noteLines.length) background.push(...noteLines);
  else if (memory.health.notes) withheld.push("personal notes");

  const wantsNutrition = focus.topics.some((t) => ["nutrition", "supplements", "metabolic", "digestive"].includes(t));
  const targets = memory.nutritionPlan?.trainingDay?.targets;
  const calcs = bodyCalcs(memory.profile, memory.nutritionPlan);
  const nutritionLine =
    wantsNutrition && targets
      ? `Nutrition plan (training day): ${targets.calories} kcal, ${targets.protein} g protein` +
        `${calcs.proteinPerKg != null ? ` (${calcs.proteinPerKg} g/kg)` : ""}, ${targets.carbs} g carbs, ${targets.fats} g fat`
      : "";
  if (nutritionLine && calcs.proteinPerKg != null) computed.push("protein per kg");
  if (!nutritionLine && targets) withheld.push("nutrition plan");

  const wantsTraining = focus.topics.some((t) => ["training", "musculoskeletal"].includes(t));
  const trainingLine = wantsTraining && memory.trainingContext ? memory.trainingContext : "";
  if (!trainingLine && memory.trainingContext) withheld.push("training log");

  const trendCount = issues.reduce((n, i) => n + i.metrics.length, 0);
  if (trendCount) computed.push(`${trendCount} metric trend${trendCount === 1 ? "" : "s"}`);

  const left = {
    issues: memory.issues.length - issues.length,
    records: memory.records.length - records.length,
    rules: activeRules.length - rules.length,
  };

  const text = [
    "About this brief: it was prepared on the app's server from the person's record. Conditions, medications " +
      "and allergies are always complete. Everything else is ONLY the part relevant to the current question — " +
      `${left.issues} tracked issue(s), ${left.records} history entr${left.records === 1 ? "y" : "ies"} and ` +
      `${left.rules} rule(s) were left out as unrelated. If you need something that isn't here, ask for it in one ` +
      "short question; never assume it doesn't exist. Trends were computed from their logged readings; trust " +
      "them over re-deriving anything. Identifiers were removed ([name], [number]…) — don't ask for them.",
    "",
    ...personLines(memory, r, computed),
    ...(background.length ? ["", "Relevant background:", ...background] : []),
    "",
    general
      ? "Their top open issues (key in brackets — reuse it to update one):"
      : "Relevant tracked issues (key in brackets — reuse it to update one):",
    issues.length ? issues.map((i) => issueBlock(i, r, now)).join("\n") : "   • none relevant",
    ...(records.length ? ["", "Relevant history:", records.map((x) => recordLine(x, r, now)).join("\n")] : []),
    ...(rules.length
      ? [
          "",
          "Relevant standing do & don't rules (reuse a key to change one; never restate one that already says the " +
            'same thing, and leave anything marked "edited by them" alone unless they ask):',
          rules.map((x) => ruleLine(x, r)).join("\n"),
        ]
      : []),
    ...(nutritionLine ? ["", nutritionLine] : []),
    ...(trainingLine ? ["", "Recent training:", trainingLine] : []),
  ].join("\n");

  const outgoing = minimizeTranscript(messages, r);

  return {
    text,
    messages: outgoing,
    disclosure: {
      scope: "question",
      topics: general ? ["general"] : focus.topics,
      sent: { issues: issues.length, records: records.length, rules: rules.length },
      held: { issues: memory.issues.length, records: memory.records.length, rules: activeRules.length },
      withheld,
      computedLocally: computed,
      redactions: r.count,
    },
  };
}

/**
 * The brief for a health review. A review is synthesis over the whole picture,
 * so it gets more than a chat turn does — every open issue with its trend, and
 * the lifestyle background — but still not the archive: history beyond the last
 * six months is summarised as counts, closed issues are a key and a title, and
 * the standing rules (which a review never writes) stay home.
 */
export function buildReviewBrief(memory: HealthMemory, now = Date.now()): CloudBrief {
  const r = new Redactor(memory.profile.name);
  const computed: string[] = [];
  const open = memory.issues.filter((i) => !CLOSED_STATUSES.has(i.status)).sort(bySeverity);
  const closed = memory.issues.filter((i) => CLOSED_STATUSES.has(i.status));

  const cutoff = now - REVIEW_RECORD_WINDOW_DAYS * DAY;
  const recent = memory.records.filter((x) => x.occurredAt >= cutoff).slice(0, REVIEW_MAX_RECORDS);
  const older = memory.records.filter((x) => !recent.includes(x));
  const olderByKind = new Map<string, number>();
  for (const x of older) olderByKind.set(x.kind, (olderByKind.get(x.kind) ?? 0) + 1);

  const background = BACKGROUND.filter((s) => s.present(memory)).map((s) => s.line(memory, r));
  const withheld: string[] = [];
  if (memory.health.bloodType) withheld.push("blood type");
  if (memory.rules?.length) withheld.push("do & don't rules");
  if (older.length) withheld.push("history older than 6 months (sent as counts)");
  const notes = memory.health.notes ? clip(r.scrub(memory.health.notes), 300) : "";

  const regions = regionLoad(memory.issues);
  if (regions.length) computed.push("body-region load");
  const trendCount = open.reduce((n, i) => n + i.metrics.length, 0);
  if (trendCount) computed.push(`${trendCount} metric trend${trendCount === 1 ? "" : "s"}`);

  const targets = memory.nutritionPlan?.trainingDay?.targets;

  const text = [
    "About this brief: it was prepared on the app's server. It carries every open issue with trends computed " +
      "from their logged readings, the last six months of history in full and older history only as counts. " +
      "Identifiers were removed. Work from what is here; do not invent what is not.",
    "",
    ...personLines(memory, r, computed),
    ...(background.length ? ["", "Background:", ...background] : []),
    ...(notes ? [`- Notes (excerpt): "${notes}"`] : []),
    "",
    "Open issues (key in brackets — REUSE it to update rather than duplicate):",
    open.length ? open.map((i) => issueBlock(i, r, now)).join("\n") : "   • none tracked yet",
    ...(closed.length
      ? ["", "Closed by the person — do not raise these again under a new key:",
         closed.map((i) => `   • [${i.key}] ${r.scrub(i.title)} (${i.status})`).join("\n")]
      : []),
    ...(regions.length
      ? ["", `Open issues by body region: ${regions.map((x) => `${x.region} (${x.open})`).join(", ")}`]
      : []),
    "",
    "History, last six months:",
    recent.length ? recent.map((x) => recordLine(x, r, now)).join("\n") : "   • nothing recorded",
    ...(olderByKind.size
      ? [`Older history (not sent, counts only): ${[...olderByKind].map(([k, n]) => `${n} ${k}`).join(", ")}`]
      : []),
    ...(targets
      ? ["", `Nutrition plan (training day): ${targets.calories} kcal, ${targets.protein} g protein, ${targets.carbs} g carbs, ${targets.fats} g fat`]
      : []),
    ...(memory.trainingContext ? ["", "Recent training:", memory.trainingContext] : []),
  ].join("\n");

  return {
    text,
    disclosure: {
      scope: "review",
      topics: [],
      sent: { issues: open.length + closed.length, records: recent.length, rules: 0 },
      held: {
        issues: memory.issues.length,
        records: memory.records.length,
        rules: (memory.rules ?? []).filter((x) => x.status !== "archived").length,
      },
      withheld,
      computedLocally: computed,
      redactions: r.count,
    },
  };
}

/**
 * The conversation as the cloud model receives it: the last few turns, with
 * identifiers scrubbed and photos kept only on the newest message — an image
 * already answered is not re-uploaded on every later turn.
 */
export function minimizeTranscript(messages: ChatMessage[], r: Redactor): ChatMessage[] {
  const recent = messages.slice(-TRANSCRIPT_TURNS);
  return recent.map((m, idx) => {
    const isNewest = idx === recent.length - 1;
    const content = r.scrub(m.content);
    if (isNewest || !m.images?.length) return { ...m, content };
    return {
      role: m.role,
      content: content.trim() ? content : "(shared a photo earlier — already discussed, not re-sent)",
    };
  });
}
