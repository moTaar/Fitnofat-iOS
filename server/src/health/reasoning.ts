// Layer 2 — Reasoning: the cloud model, used as the health coach.
//
// This is the one layer that talks to a model provider, and it never builds its
// own view of the record: every call is given a brief from the privacy layer
// (never the raw `HealthMemory`), with the safety layer screening either side.
//
//   • **Provider.** The Gemini API (`MEDICAL_AI_GEMINI_MODEL`, defaulting to the
//     coach model). Every reply reports which model answered, and the UI prints
//     it. Self-hosted MedGemma and Vertex AI were both supported once and were
//     removed in Sept 2026 — see wiki/MedGemma-Decommission.md.
//   • **Division of labour.** Calculations, trends and relevance are done
//     locally before this layer runs (anatomy.ts, privacy.ts); the model is
//     asked for what only a model can do — reasoning, conversation, synthesis.
//   • **Consent.** Callers must check `health_profile.ai_consent_at` before
//     calling in — see routes/health.ts. Without it, nothing is sent anywhere.
//   • **Structure.** Like the training coach, the model can act on the chat by
//     emitting `[ISSUE]` (track something that needs working on) or `[RECORD]`
//     (add to the medical history). Both are normalized by the safety layer
//     before they reach the database.

import { config } from "../config";
import { slugify } from "../util";
import type { ChatMessage } from "../gemini";
import type { AIHealthIssue, AIHealthReview, AIHealthRule } from "../types";
import type { HealthMemory } from "./memory";
import { buildChatBrief, buildReviewBrief, type CloudDisclosure } from "./privacy";
import {
  detectRedFlags, EMERGENCY_NOTICE, issueKey, MAX_TEXT, normalizeIssue, normalizeRecord,
  normalizeRules, str, type AIHealthRecordDraft,
} from "./safety";

// ── Provider plumbing ────────────────────────────────────────────────────────

export type MedicalProvider = "gemini" | "none";

const GEMINI_ENDPOINT = (model: string, key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

/** Which backend will answer right now — Gemini, if it has a key. */
export function activeProvider(): MedicalProvider {
  return config.geminiApiKey.trim() ? "gemini" : "none";
}

/** Human-readable "who answered this", surfaced with every reply. */
export function modelLabel(provider: MedicalProvider): string {
  if (provider === "gemini") return `${config.medicalGeminiModel} (Gemini)`;
  return "unavailable";
}

/**
 * Scheme and host of a URL for logs, or a clear marker when it won't parse.
 * The scheme is included on purpose: a misspelled one (`ttps://`) leaves the
 * host looking perfectly correct, so showing the host alone hides the fault.
 * Never the full URL — the Gemini endpoint carries the API key as a query param.
 */
function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return `unparseable URL "${url.slice(0, 80)}"`;
  }
}

/**
 * Node's fetch reports every network failure as a bare `TypeError: fetch
 * failed` and hides the real reason in `cause` — ENOTFOUND for a mistyped host,
 * ECONNREFUSED, a certificate error, an unparseable URL.
 */
function networkReason(err: unknown): string {
  const e = err as Error & { cause?: { code?: string; message?: string } };
  return e?.cause?.code || e?.cause?.message || e?.message || "unknown";
}

function isAbort(err: unknown): boolean {
  const name = (err as Error)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

/**
 * `fetch` with a deadline, and an error that says what actually happened.
 * Timeouts and network errors are distinct, and both carry the elapsed time,
 * which is the fastest discriminator there is: a real timeout takes the whole
 * deadline, everything else fails almost instantly.
 */
async function medicalFetch(url: string, init: RequestInit): Promise<Response> {
  const started = Date.now();
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(config.medicalTimeoutMs) });
  } catch (err) {
    const ms = Date.now() - started;
    if (isAbort(err)) {
      throw new Error(`MEDICAL_TIMEOUT after ${ms}ms (limit ${config.medicalTimeoutMs}ms)`);
    }
    throw new Error(`MEDICAL_NETWORK ${networkReason(err)} after ${ms}ms to ${hostOf(url)}`);
  }
}

