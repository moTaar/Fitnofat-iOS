// AI nutritionist + medical helper.
//
// This is the only module in the app that reasons over personal health data, so
// it is deliberately conservative:
//
//   • **Provider.** Medical questions run on Vertex AI when it is configured,
//     and fall back to the Gemini API otherwise. Vertex is worth the extra
//     setup even for a Gemini model — the request stays inside the operator's
//     own Google Cloud project, under its IAM and data-residency rules, rather
//     than going to a shared API-key endpoint. If the project serves a
//     medical-tuned publisher model, point `MEDICAL_AI_MODEL` at it; the
//     Med-PaLM lineage that used to fill that slot (MedLM) was retired by
//     Google on 2025-09-29, so the default is a general Gemini model. Every
//     reply reports which model actually answered, so a fallback is never
//     silent. See `config.medicalProvider`.
//   • **Consent.** Callers must check `health_profile.ai_consent_at` before
//     calling in — see routes/health.ts. Without it, no health data is sent
//     anywhere.
//   • **Safety.** Emergency symptoms are screened for BEFORE and AFTER the model
//     runs, and a red-flag hit prepends emergency guidance regardless of what the
//     model said. Nothing here diagnoses or prescribes; every reply carries a
//     disclaimer, and the UI shows it.
//   • **Structure.** Like the training coach, the model can act on the chat by
//     emitting `[ISSUE]` (track something that needs working on) or `[RECORD]`
//     (add to the medical history). Both are normalized hard before they reach
//     the database.

import { config } from "./config";
import { slugify } from "./util";
import { googleIdToken, vertexAccessToken, vertexConfigured, vertexProjectId } from "./vertex";
import type { ChatImage, ChatMessage } from "./gemini";
import type {
  ActionStep,
  AIHealthIssue,
  AIHealthReview,
  AIHealthRule,
  HealthIssue,
  HealthIssueCategory,
  HealthIssueSeverity,
  HealthProfile,
  HealthRecord,
  HealthRecordKind,
  HealthRule,
  IssueMetric,
  NutritionPlan,
  RuleDirection,
  RuleDomain,
  UserProfile,
} from "./types";

// ── Provider plumbing ────────────────────────────────────────────────────────

export type MedicalProvider = "cloudrun" | "vertex" | "gemini" | "none";

const GEMINI_ENDPOINT = (model: string, key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

const VERTEX_ENDPOINT = (model: string, verb: "predict" | "generateContent") =>
  `https://${config.vertexLocation}-aiplatform.googleapis.com/v1/projects/${vertexProjectId()}` +
  `/locations/${config.vertexLocation}/publishers/google/models/${model}:${verb}`;

/** True when a self-hosted OpenAI-compatible endpoint is configured. */
function selfHostConfigured(): boolean {
  return !!config.medicalBaseUrl;
}

/** The model name a self-hosted server expects in the request body. */
function selfHostedModel(): string {
  return config.medicalSelfHostedModel || config.medicalModel;
}

/** Which backend will answer right now, given config and what's reachable. */
export function activeProvider(): MedicalProvider {
  const wanted = config.medicalProvider;
  if (wanted === "cloudrun") return selfHostConfigured() ? "cloudrun" : "none";
  if (wanted === "vertex") return vertexConfigured() ? "vertex" : "none";
  if (wanted === "gemini") return config.geminiApiKey.trim() ? "gemini" : "none";
  // "auto": most-specific backend first. A model you host yourself is the one
  // you chose deliberately, so it outranks the general-purpose endpoints.
  if (selfHostConfigured()) return "cloudrun";
  if (vertexConfigured()) return "vertex";
  return config.geminiApiKey.trim() ? "gemini" : "none";
}

/** Human-readable "who answered this", surfaced with every reply. */
export function modelLabel(provider: MedicalProvider): string {
  if (provider === "cloudrun") return `${selfHostedModel()} (self-hosted)`;
  if (provider === "vertex") return `${config.medicalModel} (Vertex AI)`;
  if (provider === "gemini") return `${config.medicalGeminiModel} (Gemini)`;
  return "unavailable";
}

/**
 * Vertex publisher models come in two request shapes. Gemini models use
 * `:generateContent`; the PaLM-era families (MedLM/Med-PaLM, text-bison) use
 * `:predict`, which has no system role, no JSON mode and no image parts. The
 * model id is what tells us which, so switching models needs no code change.
 */
function usesPredictShape(model: string): boolean {
  return !/^gemini/i.test(model);
}

async function medicalFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(config.medicalTimeoutMs) });
  } catch (err) {
    const name = (err as Error)?.name;
    if (name === "TimeoutError" || name === "AbortError") throw new Error("MEDICAL_TIMEOUT");
    throw new Error("MEDICAL_TIMEOUT");
  }
}

interface AskOptions {
  /** Full transcript, oldest first — for chat. Mutually exclusive with `prompt`. */
  messages?: ChatMessage[];
  /** Single-shot prompt — for reviews. Mutually exclusive with `messages`. */
  prompt?: string;
  /** Ask for JSON back. On `:predict` the schema is described in the prompt. */
  jsonSchema?: Record<string, unknown>;
  temperature?: number;
}

export interface MedicalAnswer {
  text: string;
  provider: MedicalProvider;
  model: string;
}

