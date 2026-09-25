// Layer 3 — Safety: medical guardrails, escalation and uncertainty.
//
// Everything here is deterministic and runs on our own server, whatever model
// is behind the reasoning layer and whether or not that model answered at all:
//
//   • **Escalation.** `detectRedFlags` screens the user's words BEFORE the model
//     runs and the model's reply AFTER it; a hit prepends `EMERGENCY_NOTICE`
//     regardless of what the model said, and still fires when the call fails.
//   • **Guardrails on output.** Model output goes straight into the database, so
//     every field of a proposed issue, rule or record is clamped to a known value
//     and every string is length-capped here before anything is written.
//   • **Uncertainty.** Confidence is carried through as low/medium/high and never
//     invented; every reply carries `MEDICAL_DISCLAIMER`, and the UI shows it.

import { slugify } from "../util";
import type {
  ActionStep,
  AIHealthIssue,
  AIHealthRule,
  HealthIssueCategory,
  HealthIssueSeverity,
  HealthRecordKind,
  IssueMetric,
  RuleDirection,
  RuleDomain,
} from "../types";

export const MEDICAL_DISCLAIMER =
  "This is general health information from an AI assistant, not a diagnosis or medical advice. " +
  "For anything new, worsening, or worrying, see a qualified clinician.";

export const EMERGENCY_NOTICE =
  "⚠️ What you described can be a medical emergency. Please stop and contact emergency services " +
  "(112 in the EU, 911 in the US, 999 in the UK) or go to the nearest emergency department now. " +
  "Do not wait to see whether it passes, and do not rely on this app for it.";

