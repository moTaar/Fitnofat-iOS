// Health & medical API — the AI nutritionist / medical helper and the Medical
// dashboard's issue tracker.
//
// Two things make this router different from the rest of the data API:
//
//   1. **Consent gates the AI, not the data.** The CRUD routes always work: the
//      health record is the user's, kept in their own database. The AI routes
//      refuse with 403 `medical_consent_required` until the user has explicitly
//      opted in, because those are the only paths that send health data to a
//      model provider.
//   2. **The AI never owns the tracker.** A review updates the wording, plan and
//      severity of an issue; `status` and `progress` stay user-owned, ticked
//      steps stay ticked, and "this looks resolved" is a suggestion the user
//      confirms. See `reconcileIssues` in ../medical.ts.

import { Router } from "express";
import { z } from "zod";
import { supabaseAdmin } from "../supabase";
import { asyncHandler, requireAuth, AuthedRequest, HttpError } from "../middleware";
import { requireEntitlement } from "../entitlements";
import { aiLimiter, aiQuota } from "../ratelimit";
import { buildRefreshSummary, SessionLite } from "../analytics";
import {
  emptyHealthProfile, healthProfileToRow, rowToHealthEvent, rowToHealthIssue,
  rowToHealthProfile, rowToHealthRecord, rowToHealthRule, rowToNutritionPlan, rowToProfile,
} from "../mappers";
import {
  activeProvider, medicalChat, MEDICAL_DISCLAIMER, modelLabel, reconcileIssues, reviewHealth,
  warmSelfHosted, type AIHealthRecordDraft, type HealthContext,
} from "../medical";
import type { ChatMessage } from "../gemini";
import type {
  AIHealthIssue, AIHealthRule, HealthIssue, HealthProfile, HealthRule, UserProfile,
} from "../types";

export const healthRouter = Router();
healthRouter.use(requireAuth);

const uid = (req: AuthedRequest) => req.userId;

// How much history the AI sees. Enough to reason over, small enough to keep the
// prompt (and the amount of health data leaving the DB) bounded.
const RECORDS_FOR_AI = 40;
const EVENTS_PER_ISSUE = 10;

// ── validation ───────────────────────────────────────────────────────────────
const medicationSchema = z.object({
  name: z.string().min(1).max(120),
  dose: z.string().max(80).optional(),
  schedule: z.string().max(80).optional(),
});

const healthProfileSchema = z.object({
  conditions: z.array(z.string().max(160)).max(40).optional(),
  allergies: z.array(z.string().max(160)).max(40).optional(),
  medications: z.array(medicationSchema).max(40).optional(),
  surgeries: z.array(z.string().max(160)).max(40).optional(),
  familyHistory: z.array(z.string().max(160)).max(40).optional(),
  bloodType: z.string().max(10).optional(),
  smoking: z.enum(["never", "former", "current"]).optional(),
  alcohol: z.enum(["none", "occasional", "regular", "heavy"]).optional(),
  sleepHours: z.number().min(0).max(24).optional(),
  stressLevel: z.enum(["low", "moderate", "high"]).optional(),
  notes: z.string().max(4000).optional(),
});

const stepSchema = z.object({
  step: z.string().min(1).max(300),
  cadence: z.string().max(40).optional(),
  done: z.boolean().optional(),
});
const metricSchema = z.object({
  label: z.string().min(1).max(60),
  unit: z.string().max(20).optional(),
  target: z.string().max(60).optional(),
  latest: z.number().optional(),
  latestAt: z.number().optional(),
});

const CATEGORY = z.enum([
  "injury", "pain", "nutrition", "metabolic", "sleep", "stress", "medical", "lifestyle", "other",
]);
const STATUS = z.enum(["open", "in_progress", "monitoring", "resolved", "dismissed"]);
const SEVERITY = z.enum(["low", "moderate", "high", "urgent"]);
const RECORD_KIND = z.enum([
  "symptom", "condition", "medication", "allergy", "injury",
  "surgery", "lab", "vitals", "appointment", "note",
]);