/**
 * Flattens a transcript into one prompt, for the `:predict` contract — it has no
 * roles and no system channel, so everything has to be one string.
 */
function flattenTranscript(system: string, messages: ChatMessage[]): string {
  const prior = messages.slice(0, -1);
  const latest = messages[messages.length - 1];
  const turns = prior
    .map((m) => `${m.role === "user" ? "Patient" : "Clinician"}: ${m.content}`)
    .join("\n");
  return [
    system,
    turns && `Conversation so far:\n${turns}`,
    `Patient: ${latest?.content ?? ""}`,
    "Clinician:",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function hasImages(messages: ChatMessage[]): boolean {
  return messages.some((m) => m.images?.length);
}

/** Normalizes the two input modes into a single transcript. */
function asMessages(opts: AskOptions): ChatMessage[] {
  if (opts.messages?.length) return opts.messages;
  return [{ role: "user", content: opts.prompt ?? "" }];
}

function messageParts(m: ChatMessage): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [];
  if (m.content.trim() || !m.images?.length) parts.push({ text: m.content });
  for (const img of m.images ?? []) {
    parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } });
  }
  return parts;
}

function generateContentBody(system: string, messages: ChatMessage[], opts: AskOptions) {
  const contents = messages.map((m) => ({ role: m.role, parts: messageParts(m) }));
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: {
      temperature: opts.temperature ?? 0.3,
      ...(opts.jsonSchema
        ? { responseMimeType: "application/json", responseSchema: opts.jsonSchema }
        : {}),
    },
  };
}

function textFromCandidates(data: any): string {
  const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p?.text ?? "").join("").trim();
}

async function askVertex(system: string, messages: ChatMessage[], opts: AskOptions): Promise<string> {
  const token = await vertexAccessToken();
  const model = config.medicalModel;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  if (usesPredictShape(model)) {
    // The PaLM-era contract has no system role and no response schema, so the
    // instructions and the JSON requirement both live in the prompt text.
    const schemaNote = opts.jsonSchema
      ? `\n\nRespond with ONLY a JSON object matching this schema (no prose, no markdown fences):\n${JSON.stringify(
          opts.jsonSchema
        )}`
      : "";
    // Reached only when there is no Gemini key to hand the photos to. Say so in
    // the prompt rather than answering as if nothing had been attached.
    const imageNote = hasImages(messages)
      ? "\n\nNOTE: the patient attached a photo that this model cannot read. Do not guess its contents — ask them to type the values or text they want you to look at."
      : "";
    const res = await medicalFetch(VERTEX_ENDPOINT(model, "predict"), {
      method: "POST",
      headers,
      body: JSON.stringify({
        instances: [{ content: flattenTranscript(system + schemaNote + imageNote, messages) }],
        parameters: {
          temperature: opts.temperature ?? 0.3,
          maxOutputTokens: 2048,
          topP: 0.8,
          topK: 40,
        },
      }),
    });
    if (!res.ok) {
      if (res.status === 429) throw new Error("QUOTA_EXCEEDED");
      // Vertex errors quote the prompt back — which is patient data. Log the
      // status only, never the body.
      throw new Error(`MEDICAL_UPSTREAM_${res.status}`);
    }
    const data: any = await res.json();
    const prediction = data?.predictions?.[0];
    return String(prediction?.content ?? prediction?.candidates?.[0]?.content ?? "").trim();
  }

  const res = await medicalFetch(VERTEX_ENDPOINT(model, "generateContent"), {
    method: "POST",
    headers,
    body: JSON.stringify(generateContentBody(system, messages, opts)),
  });
  if (!res.ok) {
    if (res.status === 429) throw new Error("QUOTA_EXCEEDED");
    throw new Error(`MEDICAL_UPSTREAM_${res.status}`);
  }
  return textFromCandidates(await res.json());
}

// ── Self-hosted (OpenAI-compatible) ──────────────────────────────────────────
// vLLM, Ollama and TGI all speak the OpenAI chat-completions shape, so one
// client covers every way of self-hosting MedGemma. See wiki/MedGemma-Cloud-Run-Deployment.md.

interface OpenAiMessage {
  role: "system" | "user" | "assistant";
  content: string | Array<Record<string, unknown>>;
}

/**
 * Transcript → OpenAI chat messages. Images ride as data-URI `image_url` parts,
 * which is how vLLM takes them for a multimodal model like MedGemma 4B; a
 * text-only server simply never sees them, because this app only attaches
 * images when the user does.
 */
export function toOpenAiMessages(system: string, messages: ChatMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [{ role: "system", content: system }];
  for (const m of messages) {
    const role = m.role === "model" ? "assistant" : "user";
    if (!m.images?.length) {
      out.push({ role, content: m.content });
      continue;
    }
    const parts: Array<Record<string, unknown>> = [];
    if (m.content.trim()) parts.push({ type: "text", text: m.content });
    for (const img of m.images) {
      parts.push({ type: "image_url", image_url: { url: `data:${img.mimeType};base64,${img.data}` } });
    }
    out.push({ role, content: parts });
  }
  return out;
}