// Symptom patterns that must never be handled as ordinary coaching questions.
// Deliberately broad: a false positive costs one extra paragraph of caution, a
// false negative costs far more.
const RED_FLAGS: { pattern: RegExp; label: string }[] = [
  { pattern: /\b(crushing|severe|tight(ness)?)\b[^.]{0,30}\bchest\b|\bchest (pain|pressure|tightness)\b/i, label: "chest pain or pressure" },
  { pattern: /\b(can'?t|cannot|trouble|difficulty|short(ness)? of)\s*breath(e|ing)?\b|\bgasping\b/i, label: "difficulty breathing" },
  { pattern: /\b(passed out|fainted|fainting|lost consciousness|unconscious|blacked out)\b/i, label: "loss of consciousness" },
  { pattern: /\b(slurred speech|face (is )?droop|one side of my (face|body)|sudden (numbness|weakness))\b/i, label: "possible stroke signs" },
  // Phrasing varies a lot here and a miss is the costliest one in the list, so
  // this covers the common gerund/infinitive forms rather than fixed phrases.
  { pattern: /\b(suicid\w*|kill(ing)? myself|end (my life|it all)|self[- ]harm|(harm|hurt)(ing)? myself|want(ing)? to die)\b/i, label: "thoughts of self-harm" },
  { pattern: /\b(anaphyla\w*|throat (is )?(closing|swelling)|tongue swelling)\b/i, label: "possible anaphylaxis" },
  { pattern: /\b(coughing|vomit\w*)\s+blood\b|\bblood in (my )?(stool|urine|vomit)\b|\bhemorrhag\w*\b/i, label: "bleeding" },
  { pattern: /\b(seizure|convuls\w*)\b/i, label: "seizure" },
  { pattern: /\bworst headache\b|\bthunderclap headache\b/i, label: "sudden severe headache" },
  { pattern: /\b(overdose|poison(ed|ing)?)\b/i, label: "overdose or poisoning" },
  { pattern: /\b(broken bone|compound fracture|bone (is )?(sticking|showing))\b/i, label: "possible fracture" },
];

/** Emergency-symptom screen. Returns the labels that matched, newest-first. */
export function detectRedFlags(text: string): string[] {
  const found: string[] = [];
  for (const { pattern, label } of RED_FLAGS) {
    if (pattern.test(text) && !found.includes(label)) found.push(label);
  }
  return found;
}

// ── Output guardrails ────────────────────────────────────────────────────────
// Model output goes straight into the database, so every field is clamped to a
// known value and every string is length-capped.

const CATEGORIES: HealthIssueCategory[] = [
  "injury", "pain", "nutrition", "metabolic", "sleep", "stress", "medical", "lifestyle", "other",
];
const SEVERITIES: HealthIssueSeverity[] = ["low", "moderate", "high", "urgent"];
const RECORD_KINDS: HealthRecordKind[] = [
  "symptom", "condition", "medication", "allergy", "injury",
  "surgery", "lab", "vitals", "appointment", "note",
];

export const MAX_TITLE = 120;
export const MAX_TEXT = 1500;
const MAX_STEPS = 8;
const MAX_METRICS = 5;
const MAX_FLAGS = 5;

export function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function optStr(v: unknown, max: number): string | undefined {
  const s = str(v, max);
  return s || undefined;
}

/** Stable identity for an issue, so re-reviews update instead of duplicating. */
export function issueKey(raw: unknown, title: string): string {
  const fromModel = slugify(str(raw, 64));
  return (fromModel || slugify(title) || "issue").slice(0, 64);
}

function normalizeSteps(v: unknown): ActionStep[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((s: any) => ({
      step: str(typeof s === "string" ? s : s?.step, 300),
      cadence: optStr(s?.cadence, 40),
    }))
    .filter((s) => s.step)
    .slice(0, MAX_STEPS);
}

function normalizeMetrics(v: unknown): IssueMetric[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((m: any) => ({
      label: str(typeof m === "string" ? m : m?.label, 60),
      unit: optStr(m?.unit, 20),
      target: optStr(m?.target, 60),
    }))
    .filter((m) => m.label)
    .slice(0, MAX_METRICS);
}

function normalizeFlags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((f) => str(f, 200)).filter(Boolean).slice(0, MAX_FLAGS);
}

/** One AI-proposed issue → a shape safe to persist. Returns null if unusable. */
export function normalizeIssue(raw: any): AIHealthIssue | null {
  const title = str(raw?.title, MAX_TITLE);
  if (!title) return null;
  const category: HealthIssueCategory = CATEGORIES.includes(raw?.category) ? raw.category : "other";
  const severity: HealthIssueSeverity = SEVERITIES.includes(raw?.severity) ? raw.severity : "moderate";
  const confidence = ["low", "medium", "high"].includes(raw?.confidence) ? raw.confidence : undefined;
  return {
    key: issueKey(raw?.key, title),
    title,
    category,
    severity,
    summary: str(raw?.summary, MAX_TEXT),
    whyItMatters: optStr(raw?.whyItMatters, MAX_TEXT),
    bodyRegion: optStr(raw?.bodyRegion, 60),
    actionPlan: normalizeSteps(raw?.actionPlan),
    metrics: normalizeMetrics(raw?.metrics),
    redFlags: normalizeFlags(raw?.redFlags),
    confidence,
  };
}

const RULE_DOMAINS: RuleDomain[] = ["nutrition", "physical", "medical", "lifestyle"];
const RULE_DIRECTIONS: RuleDirection[] = ["start", "more", "less", "avoid", "keep"];
const MAX_RULES_PER_REPLY = 6;

/** One AI-proposed rule → a shape safe to persist. Null if unusable. */
export function normalizeRule(raw: any): AIHealthRule | null {
  const subject = str(raw?.subject, MAX_TITLE);
  if (!subject) return null;
  const domain: RuleDomain = RULE_DOMAINS.includes(raw?.domain) ? raw.domain : "lifestyle";
  const direction: RuleDirection = RULE_DIRECTIONS.includes(raw?.direction) ? raw.direction : "less";
  return {
    key: issueKey(raw?.key, `${direction}-${subject}`),
    domain,
    direction,
    subject,
    detail: optStr(raw?.detail, MAX_TEXT),
    reason: optStr(raw?.reason, MAX_TEXT),
    confidence: ["low", "medium", "high"].includes(raw?.confidence) ? raw.confidence : undefined,
    issueKey: optStr(raw?.issueKey, 64) ? slugify(str(raw.issueKey, 64)) : undefined,
  };
}

/** The `[RULES]` payload is an array; anything else is ignored. */
export function normalizeRules(raw: any): AIHealthRule[] {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.rules) ? raw.rules : [];
  const out: AIHealthRule[] = [];
  for (const item of list) {
    const rule = normalizeRule(item);
    // Same key twice in one reply is the model repeating itself, not two rules.
    if (rule && !out.some((r) => r.key === rule.key)) out.push(rule);
    if (out.length >= MAX_RULES_PER_REPLY) break;
  }
  return out;
}

export interface AIHealthRecordDraft {
  kind: HealthRecordKind;
  title: string;
  detail?: string;
  occurredAt?: number;
  data: Record<string, unknown>;
}

/** One AI-proposed medical-history entry → a shape safe to persist. */
export function normalizeRecord(raw: any): AIHealthRecordDraft | null {
  const title = str(raw?.title, MAX_TITLE);
  if (!title) return null;
  const kind: HealthRecordKind = RECORD_KINDS.includes(raw?.kind) ? raw.kind : "note";
  const when = Date.parse(String(raw?.occurredAt ?? ""));
  return {
    kind,
    title,
    detail: optStr(raw?.detail, MAX_TEXT),
    // Anything in the future is a model slip (or a typo'd year) — clamp to now.
    occurredAt: Number.isFinite(when) ? Math.min(when, Date.now()) : undefined,
    data: boundedData(raw?.data),
  };
}

/**
 * `data` is free-form extras (lab values, a blood-pressure pair…). Keep it an
 * object and keep it small — an oversized blob is dropped rather than truncated,
 * because half a JSON object is worse than none.
 */
const MAX_DATA_BYTES = 4000;
export function boundedData(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  try {
    const serialized = JSON.stringify(v);
    if (serialized.length > MAX_DATA_BYTES) return {};
    return v as Record<string, unknown>;
  } catch {
    return {};
  }
}