const issueCreateSchema = z.object({
  title: z.string().min(1).max(120),
  category: CATEGORY.optional(),
  severity: SEVERITY.optional(),
  summary: z.string().max(1500).optional(),
  whyItMatters: z.string().max(1500).optional(),
  bodyRegion: z.string().max(60).optional(),
  actionPlan: z.array(stepSchema).max(12).optional(),
  metrics: z.array(metricSchema).max(8).optional(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  firstNoticedAt: z.number().int().positive().optional(),
});

const issuePatchSchema = issueCreateSchema.partial().extend({
  status: STATUS.optional(),
  progress: z.number().int().min(0).max(100).optional(),
});

const eventSchema = z.object({
  kind: z.enum(["note", "check_in", "status_change", "measurement", "ai_review"]).optional(),
  body: z.string().max(2000).optional(),
  metric: z.string().max(60).optional(),
  value: z.number().optional(),
  unit: z.string().max(20).optional(),
});

const RULE_DOMAIN = z.enum(["nutrition", "physical", "medical", "lifestyle"]);
const RULE_DIRECTION = z.enum(["start", "more", "less", "avoid", "keep"]);
const RULE_STATUS = z.enum(["active", "paused", "archived"]);

const ruleCreateSchema = z.object({
  subject: z.string().min(1).max(120),
  domain: RULE_DOMAIN.optional(),
  direction: RULE_DIRECTION.optional(),
  detail: z.string().max(1500).optional(),
  reason: z.string().max(1500).optional(),
  issueId: z.string().uuid().optional(),
});

const rulePatchSchema = ruleCreateSchema.partial().extend({
  status: RULE_STATUS.optional(),
});

const recordSchema = z.object({
  kind: RECORD_KIND.optional(),
  title: z.string().min(1).max(120),
  detail: z.string().max(4000).optional(),
  occurredAt: z.number().int().positive().optional(),
  data: z.record(z.unknown()).optional(),
  issueId: z.string().uuid().optional(),
});

// Same attachment contract as the training coach: a lab printout, a medication
// label or a photo of a symptom, downscaled client-side.
const chatImageSchema = z.object({
  mimeType: z.string().regex(/^image\//),
  data: z.string().min(1).max(8_000_000),
});
const chatMessageSchema = z.object({
  role: z.enum(["user", "model"]),
  content: z.string(),
  images: z.array(chatImageSchema).max(4).optional(),
});

// ── loaders ──────────────────────────────────────────────────────────────────

async function loadHealthProfile(userId: string): Promise<HealthProfile> {
  const { data } = await supabaseAdmin
    .from("health_profile").select("*").eq("user_id", userId).maybeSingle();
  return data ? rowToHealthProfile(data) : emptyHealthProfile();
}

async function loadIssues(userId: string): Promise<HealthIssue[]> {
  const { data: issues, error } = await supabaseAdmin
    .from("health_issues").select("*").eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = issues ?? [];
  if (!rows.length) return [];

  // One query for every issue's recent events, then grouped in memory — a query
  // per issue would be a round trip per card on the dashboard.
  const { data: events } = await supabaseAdmin
    .from("health_issue_events")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  const byIssue = new Map<string, any[]>();
  for (const e of events ?? []) {
    const list = byIssue.get(e.issue_id) ?? [];
    if (list.length < EVENTS_PER_ISSUE) list.push(e);
    byIssue.set(e.issue_id, list);
  }
  return rows.map((r) => rowToHealthIssue(r, byIssue.get(r.id) ?? []));
}

async function loadRules(userId: string): Promise<HealthRule[]> {
  const { data, error } = await supabaseAdmin
    .from("health_rules").select("*").eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToHealthRule);
}

async function loadRecords(userId: string, limit = 200) {
  const { data, error } = await supabaseAdmin
    .from("health_records").select("*").eq("user_id", userId)
    .order("occurred_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToHealthRecord);
}

async function loadTrainingProfile(userId: string): Promise<UserProfile | null> {
  const { data } = await supabaseAdmin
    .from("profiles").select("*").eq("user_id", userId).maybeSingle();
  return data ? rowToProfile(data) : null;
}

async function loadNutritionPlan(userId: string) {
  const { data } = await supabaseAdmin
    .from("nutrition_plans").select("*").eq("user_id", userId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data ? rowToNutritionPlan(data) : null;
}

/** Recent training digest — the same summary the training coach is given. */
async function loadTrainingContext(userId: string, profile: UserProfile): Promise<string | undefined> {
  const { data: workouts } = await supabaseAdmin
    .from("workouts").select("*").eq("user_id", userId)
    .order("started_at", { ascending: false }).limit(30);
  const history: SessionLite[] = (workouts ?? []).map((w) => ({
    startedAt: new Date(w.started_at).getTime(),
    totalVolume: Number(w.total_volume),
    exercises: w.exercises ?? [],
  }));
  if (!history.length) return undefined;
  return buildRefreshSummary(history, profile);
}

/** Everything the medical model is allowed to see, assembled in one place. */
async function buildContext(userId: string): Promise<HealthContext> {
  const [profile, health, issues, records, rules, nutritionPlan] = await Promise.all([
    loadTrainingProfile(userId),
    loadHealthProfile(userId),
    loadIssues(userId),
    loadRecords(userId, RECORDS_FOR_AI),
    loadRules(userId),
    loadNutritionPlan(userId),
  ]);
  if (!profile) throw new HttpError(400, "Complete onboarding first", "onboarding_required");
  return {
    profile,
    health,
    issues,
    records,
    rules,
    nutritionPlan,
    trainingContext: await loadTrainingContext(userId, profile),
  };
}

/**
 * Blocks the AI routes until the user has opted in. This is the boundary where
 * health data would otherwise leave the database, so it is enforced server-side
 * rather than trusted to the UI.
 */
const requireHealthConsent = asyncHandler(async (req, _res, next) => {
  const health = await loadHealthProfile(uid(req as AuthedRequest));
  if (!health.aiConsentAt) {
    throw new HttpError(
      403,
      "Turn on AI health analysis first — your medical data is never sent to a model until you do.",
      "medical_consent_required"
    );
  }
  next();
});

// ── writes shared by the chat and the review ─────────────────────────────────

function issueToRow(userId: string, issue: AIHealthIssue) {
  return {
    user_id: userId,
    key: issue.key,
    title: issue.title,
    category: issue.category,
    severity: issue.severity,
    summary: issue.summary,
    why_it_matters: issue.whyItMatters ?? null,
    body_region: issue.bodyRegion ?? null,
    action_plan: issue.actionPlan,
    metrics: issue.metrics,
    red_flags: issue.redFlags,
    confidence: issue.confidence ?? null,
    source: "ai",
    last_reviewed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Upserts an AI-proposed issue, preserving the user-owned fields of an issue
 * that already exists under the same key (see reconcileIssues). Used by the chat
 * path, where there is exactly one proposal rather than a whole review.
 */
async function upsertAiIssue(userId: string, proposal: AIHealthIssue): Promise<HealthIssue> {
  const existing = await loadIssues(userId);
  const { create, update } = reconcileIssues(existing, {
    summary: "",
    issues: [proposal],
    resolvedKeys: [],
  });

  if (update.length) {
    const patch = update[0].patch;
    const { data, error } = await supabaseAdmin
      .from("health_issues")
      .update({
        title: patch.title,
        category: patch.category,
        severity: patch.severity,
        summary: patch.summary,
        why_it_matters: patch.whyItMatters ?? null,
        body_region: patch.bodyRegion ?? null,
        action_plan: patch.actionPlan,
        metrics: patch.metrics,
        red_flags: patch.redFlags,
        confidence: patch.confidence ?? null,
        last_reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", update[0].id)
      .eq("user_id", userId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return rowToHealthIssue(data, []);
  }

  const target = create[0] ?? proposal;
  const { data, error } = await supabaseAdmin
    .from("health_issues")
    .upsert(issueToRow(userId, target), { onConflict: "user_id,key" })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return rowToHealthIssue(data, []);
}

/**
 * Writes the rules a chat turn produced.
 *
 * The AI owns rules it wrote and nobody has touched. It may refresh their
 * wording, detail and direction under the same key — that is how "actually,
 * avoid it entirely" upgrades yesterday's "eat less of it". It may **not**:
 *   • change a rule the user has edited (`user_edited`), or
 *   • resurrect one they archived.
 * Both are left exactly as they are, silently, so the list stays the user's.
 */
async function upsertAiRules(userId: string, proposals: AIHealthRule[]): Promise<HealthRule[]> {
  if (!proposals.length) return [];
  const existing = await loadRules(userId);
  const byKey = new Map(existing.map((r) => [r.key, r]));
  const now = new Date().toISOString();

  // Link a rule to the issue it came out of, when the model named one.
  const issues = proposals.some((p) => p.issueKey) ? await loadIssues(userId) : [];
  const issueIdByKey = new Map(issues.map((i) => [i.key, i.id]));

  const rows = proposals
    .filter((p) => {
      const current = byKey.get(p.key);
      return !current || (!current.userEdited && current.status !== "archived");
    })
    .map((p) => ({
      user_id: userId,
      key: p.key,
      domain: p.domain,
      direction: p.direction,
      subject: p.subject,
      detail: p.detail ?? null,
      reason: p.reason ?? null,
      confidence: p.confidence ?? null,
      issue_id: p.issueKey ? issueIdByKey.get(p.issueKey) ?? null : null,
      source: "ai",
      updated_at: now,
    }));
  if (!rows.length) return [];

  const { data, error } = await supabaseAdmin
    .from("health_rules")
    .upsert(rows, { onConflict: "user_id,key" })
    .select();
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToHealthRule);
}

async function insertAiRecord(userId: string, draft: AIHealthRecordDraft) {
  const { data, error } = await supabaseAdmin
    .from("health_records")
    .insert({
      user_id: userId,
      kind: draft.kind,
      title: draft.title,
      detail: draft.detail ?? null,
      occurred_at: new Date(draft.occurredAt ?? Date.now()).toISOString(),
      data: draft.data,
      source: "ai",
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return rowToHealthRecord(data);
}

// ── GET /overview : everything the Medical dashboard renders ─────────────────
healthRouter.get(
  "/overview",
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const [health, issues, records, rules] = await Promise.all([
      loadHealthProfile(userId),
      loadIssues(userId),
      loadRecords(userId),
      loadRules(userId),
    ]);
    const provider = activeProvider();
    res.json({
      health,
      issues,
      records,
      rules,
      ai: {
        // The UI says which model would answer — a Gemini fallback is never
        // presented as if a medical-tuned model had replied.
        available: provider !== "none",
        model: modelLabel(provider),
        provider,
        consented: !!health.aiConsentAt,
        disclaimer: MEDICAL_DISCLAIMER,
      },
    });
  })
);

// ── PUT /profile : the standing medical background ───────────────────────────
healthRouter.put(
  "/profile",
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const patch = healthProfileSchema.parse(req.body ?? {});
    const { data, error } = await supabaseAdmin
      .from("health_profile").upsert(healthProfileToRow(userId, patch)).select().single();
    if (error) throw new Error(error.message);
    res.json(rowToHealthProfile(data));
  })
);

// ── POST /consent : opt in/out of sending health data to the model ───────────
healthRouter.post(
  "/consent",
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const { granted } = z.object({ granted: z.boolean() }).parse(req.body);
    const { data, error } = await supabaseAdmin
      .from("health_profile")
      .upsert({
        user_id: userId,
        ai_consent_at: granted ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    res.json(rowToHealthProfile(data));
  })
);

// ── Issues CRUD ──────────────────────────────────────────────────────────────
healthRouter.post(
  "/issues",
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const body = issueCreateSchema.parse(req.body);
    // A user-created issue gets a slug from its title, with a numeric suffix if
    // that slug is taken — the key is unique per user and is what the AI reuses.
    const base = body.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "issue";
    const { data: taken } = await supabaseAdmin
      .from("health_issues").select("key").eq("user_id", userId).like("key", `${base}%`);
    const used = new Set((taken ?? []).map((r) => r.key));
    let key = base;
    for (let n = 2; used.has(key); n++) key = `${base}-${n}`;

    const { data, error } = await supabaseAdmin
      .from("health_issues")
      .insert({
        user_id: userId,
        key,
        title: body.title,
        category: body.category ?? "other",
        severity: body.severity ?? "moderate",
        summary: body.summary ?? null,
        why_it_matters: body.whyItMatters ?? null,
        body_region: body.bodyRegion ?? null,
        action_plan: body.actionPlan ?? [],
        metrics: body.metrics ?? [],
        target_date: body.targetDate ?? null,
        first_noticed_at: body.firstNoticedAt ? new Date(body.firstNoticedAt).toISOString() : null,
        source: "user",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    res.status(201).json(rowToHealthIssue(data, []));
  })
);

healthRouter.patch(
  "/issues/:id",
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const body = issuePatchSchema.parse(req.body);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.title !== undefined) patch.title = body.title;
    if (body.category !== undefined) patch.category = body.category;
    if (body.severity !== undefined) patch.severity = body.severity;
    if (body.summary !== undefined) patch.summary = body.summary;
    if (body.whyItMatters !== undefined) patch.why_it_matters = body.whyItMatters;
    if (body.bodyRegion !== undefined) patch.body_region = body.bodyRegion;
    if (body.actionPlan !== undefined) patch.action_plan = body.actionPlan;
    if (body.metrics !== undefined) patch.metrics = body.metrics;
    if (body.targetDate !== undefined) patch.target_date = body.targetDate;
    if (body.progress !== undefined) patch.progress = body.progress;
    if (body.status !== undefined) {
      patch.status = body.status;
      // Resolving stamps the date; reopening clears it, so "resolved on" can't
      // linger on an issue that is open again.
      patch.resolved_at = body.status === "resolved" ? new Date().toISOString() : null;
    }

    const { data, error } = await supabaseAdmin
      .from("health_issues").update(patch).eq("id", req.params.id).eq("user_id", userId)
      .select().single();
    if (error) throw new Error(error.message);
    if (!data) throw new HttpError(404, "Issue not found");

    // A status change is part of the issue's story — record it on the timeline.
    if (body.status !== undefined) {
      await supabaseAdmin.from("health_issue_events").insert({
        user_id: userId,
        issue_id: req.params.id,
        kind: "status_change",
        body: `Status changed to ${body.status}`,
      });
    }
    res.json(rowToHealthIssue(data, []));
  })
);

healthRouter.delete(
  "/issues/:id",
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const { error } = await supabaseAdmin
      .from("health_issues").delete().eq("id", req.params.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    res.status(204).end();
  })
);

// ── POST /issues/:id/events : check-ins and measurements ─────────────────────
healthRouter.post(
  "/issues/:id/events",
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const body = eventSchema.parse(req.body);
    if (!body.body && body.value == null) {
      throw new HttpError(400, "A check-in needs a note or a measurement.");
    }

    const { data: issue } = await supabaseAdmin
      .from("health_issues").select("*").eq("id", req.params.id).eq("user_id", userId).maybeSingle();
    if (!issue) throw new HttpError(404, "Issue not found");

    const { data, error } = await supabaseAdmin
      .from("health_issue_events")
      .insert({
        user_id: userId,
        issue_id: req.params.id,
        kind: body.kind ?? (body.value != null ? "measurement" : "check_in"),
        body: body.body ?? null,
        metric: body.metric ?? null,
        value: body.value ?? null,
        unit: body.unit ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    // Mirror a measurement onto the issue's metric so the dashboard can show the
    // latest reading without walking the whole event log.
    let updatedIssue = issue;
    if (body.metric && body.value != null) {
      const metrics = ((issue.metrics ?? []) as { label: string }[]).map((m) =>
        m.label.trim().toLowerCase() === body.metric!.trim().toLowerCase()
          ? { ...m, latest: body.value, latestAt: Date.now() }
          : m
      );
      const { data: saved } = await supabaseAdmin
        .from("health_issues")
        .update({ metrics, updated_at: new Date().toISOString() })
        .eq("id", req.params.id).eq("user_id", userId)
        .select().single();
      if (saved) updatedIssue = saved;
    }

    res.status(201).json({
      event: rowToHealthEvent(data),
      issue: rowToHealthIssue(updatedIssue, []),
    });
  })
);

// ── Rules (the do & don't list) ──────────────────────────────────────────────
healthRouter.post(
  "/rules",
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const body = ruleCreateSchema.parse(req.body);
    const base =
      body.subject.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "rule";
    const { data: taken } = await supabaseAdmin
      .from("health_rules").select("key").eq("user_id", userId).like("key", `${base}%`);
    const used = new Set((taken ?? []).map((r) => r.key));
    let key = base;
    for (let n = 2; used.has(key); n++) key = `${base}-${n}`;

    const { data, error } = await supabaseAdmin
      .from("health_rules")
      .insert({
        user_id: userId,
        key,
        subject: body.subject,
        domain: body.domain ?? "lifestyle",
        direction: body.direction ?? "less",
        detail: body.detail ?? null,
        reason: body.reason ?? null,
        issue_id: body.issueId ?? null,
        source: "user",
        user_edited: true,
      })
      .select().single();
    if (error) throw new Error(error.message);
    res.status(201).json(rowToHealthRule(data));
  })
);