async function askSelfHosted(
  system: string,
  messages: ChatMessage[],
  opts: AskOptions
): Promise<string> {
  const base = config.medicalBaseUrl;
  if (!base) throw new Error("MEDICAL_UNAVAILABLE");

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.medicalApiKey) {
    headers.Authorization = `Bearer ${config.medicalApiKey}`;
  } else {
    // Cloud Run's own auth: a Google-signed ID token whose audience is the
    // service's base URL (no path), so the service stays private to this
    // service account rather than open to the internet.
    const audience = base.replace(/\/v\d+$/, "");
    headers.Authorization = `Bearer ${await googleIdToken(audience)}`;
  }

  const res = await medicalFetch(`${base}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: selfHostedModel(),
      messages: toOpenAiMessages(system, messages),
      temperature: opts.temperature ?? 0.3,
      max_tokens: 2048,
      // vLLM honours OpenAI's JSON mode. The reply still goes through the
      // fence-stripping parser, so a server that ignores this degrades rather
      // than breaks.
      ...(opts.jsonSchema ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (!res.ok) {
    if (res.status === 429) throw new Error("QUOTA_EXCEEDED");
    // The body can echo the prompt — which is patient data. Status only.
    throw new Error(`MEDICAL_UPSTREAM_${res.status}`);
  }
  const data: any = await res.json();
  return String(data?.choices?.[0]?.message?.content ?? "").trim();
}

async function askGemini(system: string, messages: ChatMessage[], opts: AskOptions): Promise<string> {
  const key = config.geminiApiKey.trim();
  if (!key) throw new Error("MEDICAL_UNAVAILABLE");
  const res = await medicalFetch(GEMINI_ENDPOINT(config.medicalGeminiModel, key), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(generateContentBody(system, messages, opts)),
  });
  if (!res.ok) {
    if (res.status === 429) throw new Error("QUOTA_EXCEEDED");
    throw new Error(`MEDICAL_UPSTREAM_${res.status}`);
  }
  return textFromCandidates(await res.json());
}

/**
 * One medical model call. Prefers the medical-tuned Vertex model and falls back
 * to Gemini when Vertex is unconfigured, unreachable, or can't serve the request
 * (attachments — the `:predict` contract is text-only). The returned `provider`
 * says which one actually ran; callers surface it rather than hiding it.
 */
export async function askMedical(system: string, opts: AskOptions = {}): Promise<MedicalAnswer> {
  let provider = activeProvider();
  if (provider === "none") throw new Error("MEDICAL_UNAVAILABLE");

  const messages = asMessages(opts);

  if (provider === "cloudrun") {
    try {
      const text = await askSelfHosted(system, messages, opts);
      if (text) return { text, provider, model: modelLabel(provider) };
      throw new Error("MEDICAL_EMPTY");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      // A self-hosted box scaled to zero answers its first request slowly, not
      // wrongly, so a timeout here is worth reporting rather than papering over
      // with a different model — but never at the cost of the answer itself.
      if (!vertexConfigured() && !config.geminiApiKey.trim()) throw err;
      console.error("[medical] self-hosted call failed, falling back:", msg);
      provider = vertexConfigured() ? "vertex" : "gemini";
    }
  }

  // Photos (a lab report, a rash, a medication label) can only go to a
  // multimodal endpoint. Route those to Gemini instead of dropping the images.
  if (provider === "vertex" && usesPredictShape(config.medicalModel) && hasImages(messages)) {
    provider = config.geminiApiKey.trim() ? "gemini" : "vertex";
  }

  if (provider === "vertex") {
    try {
      const text = await askVertex(system, messages, opts);
      if (text) return { text, provider, model: modelLabel(provider) };
      throw new Error("MEDICAL_EMPTY");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      // A quota rejection is the same answer from any provider — don't burn a
      // second one. Everything else is worth retrying on Gemini.
      if (msg === "QUOTA_EXCEEDED" || !config.geminiApiKey.trim()) throw err;
      console.error("[medical] vertex call failed, falling back to Gemini:", msg);
      provider = "gemini";
    }
  }

  const text = await askGemini(system, messages, opts);
  if (!text) throw new Error("MEDICAL_EMPTY");
  return { text, provider, model: modelLabel(provider) };
}

export type WarmStatus = "ready" | "warming" | "unavailable";

/**
 * Nudges a scaled-to-zero self-hosted model awake, and reports whether it is
 * already serving.
 *
 * Deliberately cheap and deliberately impatient: it asks `/v1/models`, which
 * runs no inference, and gives up listening after `medicalWarmProbeMs`. Giving
 * up does not cancel anything — the request has already reached Cloud Run, which
 * starts an instance regardless of whether we wait for the reply. So a
 * "warming" answer means the boot is underway, not that nothing happened.
 *
 * Sends nothing about the user, which is why the route that calls this needs no
 * consent gate.
 */
export async function warmSelfHosted(): Promise<WarmStatus> {
  if (activeProvider() !== "cloudrun") return "unavailable";
  const base = config.medicalBaseUrl;
  if (!base) return "unavailable";

  try {
    const headers: Record<string, string> = {};
    if (config.medicalApiKey) {
      headers.Authorization = `Bearer ${config.medicalApiKey}`;
    } else {
      headers.Authorization = `Bearer ${await googleIdToken(base.replace(/\/v\d+$/, ""))}`;
    }
    const res = await fetch(`${base}/models`, {
      headers,
      signal: AbortSignal.timeout(config.medicalWarmProbeMs),
    });
    return res.ok ? "ready" : "warming";
  } catch {
    // Timeout, socket error, cold-start 429 — all mean "not serving yet".
    return "warming";
  }
}

// ── Safety layer ─────────────────────────────────────────────────────────────

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

// ── Normalizers ──────────────────────────────────────────────────────────────
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

const MAX_TITLE = 120;
const MAX_TEXT = 1500;
const MAX_STEPS = 8;
const MAX_METRICS = 5;
const MAX_FLAGS = 5;

function str(v: unknown, max: number): string {
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
function boundedData(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  try {
    const serialized = JSON.stringify(v);
    if (serialized.length > MAX_DATA_BYTES) return {};
    return v as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ── Context building ─────────────────────────────────────────────────────────

export interface HealthContext {
  profile: UserProfile;
  health: HealthProfile;
  issues: HealthIssue[];
  records: HealthRecord[];
  /** Standing do/don't rules, so the model updates them instead of re-inventing. */
  rules?: HealthRule[];
  nutritionPlan?: NutritionPlan | null;
  /** Pre-built training digest, same string the training coach gets. */
  trainingContext?: string;
}

function list(values: string[] | undefined, empty = "none recorded"): string {
  return values?.length ? values.join(", ") : empty;
}

function issueLine(i: HealthIssue): string {
  const steps = i.actionPlan.filter((s) => s.done).length;
  const metrics = i.metrics
    .filter((m) => m.latest != null)
    .map((m) => `${m.label} ${m.latest}${m.unit ?? ""}`)
    .join(", ");
  return [
    `   • [${i.key}] ${i.title} — ${i.status}, ${i.severity}, ${i.progress}% done`,
    i.actionPlan.length ? ` (${steps}/${i.actionPlan.length} steps ticked)` : "",
    metrics ? ` — latest: ${metrics}` : "",
  ].join("");
}

const DIRECTION_WORD: Record<string, string> = {
  start: "START",
  more: "MORE",
  less: "LESS",
  avoid: "AVOID",
  keep: "KEEP",
};

function ruleLine(r: HealthRule): string {
  return `   • [${r.key}] ${DIRECTION_WORD[r.direction] ?? r.direction}: ${r.subject}${
    r.detail ? ` — ${r.detail}` : ""
  }${r.status !== "active" ? ` (${r.status})` : ""}${r.userEdited ? " (edited by them)" : ""}`;
}

function recordLine(r: HealthRecord): string {
  return `   • ${new Date(r.occurredAt).toDateString()} — [${r.kind}] ${r.title}${
    r.detail ? `: ${r.detail.slice(0, 200)}` : ""
  }`;
}

/** The athlete's health picture, as the model sees it. */
export function buildHealthContext(ctx: HealthContext): string {
  const { profile: p, health: h } = ctx;
  const meds = h.medications.length
    ? h.medications.map((m) => [m.name, m.dose, m.schedule].filter(Boolean).join(" ")).join("; ")
    : "none recorded";
  const targets = ctx.nutritionPlan?.trainingDay?.targets;

  return `Person (self-reported):
- Name: ${p.name || "unknown"}, age ${p.age ?? "unknown"}, sex ${p.sex ?? "unspecified"}
- Bodyweight ${p.bodyweightKg ?? "unknown"} kg, height ${p.heightCm ?? "unknown"} cm
- Training: ${p.daysPerWeek} days/week, ${p.sessionMinutes} min sessions, goal ${p.goal}
- Lifestyle activity: ${p.activityLevel ?? "unknown"}; diet goal: ${p.dietGoal ?? "unspecified"}
- Dietary restrictions: ${list(p.dietRestrictions, "none")}

Medical background:
- Conditions: ${list(h.conditions)}
- Medications: ${meds}
- Allergies: ${list(h.allergies)}
- Past surgeries: ${list(h.surgeries)}
- Family history: ${list(h.familyHistory)}
- Blood type: ${h.bloodType ?? "unknown"}
- Sleep: ${h.sleepHours != null ? `${h.sleepHours} h/night` : "unknown"}; stress: ${h.stressLevel ?? "unknown"}
- Smoking: ${h.smoking ?? "unknown"}; alcohol: ${h.alcohol ?? "unknown"}
- Notes: ${h.notes?.slice(0, 600) || "none"}

Currently tracked issues (key in brackets — reuse it to update an existing one):
${ctx.issues.length ? ctx.issues.map(issueLine).join("\n") : "   • none tracked yet"}

Recent medical history:
${ctx.records.length ? ctx.records.slice(0, 25).map(recordLine).join("\n") : "   • nothing recorded yet"}

Their standing do & don't rules (reuse a key to change one; never restate one that already says the same thing, and leave anything marked "edited by them" alone unless they ask):
${ctx.rules?.length ? ctx.rules.map(ruleLine).join("\n") : "   • none set yet"}
${
  targets
    ? `\nCurrent nutrition plan (training day): ${targets.calories} kcal, ${targets.protein} g protein, ${targets.carbs} g carbs, ${targets.fats} g fat — strategy: ${ctx.nutritionPlan?.strategy}`
    : "\nNo nutrition plan generated yet."
}
${ctx.trainingContext ? `\nRecent training:\n${ctx.trainingContext}` : ""}`;
}

// ── Chat ─────────────────────────────────────────────────────────────────────

const CHAT_SYSTEM_RULES = `You are the health desk inside Fitnofat: a registered dietitian AND a careful medical helper for ONE person, whose full record is given below.

Your job:
- Answer nutrition questions with clinical precision (macros, micronutrients, timing, supplements, interactions with their medications and restrictions).
- Answer health questions honestly and concretely, at the level of a well-informed clinician talking to an educated patient. Use their real record — never ask for something already listed below.
- Connect the dots between their training, their diet, and their health: that link is the reason this app has a health desk at all.

Hard rules:
- You do NOT diagnose and you do NOT prescribe. Describe possibilities and what would distinguish them; say plainly when something needs a clinician, a test, or an in-person exam.
- NEVER give doses for prescription medication, never tell them to start, stop or change a prescribed drug, and never contradict their prescriber. Over-the-counter and nutritional guidance is fine, with the usual caveats.
- If anything suggests an emergency (chest pain, breathing trouble, stroke signs, fainting, uncontrolled bleeding, anaphylaxis, thoughts of self-harm), say so FIRST and tell them to seek emergency care. Do not soften it, do not bury it, do not continue coaching until you have said it.
- Be specific and brief. No hedging padding, no lists of everything it could theoretically be.
- If a detail is missing and it changes your answer, ask ONE short question. Never a questionnaire.

Acting on the record — you have two markers.

When the person describes something worth TRACKING (an ongoing symptom, a deficiency, a habit to fix, a recovery target, an injury to rehab), write one short sentence confirming it, then on a NEW line output [ISSUE] followed by a single JSON object and nothing after it:
[ISSUE]
{"key":"<stable-slug, reuse an existing key to UPDATE that issue>","title":"...","category":"<injury|pain|nutrition|metabolic|sleep|stress|medical|lifestyle|other>","severity":"<low|moderate|high|urgent>","summary":"<what it is, 1-3 sentences>","whyItMatters":"<why it's worth fixing>","bodyRegion":"<optional>","actionPlan":[{"step":"...","cadence":"daily"}],"metrics":[{"label":"Pain (0-10)","unit":"","target":"< 2"}],"redFlags":["see a clinician if ..."],"confidence":"<low|medium|high>"}

When they report a FACT for their medical history (a past diagnosis, a lab result, a medication change, an allergy, an appointment, an episode that happened), confirm it in one sentence, then on a NEW line output [RECORD] followed by a single JSON object and nothing after it:
[RECORD]
{"kind":"<symptom|condition|medication|allergy|injury|surgery|lab|vitals|appointment|note>","title":"...","detail":"...","occurredAt":"<ISO date if known>","data":{}}

Separately from those two, whenever the conversation establishes something the person should now DO or STOP DOING, record it as a standing rule. This is the point of the exercise: working out that late-night acidic food is causing their reflux is only useful if "no acidic food within 3h of bed" then lands on their list. Write the sentence you would say to them, then on a NEW line output [RULES] followed by a single JSON ARRAY and nothing after it:
[RULES]
[{"key":"<stable-slug, reuse an existing key to UPDATE that rule>","domain":"<nutrition|physical|medical|lifestyle>","direction":"<start|more|less|avoid|keep>","subject":"<the thing itself, short — 'Acidic food within 3h of bed'>","detail":"<the specifics: how much, when, what instead>","reason":"<why, in one line — tied to what they told you>","issueKey":"<optional key of the issue this came from>","confidence":"<low|medium|high>"}]
   - Name the FOODS AND HABITS THEY ACTUALLY DESCRIBED, not categories. If they said they eat tomato sauce and drink orange juice at night, the rules say tomato sauce and orange juice — "acidic foods" is not actionable.
   - "avoid" means off the table entirely; "less" means reduce. Do not write "avoid" for something merely worth reducing.
   - "keep" is for a good habit they already have and should not lose.
   - At most 6 rules in one reply, and only rules this conversation actually supports. A rule you invent to seem thorough is one they will delete.
   - [RULES] may accompany [ISSUE] or [RECORD] in the same reply, or stand alone.

[ISSUE] and [RECORD] are mutually exclusive in one reply — pick the one that fits. For an ordinary answer, emit neither. You MAY end any reply with a line [SUGGESTIONS: option | option | option] offering 2-4 short follow-ups.`;

export interface MedicalReply {
  type: "message" | "issue" | "record";
  text: string;
  suggestions?: string[];
  issue?: AIHealthIssue;
  record?: AIHealthRecordDraft;
  /** Standing do/don't rules. May accompany any reply type, including a plain one. */
  rules?: AIHealthRule[];
  /** True when the emergency screen fired — the UI renders this loudly. */
  urgent: boolean;
  redFlags: string[];
  /** Which model answered, e.g. "medlm-medium (Vertex AI)". */
  model: string;
}

/** Pulls the JSON payload that follows a marker. Returns null when malformed. */
function payloadAfter(raw: string, marker: string): { text: string; json: any } | null {
  const idx = raw.indexOf(marker);
  if (idx === -1) return null;
  const before = raw.slice(0, idx).trim();
  const after = raw.slice(idx + marker.length);
  const start = after.indexOf("{");
  const end = after.lastIndexOf("}");
  if (start === -1 || end <= start) return { text: before, json: null };
  try {
    return { text: before, json: JSON.parse(after.slice(start, end + 1)) };
  } catch {
    return { text: before, json: null };
  }
}

/**
 * Pulls a balanced JSON array out of the text following `marker`, and returns
 * the text with that whole span removed.
 *
 * `payloadAfter` above takes the last `}` in the remainder, which is fine when a
 * marker is the final thing in a reply. `[RULES]` is not: it may be followed by
 * `[ISSUE]`, and swallowing to the end would eat it. So this counts brackets —
 * ignoring any inside strings — and stops at the array's real end.
 */
function extractJsonArrayAfter(raw: string, marker: string): { json: any; rest: string } {
  const markerIdx = raw.indexOf(marker);
  if (markerIdx === -1) return { json: null, rest: raw };

  const after = raw.slice(markerIdx + marker.length);
  const start = after.indexOf("[");
  if (start === -1) return { json: null, rest: raw.slice(0, markerIdx).trim() };

  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;
  for (let i = start; i < after.length; i++) {
    const ch = after[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  // Unbalanced — drop everything from the marker on rather than leak raw JSON.
  if (end === -1) return { json: null, rest: raw.slice(0, markerIdx).trim() };

  const rest = (raw.slice(0, markerIdx) + after.slice(end + 1)).trim();
  try {
    return { json: JSON.parse(after.slice(start, end + 1)), rest };
  } catch {
    return { json: null, rest };
  }
}

/**
 * Model text → a structured reply. Pure, so the marker handling is unit-tested
 * without a network call. `model` is threaded through for display only.
 */
export function parseMedicalReply(
  rawInput: string,
  model: string,
  userRedFlags: string[] = []
): MedicalReply {
  const redFlags = [...new Set([...userRedFlags, ...detectRedFlags(rawInput)])];
  const urgent = redFlags.length > 0;
  const withNotice = (text: string) => (urgent ? `${EMERGENCY_NOTICE}\n\n${text}` : text);

  // Rules can ride along with any other marker, so they come out first and the
  // remaining text is parsed as before.
  const extracted = extractJsonArrayAfter(rawInput, "[RULES]");
  const rules = extracted.json ? normalizeRules(extracted.json) : [];
  const withRules = <T extends MedicalReply>(reply: T): T =>
    rules.length ? { ...reply, rules } : reply;
  const raw = extracted.rest;

  const issue = payloadAfter(raw, "[ISSUE]");
  if (issue) {
    const normalized = issue.json ? normalizeIssue(issue.json) : null;
    if (normalized) {
      return withRules({
        type: "issue",
        text: withNotice(issue.text || `Tracking "${normalized.title}" for you.`),
        issue: normalized,
        urgent,
        redFlags,
        model,
      });
    }
    // Marker present but unusable — never leak raw JSON into the chat.
    return withRules({
      type: "message",
      text: withNotice(
        issue.text || "I couldn't structure that into something trackable — can you describe it again?"
      ),
      urgent,
      redFlags,
      model,
    });
  }

  const record = payloadAfter(raw, "[RECORD]");
  if (record) {
    const normalized = record.json ? normalizeRecord(record.json) : null;
    if (normalized?.title) {
      return withRules({
        type: "record",
        text: withNotice(record.text || `Added "${normalized.title}" to your medical history.`),
        record: normalized as AIHealthRecordDraft,
        urgent,
        redFlags,
        model,
      });
    }
    return withRules({
      type: "message",
      text: withNotice(record.text || "I couldn't save that to your history — could you rephrase it?"),
      urgent,
      redFlags,
      model,
    });
  }

  const sugMatch = raw.match(/\[SUGGESTIONS:\s*([^\]]+)\]/i);
  const suggestions = sugMatch
    ? sugMatch[1].split("|").map((s) => s.trim()).filter(Boolean).slice(0, 4)
    : undefined;
  return withRules({
    type: "message",
    text: withNotice(raw.replace(/\[SUGGESTIONS:[^\]]*\]/i, "").trim()),
    suggestions,
    urgent,
    redFlags,
    model,
  });
}

/**
 * One turn of the health chat. `messages` is the whole transcript, oldest first,
 * with the newest user turn last (same contract as the training coach).
 */
export async function medicalChat(messages: ChatMessage[], ctx: HealthContext): Promise<MedicalReply> {
  const latest = messages[messages.length - 1];
  const userText = latest?.content ?? "";
  // Screen the user's own words too: an emergency must surface even if the model
  // replies calmly (or the call fails outright).
  const userRedFlags = detectRedFlags(userText);

  const system = `${CHAT_SYSTEM_RULES}