interface AskOptions {
  /** Full transcript, oldest first — for chat. Mutually exclusive with `prompt`. */
  messages?: ChatMessage[];
  /** Single-shot prompt — for reviews. Mutually exclusive with `messages`. */
  prompt?: string;
  /** Ask for JSON back, constrained to this schema. */
  jsonSchema?: Record<string, unknown>;
  temperature?: number;
}

export interface MedicalAnswer {
  text: string;
  provider: MedicalProvider;
  model: string;
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

/** One medical model call. The returned `model` is what callers surface. */
export async function askMedical(system: string, opts: AskOptions = {}): Promise<MedicalAnswer> {
  const provider = activeProvider();
  const key = config.geminiApiKey.trim();
  if (provider === "none" || !key) throw new Error("MEDICAL_UNAVAILABLE");

  const res = await medicalFetch(GEMINI_ENDPOINT(config.medicalGeminiModel, key), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(generateContentBody(system, asMessages(opts), opts)),
  });
  if (!res.ok) {
    if (res.status === 429) throw new Error("QUOTA_EXCEEDED");
    // Error bodies can quote the prompt back — which is health data. Status only.
    throw new Error(`MEDICAL_UPSTREAM_${res.status}`);
  }
  const text = textFromCandidates(await res.json());
  if (!text) throw new Error("MEDICAL_EMPTY");
  return { text, provider, model: modelLabel(provider) };
}

// ── Chat ─────────────────────────────────────────────────────────────────────

const CHAT_SYSTEM_RULES = `You are the health desk inside Fitnofat: a registered dietitian AND a careful medical helper for ONE person. Below is a BRIEF of their record, not the record itself: it was prepared on the app's server to carry only what is relevant to the current question, and it says what was left out.

Your job:
- Answer nutrition questions with clinical precision (macros, micronutrients, timing, supplements, interactions with their medications and restrictions).
- Answer health questions honestly and concretely, at the level of a well-informed clinician talking to an educated patient. Use what the brief gives you — never ask for something it already contains.
- Connect the dots between their training, their diet, and their health: that link is the reason this app has a health desk at all.
- Trends and calculations in the brief were computed from their logged data. Reason FROM them; do not recompute or second-guess the arithmetic.

Hard rules:
- You do NOT diagnose and you do NOT prescribe. Describe possibilities and what would distinguish them; say plainly when something needs a clinician, a test, or an in-person exam.
- NEVER give doses for prescription medication, never tell them to start, stop or change a prescribed drug, and never contradict their prescriber. Over-the-counter and nutritional guidance is fine, with the usual caveats.
- If anything suggests an emergency (chest pain, breathing trouble, stroke signs, fainting, uncontrolled bleeding, anaphylaxis, thoughts of self-harm), say so FIRST and tell them to seek emergency care. Do not soften it, do not bury it, do not continue coaching until you have said it.
- Be specific and brief. No hedging padding, no lists of everything it could theoretically be.
- Say how sure you are when it matters. If a detail is missing and it changes your answer, ask ONE short question. Never a questionnaire.

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
  /** Which model answered, e.g. "gemini-2.5-pro (Gemini)". */
  model: string;
  /** What was sent to the cloud model for this turn. Absent if nothing was. */
  disclosure?: CloudDisclosure;
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
 * with the newest user turn last (same contract as the training coach). What is
 * actually sent is the privacy layer's brief and trimmed transcript, never the
 * memory or the full conversation.
 */
export async function medicalChat(messages: ChatMessage[], memory: HealthMemory): Promise<MedicalReply> {
  const latest = messages[messages.length - 1];
  const userText = latest?.content ?? "";
  // Screen the user's own words, unredacted and locally: an emergency must
  // surface even if the model replies calmly (or the call fails outright).
  const userRedFlags = detectRedFlags(userText);

  const brief = buildChatBrief(memory, messages);
  const system = `${CHAT_SYSTEM_RULES}