healthRouter.patch(
  "/rules/:id",
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const body = rulePatchSchema.parse(req.body);
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      // Any edit here hands the rule to the user: a later AI turn will refresh
      // its own rules but must not rewrite this one.
      user_edited: true,
    };
    if (body.subject !== undefined) patch.subject = body.subject;
    if (body.domain !== undefined) patch.domain = body.domain;
    if (body.direction !== undefined) patch.direction = body.direction;
    if (body.detail !== undefined) patch.detail = body.detail;
    if (body.reason !== undefined) patch.reason = body.reason;
    if (body.status !== undefined) patch.status = body.status;

    const { data, error } = await supabaseAdmin
      .from("health_rules").update(patch).eq("id", req.params.id).eq("user_id", userId)
      .select().single();
    if (error) throw new Error(error.message);
    if (!data) throw new HttpError(404, "Rule not found");
    res.json(rowToHealthRule(data));
  })
);

healthRouter.delete(
  "/rules/:id",
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const { error } = await supabaseAdmin
      .from("health_rules").delete().eq("id", req.params.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    res.status(204).end();
  })
);

// ── Records (medical history) ────────────────────────────────────────────────
healthRouter.post(
  "/records",
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const body = recordSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from("health_records")
      .insert({
        user_id: userId,
        issue_id: body.issueId ?? null,
        kind: body.kind ?? "note",
        title: body.title,
        detail: body.detail ?? null,
        occurred_at: new Date(body.occurredAt ?? Date.now()).toISOString(),
        data: body.data ?? {},
        source: "user",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    res.status(201).json(rowToHealthRecord(data));
  })
);