Today's date: ${new Date().toDateString()}

${buildHealthContext(ctx)}`;

  try {
    // The whole transcript goes in, so the newest turn keeps its photo parts (a
    // lab printout, a medication label) instead of being re-sent as bare text.
    const answer = await askMedical(system, { messages, temperature: 0.3 });
    return parseMedicalReply(answer.text, answer.model, userRedFlags);
  } catch (err) {
    // Even when the model is unreachable, an emergency screen still has to land.
    if (userRedFlags.length) {
      return {
        type: "message",
        text: `${EMERGENCY_NOTICE}\n\n(The AI health desk is unreachable right now, but what you described shouldn't wait for it.)`,
        urgent: true,
        redFlags: userRedFlags,
        model: modelLabel(activeProvider()),
      };
    }
    throw err;
  }
}

// ── Review: "what needs to be worked on" ─────────────────────────────────────

const reviewSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          title: { type: "string" },
          category: {
            type: "string",
            enum: ["injury", "pain", "nutrition", "metabolic", "sleep", "stress", "medical", "lifestyle", "other"],
          },
          severity: { type: "string", enum: ["low", "moderate", "high", "urgent"] },
          summary: { type: "string" },
          whyItMatters: { type: "string" },
          bodyRegion: { type: "string" },
          actionPlan: {
            type: "array",
            items: {
              type: "object",
              properties: { step: { type: "string" }, cadence: { type: "string" } },
              required: ["step"],
            },
          },
          metrics: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                unit: { type: "string" },
                target: { type: "string" },
              },
              required: ["label"],
            },
          },
          redFlags: { type: "array", items: { type: "string" } },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
        },
        required: ["key", "title", "category", "severity", "summary", "actionPlan"],
      },
    },
    resolvedKeys: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "issues", "resolvedKeys"],
};

