// Layer 5 — Chat + logging interface for health: the Medical dashboard's
// tracker, the medical history, the do & don't list, and the health chat.
//
// The other layers live in ../health/: memory (the record and its persistence),
// reasoning (the cloud model), safety (guardrails), anatomy (trends) and privacy
// (what may leave the server). This file is HTTP only — validation, gating, and
// wiring those layers together.
//
// Two things make this router different from the rest of the data API:
//
//   1. **Consent gates the AI, not the data.** The CRUD routes always work: the
//      health record is the user's, kept in their own database. The AI routes
//      refuse with 403 `medical_consent_required` until the user has explicitly
//      opted in, because those are the only paths that send anything derived
//      from health data to a model provider — and even then, only the privacy
//      layer's brief, never the record.
//   2. **The AI never owns the tracker.** A review updates the wording, plan and
//      severity of an issue; `status` and `progress` stay user-owned, ticked
//      steps stay ticked, and "this looks resolved" is a suggestion the user
//      confirms. See `reconcileIssues` in ../health/memory.ts.

import { Router } from "express";
import { z } from "zod";
import { supabaseAdmin } from "../supabase";
import { asyncHandler, requireAuth, AuthedRequest, HttpError } from "../middleware";
import { requireEntitlement } from "../entitlements";
import { aiLimiter, aiQuota } from "../ratelimit";
import {
  healthProfileToRow, rowToHealthEvent, rowToHealthIssue, rowToHealthProfile, rowToHealthRecord,
  rowToHealthRule,
} from "../mappers";
import { reconcileIssues } from "../health/memory";
import {
  applyReview, insertAiRecord, loadHealthMemory, loadHealthProfile, loadIssues, loadRecords,
  loadRules, upsertAiIssue, upsertAiRules,
} from "../health/memoryStore";
import { activeProvider, medicalChat, modelLabel, reviewHealth } from "../health/reasoning";
import { MEDICAL_DISCLAIMER } from "../health/safety";
import type { ChatMessage } from "../gemini";

export const healthRouter = Router();
healthRouter.use(requireAuth);

const uid = (req: AuthedRequest) => req.userId;

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

// ── consent gate (privacy layer, enforced at the HTTP boundary) ─────────────

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

// ── GET /ai : which model backs the medical desk ─────────────────────────────
// The iOS app reads the health record straight from Supabase (owner RLS), so
// the one part of /overview only this server knows — which model would answer —
// is served on its own. No database access: the client adds `consented` from
// the health profile it already holds. The consent gate itself stays on the
// AI routes below.
healthRouter.get(
  "/ai",
  asyncHandler(async (_req, res) => {
    const provider = activeProvider();
    res.json({
      available: provider !== "none",
      model: modelLabel(provider),
      provider,
      disclaimer: MEDICAL_DISCLAIMER,
    });
  })
);

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

// ── POST /review : "what should I be working on?" ────────────────────────────
// Pro-gated AND metered: it is the most expensive call in the app (a reasoning
// model over a review brief), so it carries a burst limit, an entitlement and a
// daily quota rather than just one of the three.
healthRouter.post(
  "/review",
  aiLimiter,
  requireEntitlement("ai_medical"),
  aiQuota("medical_ai"),
  requireHealthConsent,
  asyncHandler(async (req, res) => {
    const userId = uid(req as AuthedRequest);
    const memory = await loadHealthMemory(userId);
    const review = await reviewHealth(memory);
    const reconciliation = reconcileIssues(memory.issues, review);
    await applyReview(userId, reconciliation, review.summary);

    res.json({
      summary: review.summary,
      model: review.model,
      created: reconciliation.create.length,
      updated: reconciliation.update.length,
      // Never applied automatically — the dashboard offers them as one-tap
      // confirmations, because closing an issue is the user's call.
      resolvedSuggestions: reconciliation.resolvedSuggestions,
      issues: await loadIssues(userId),
      disclaimer: MEDICAL_DISCLAIMER,
      // What the cloud model was given. Shown, like `model`, so the user can
      // see the minimisation rather than take it on trust.
      ...(review.disclosure ? { disclosure: review.disclosure } : {}),
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
    const memory = await loadHealthMemory(userId);
    const reply = await medicalChat(messages as ChatMessage[], memory);

    // Rules can accompany any reply type, so they are persisted once up front.
    const rules = await upsertAiRules(userId, reply.rules ?? []);
    const common = {
      urgent: reply.urgent,
      redFlags: reply.redFlags,
      model: reply.model,
      disclaimer: MEDICAL_DISCLAIMER,
      ...(rules.length ? { rules } : {}),
      ...(reply.disclosure ? { disclosure: reply.disclosure } : {}),
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