healthRouter.delete(
  "/records/:id",
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const { error } = await supabaseAdmin
      .from("health_records").delete().eq("id", req.params.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    res.status(204).end();
  })
);

// ── POST /warm : wake a scaled-to-zero self-hosted model ─────────────────────
// A GPU instance that has scaled to zero takes 1-2 minutes to load the model,
// which is longer than anyone will wait staring at a chat box. The client calls
// this the moment the user opens the health desk, so the boot overlaps with them
// typing their question instead of following it.
//
// Metered (`aiLimiter`) and Pro-gated, because a spin-up costs real GPU time
// even though it runs no inference — an open warm endpoint is a free way to
// bill someone else's graphics card. It carries NO consent gate, unlike every
// other route here: it sends nothing whatsoever about the user.
healthRouter.post(
  "/warm",
  aiLimiter,
  requireEntitlement("ai_medical"),
  asyncHandler(async (_req, res) => {
    const status = await warmSelfHosted();
    const provider = activeProvider();
    res.json({ status, model: modelLabel(provider), provider });
  })
);

// ── POST /review : "what should I be working on?" ────────────────────────────
// Pro-gated AND metered: it is the most expensive call in the app (a reasoning
// model over the whole record), so it carries a burst limit, an entitlement and
// a daily quota rather than just one of the three.
healthRouter.post(
  "/review",
  aiLimiter,
  requireEntitlement("ai_medical"),
  aiQuota("medical_ai"),
  requireHealthConsent,
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const ctx = await buildContext(userId);
    const review = await reviewHealth(ctx);
    const { create, update, resolvedSuggestions } = reconcileIssues(ctx.issues, review);

    if (create.length) {
      const { error } = await supabaseAdmin
        .from("health_issues")
        .upsert(create.map((i) => issueToRow(userId, i)), { onConflict: "user_id,key" });
      if (error) throw new Error(error.message);
    }
    for (const u of update) {
      const { error } = await supabaseAdmin
        .from("health_issues")
        .update({
          title: u.patch.title,
          category: u.patch.category,
          severity: u.patch.severity,
          summary: u.patch.summary,
          why_it_matters: u.patch.whyItMatters ?? null,
          body_region: u.patch.bodyRegion ?? null,
          action_plan: u.patch.actionPlan,
          metrics: u.patch.metrics,
          red_flags: u.patch.redFlags,
          confidence: u.patch.confidence ?? null,
          last_reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", u.id)
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
    }

    await supabaseAdmin.from("health_profile").upsert({
      user_id: userId,
      last_review_at: new Date().toISOString(),
      last_review_summary: review.summary,
      updated_at: new Date().toISOString(),
    });

    res.json({
      summary: review.summary,
      model: review.model,
      created: create.length,
      updated: update.length,
      // Never applied automatically — the dashboard offers them as one-tap
      // confirmations, because closing an issue is the user's call.
      resolvedSuggestions,
      issues: await loadIssues(userId),
      disclaimer: MEDICAL_DISCLAIMER,
    });
  })
);