const REVIEW_SYSTEM = `You are a clinical reviewer building ONE person's health worklist: the concrete things they should be working on, ranked by what actually matters.

Rules:
- Work only from the record given. Do not invent symptoms, labs or diagnoses.
- Keep existing issues alive: when an item below is already tracked, REUSE its key so the entry is updated rather than duplicated. Only mint a new key for something genuinely new.
- Put a key in "resolvedKeys" when the record shows it is handled — it is only a suggestion; the person confirms.
- Return at most 8 issues. Fewer, sharper items beat an exhaustive list. If the record is thin, say so in the summary and return what little is supportable.
- Every issue needs an actionPlan of 2-5 concrete steps the person can start this week, and at least one metric they can actually measure at home (or "lab: X" when it needs a test).
- severity "urgent" is reserved for things needing care within days — use redFlags to say what would escalate it.
- You do not diagnose and you do not prescribe. Frame medical items as "worth investigating with a clinician, here's what to bring them".
- "summary" is 2-3 sentences: the overall picture and the single highest-leverage change.`;

/**
 * Deterministic reviewer used when no medical model is configured (and as the
 * floor when the model returns nothing usable). It can't reason — it just makes
 * sure the obvious, already-recorded things don't silently go untracked.
 */
export function localReview(ctx: HealthContext): AIHealthReview {
  const issues: AIHealthIssue[] = [];
  const tracked = new Set(ctx.issues.filter((i) => i.status !== "resolved").map((i) => i.key));

  // Unresolved injuries/symptoms in the history that nothing is tracking.
  for (const r of ctx.records) {
    if (r.kind !== "injury" && r.kind !== "symptom") continue;
    const key = issueKey(undefined, r.title);
    if (tracked.has(key) || issues.some((i) => i.key === key)) continue;
    issues.push({
      key,
      title: r.title,
      category: r.kind === "injury" ? "injury" : "medical",
      severity: "moderate",
      summary: `Recorded on ${new Date(r.occurredAt).toDateString()}${r.detail ? `: ${r.detail}` : ""}. No AI review has run yet, so this is listed straight from your history.`,
      actionPlan: [
        { step: "Note whether it is better, the same, or worse", cadence: "weekly" },
        { step: "Bring it up at your next clinician visit" },
      ],
      metrics: [{ label: "Severity (0-10)", target: "trending down" }],
      redFlags: ["Sudden worsening, numbness, or loss of function — seek care."],
      confidence: "low",
    });
  }

  // Gaps in the background that block any useful nutrition/health reasoning.
  const missing: string[] = [];
  if (!ctx.profile.bodyweightKg || !ctx.profile.heightCm || !ctx.profile.age) missing.push("body stats");
  if (!ctx.health.conditions.length && !ctx.health.notes) missing.push("medical background");
  if (missing.length && !tracked.has("complete-health-profile")) {
    issues.push({
      key: "complete-health-profile",
      title: "Complete your health profile",
      category: "lifestyle",
      severity: "low",
      summary: `Missing: ${missing.join(", ")}. Nutrition targets and any health review are guesswork without these.`,
      actionPlan: [{ step: `Fill in your ${missing.join(" and ")} on the Medical tab` }],
      metrics: [{ label: "Profile fields completed", target: "all" }],
      redFlags: [],
      confidence: "high",
    });
  }

  return {
    summary: issues.length
      ? "Generated without a medical model — these come straight from what you have already recorded. Configure the medical AI for a real review."
      : "Nothing to flag from your recorded history. Add symptoms, labs or notes and run a review again.",
    issues: issues.slice(0, 8),
    resolvedKeys: [],
  };
}