Today's date: ${new Date().toDateString()}

${brief.text}`;

  try {
    // The newest turn keeps its photo parts (a lab printout, a medication
    // label); older photos were already answered and are not re-sent.
    const answer = await askMedical(system, { messages: brief.messages, temperature: 0.3 });
    return { ...parseMedicalReply(answer.text, answer.model, userRedFlags), disclosure: brief.disclosure };
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
- Work only from the brief given. Do not invent symptoms, labs or diagnoses. The brief is a summary prepared on the app's server; its trends were computed from logged readings — reason from them rather than recomputing.
- Keep existing issues alive: when an item below is already tracked, REUSE its key so the entry is updated rather than duplicated. Only mint a new key for something genuinely new, and never re-raise an issue the person closed.
- Put a key in "resolvedKeys" when the brief shows it is handled (e.g. a trend that has met its target) — it is only a suggestion; the person confirms.
- Return at most 8 issues. Fewer, sharper items beat an exhaustive list. If the record is thin, say so in the summary and return what little is supportable.
- Every issue needs an actionPlan of 2-5 concrete steps the person can start this week, and at least one metric they can actually measure at home (or "lab: X" when it needs a test).
- severity "urgent" is reserved for things needing care within days — use redFlags to say what would escalate it.
- You do not diagnose and you do not prescribe. Frame medical items as "worth investigating with a clinician, here's what to bring them".
- "summary" is 2-3 sentences: the overall picture and the single highest-leverage change.`;

/**
 * Deterministic reviewer used when no medical model is configured (and as the
 * floor when the model returns nothing usable). Runs entirely locally over the
 * full memory — nothing here leaves the server. It can't reason; it just makes
 * sure the obvious, already-recorded things don't silently go untracked.
 */
export function localReview(memory: HealthMemory): AIHealthReview {
  const issues: AIHealthIssue[] = [];
  const tracked = new Set(memory.issues.filter((i) => i.status !== "resolved").map((i) => i.key));

  // Unresolved injuries/symptoms in the history that nothing is tracking.
  for (const r of memory.records) {
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
  if (!memory.profile.bodyweightKg || !memory.profile.heightCm || !memory.profile.age) missing.push("body stats");
  if (!memory.health.conditions.length && !memory.health.notes) missing.push("medical background");
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
export async function reviewHealth(
  memory: HealthMemory
): Promise<AIHealthReview & { model: string; disclosure?: CloudDisclosure }> {
  const fallback = localReview(memory);
  const provider = activeProvider();
  if (provider === "none") return { ...fallback, model: modelLabel(provider) };

  const brief = buildReviewBrief(memory);
  const prompt = `Review this person's health brief and return the worklist as JSON.

${brief.text}`;

  try {
    const answer = await askMedical(REVIEW_SYSTEM, {
      prompt,
      jsonSchema: reviewSchema,
      temperature: 0.2,
    });
    // JSON mode is requested, but tolerate a fenced reply rather than fail on it.
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
      disclosure: brief.disclosure,
    };
  } catch (err) {
    if (err instanceof Error && err.message === "QUOTA_EXCEEDED") throw err;
    console.error("[medical] review failed, using local reviewer:", (err as Error)?.message);
    // The brief may have gone out even though the answer was unusable, so the
    // disclosure still says what was sent.
    return { ...fallback, model: modelLabel(provider), disclosure: brief.disclosure };
  }
}

// Test seam — these are pure and carry the logic most likely to regress
// quietly, so they are exercised directly rather than through a mocked fetch.
export const __reasoning = {
  medicalFetch,
  hostOf,
  extractJsonArrayAfter,
};