// ── POST /chat : the nutritionist + medical helper conversation ──────────────
healthRouter.post(
  "/chat",
  aiLimiter,
  requireEntitlement("ai_medical"),
  aiQuota("medical_ai"),
  requireHealthConsent,
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const { messages } = z.object({ messages: z.array(chatMessageSchema).min(1) }).parse(req.body);
    const ctx = await buildContext(userId);
    const reply = await medicalChat(messages as ChatMessage[], ctx);

    // Rules can accompany any reply type, so they are persisted once up front.
    const rules = await upsertAiRules(userId, reply.rules ?? []);
    const common = {
      urgent: reply.urgent,
      redFlags: reply.redFlags,
      model: reply.model,
      disclaimer: MEDICAL_DISCLAIMER,
      ...(rules.length ? { rules } : {}),
    };

    if (reply.type === "issue" && reply.issue) {
      const issue = await upsertAiIssue(userId, reply.issue);
      res.json({ type: "issue", text: reply.text, issue, ...common });
      return;
    }

    if (reply.type === "record" && reply.record) {
      const record = await insertAiRecord(userId, reply.record);
      res.json({ type: "record", text: reply.text, record, ...common });
      return;
    }

    res.json({
      type: "message",
      text: reply.text,
      suggestions: reply.suggestions,
      ...common,
    });
  })
);