/** Asks the medical model for the worklist. Falls back to `localReview`. */
export async function reviewHealth(ctx: HealthContext): Promise<AIHealthReview & { model: string }> {
  const fallback = localReview(ctx);
  const provider = activeProvider();
  if (provider === "none") return { ...fallback, model: modelLabel(provider) };

  const prompt = `Review this person's health record and return the worklist as JSON.

${buildHealthContext(ctx)}`;

  try {
    const answer = await askMedical(REVIEW_SYSTEM, {
      prompt,
      jsonSchema: reviewSchema,
      temperature: 0.2,
    });
    // `:predict` has no JSON mode, so the reply can arrive fenced.
    const cleaned = answer.text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("MEDICAL_BAD_JSON");
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    const issues = (Array.isArray(parsed?.issues) ? parsed.issues : [])
      .map(normalizeIssue)
      .filter((i: AIHealthIssue | null): i is AIHealthIssue => !!i)
      .slice(0, 8);
    if (!issues.length && !str(parsed?.summary, MAX_TEXT)) throw new Error("MEDICAL_BAD_JSON");
    return {
      summary: str(parsed?.summary, MAX_TEXT) || fallback.summary,
      issues,
      resolvedKeys: (Array.isArray(parsed?.resolvedKeys) ? parsed.resolvedKeys : [])
        .map((k: unknown) => slugify(str(k, 64)))
        .filter(Boolean)
        .slice(0, 16),
      model: answer.model,
    };
  } catch (err) {
    if (err instanceof Error && err.message === "QUOTA_EXCEEDED") throw err;
    console.error("[medical] review failed, using local reviewer:", (err as Error)?.message);
    return { ...fallback, model: modelLabel(provider) };
  }
}

// ── Reconciliation ───────────────────────────────────────────────────────────
// A review is not a fresh list every time — it has to fold into what is already
// being tracked, or the dashboard would reset the user's progress on every run.
// These rules decide what the model is allowed to change:
//
//   • status and progress are USER-OWNED. The AI never sets them.
//   • a step the user ticked stays ticked, as long as its text still matches.
//   • a metric keeps its recorded readings even when the target is rewritten.
//   • issues the user resolved or dismissed are left alone — a re-review does
//     not resurrect something they closed.
//   • "resolved" from the model is a suggestion the user confirms, never a write.

export interface IssueReconciliation {
  create: AIHealthIssue[];
  update: { id: string; key: string; patch: Partial<HealthIssue> }[];
  /** Tracked, still-open keys the model believes are done. Surfaced, not applied. */
  resolvedSuggestions: string[];
}

const CLOSED_STATUSES = new Set(["resolved", "dismissed"]);

/** Carries `done` across a re-review, matching steps on their text. */
function mergeSteps(existing: ActionStep[], proposed: ActionStep[]): ActionStep[] {
  const doneByText = new Map(
    existing.filter((s) => s.done).map((s) => [s.step.trim().toLowerCase(), true])
  );
  return proposed.map((s) => ({
    ...s,
    ...(doneByText.get(s.step.trim().toLowerCase()) ? { done: true } : {}),
  }));
}

/** Keeps recorded readings when the model rewrites a metric's label/target. */
function mergeMetrics(existing: IssueMetric[], proposed: IssueMetric[]): IssueMetric[] {
  const byLabel = new Map(existing.map((m) => [m.label.trim().toLowerCase(), m]));
  return proposed.map((m) => {
    const prev = byLabel.get(m.label.trim().toLowerCase());
    return prev?.latest != null ? { ...m, latest: prev.latest, latestAt: prev.latestAt } : m;
  });
}

export function reconcileIssues(
  existing: HealthIssue[],
  review: AIHealthReview
): IssueReconciliation {
  const byKey = new Map(existing.map((i) => [i.key, i]));
  const create: AIHealthIssue[] = [];
  const update: IssueReconciliation["update"] = [];

  for (const proposed of review.issues) {
    const current = byKey.get(proposed.key);
    if (!current) {
      create.push(proposed);
      continue;
    }
    // Don't reopen what the user closed.
    if (CLOSED_STATUSES.has(current.status)) continue;
    update.push({
      id: current.id,
      key: current.key,
      patch: {
        title: proposed.title,
        category: proposed.category,
        severity: proposed.severity,
        summary: proposed.summary,
        whyItMatters: proposed.whyItMatters,
        bodyRegion: proposed.bodyRegion ?? current.bodyRegion,
        actionPlan: mergeSteps(current.actionPlan, proposed.actionPlan),
        metrics: mergeMetrics(current.metrics, proposed.metrics),
        redFlags: proposed.redFlags,
        confidence: proposed.confidence,
      },
    });
  }

  const resolvedSuggestions = review.resolvedKeys.filter((k) => {
    const current = byKey.get(k);
    return !!current && !CLOSED_STATUSES.has(current.status);
  });

  return { create, update, resolvedSuggestions };
}

// Test seam — these are pure and carry the safety-critical logic, so they are
// exercised directly in medical.test.ts rather than through a mocked fetch.
export const __medical = {
  detectRedFlags,
  normalizeIssue,
  normalizeRecord,
  normalizeRule,
  normalizeRules,
  extractJsonArrayAfter,
  boundedData,
  parseMedicalReply,
  localReview,
  reconcileIssues,
  issueKey,
  buildHealthContext,
  usesPredictShape,
  flattenTranscript,
  toOpenAiMessages,
};
