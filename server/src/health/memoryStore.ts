// Layer 1 — Health memory, persistence side: every read and write of the
// medical tables goes through here.
//
// The loaders assemble the whole record into a `HealthMemory` for one request.
// Nothing in this file talks to a model — whatever is loaded here stays on the
// server unless the privacy layer puts a piece of it into a cloud brief.

import { supabaseAdmin } from "../supabase";
import { HttpError } from "../middleware";
import { buildRefreshSummary, SessionLite } from "../analytics";
import {
  emptyHealthProfile, rowToHealthIssue, rowToHealthProfile, rowToHealthRecord, rowToHealthRule,
  rowToNutritionPlan, rowToProfile,
} from "../mappers";
import { reconcileIssues, type HealthMemory, type IssueReconciliation } from "./memory";
import type { AIHealthRecordDraft } from "./safety";
import type {
  AIHealthIssue, AIHealthRule, HealthIssue, HealthProfile, HealthRule, UserProfile,
} from "../types";

// How much of the record is held in local memory for one request. This is what
// the local layers (trends, relevance search) reason over — it is NOT what the
// cloud model sees, which is a much smaller, relevance-filtered brief built by
// privacy.ts. So it can be generous: a lab from two years ago is findable when
// the question is about it, without that lab riding along on every other one.
const RECORDS_IN_MEMORY = 200;
// Readings per issue — enough history for the anatomy layer to compute a trend.
const EVENTS_PER_ISSUE = 20;

export async function loadHealthProfile(userId: string): Promise<HealthProfile> {
  const { data } = await supabaseAdmin
    .from("health_profile").select("*").eq("user_id", userId).maybeSingle();
  return data ? rowToHealthProfile(data) : emptyHealthProfile();
}

export async function loadIssues(userId: string): Promise<HealthIssue[]> {
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

export async function loadRules(userId: string): Promise<HealthRule[]> {
  const { data, error } = await supabaseAdmin
    .from("health_rules").select("*").eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToHealthRule);
}

export async function loadRecords(userId: string, limit = RECORDS_IN_MEMORY) {
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

/** The whole record, held in local memory for one request. */
export async function loadHealthMemory(userId: string): Promise<HealthMemory> {
  const [profile, health, issues, records, rules, nutritionPlan] = await Promise.all([
    loadTrainingProfile(userId),
    loadHealthProfile(userId),
    loadIssues(userId),
    loadRecords(userId),
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

// ── Writes from the reasoning layer ──────────────────────────────────────────

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

/** The AI-writable columns of an existing issue — never status or progress. */
function patchToRow(patch: Partial<HealthIssue>) {
  return {
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
  };
}

/**
 * Upserts an AI-proposed issue, preserving the user-owned fields of an issue
 * that already exists under the same key (see reconcileIssues). Used by the chat
 * path, where there is exactly one proposal rather than a whole review.
 */
export async function upsertAiIssue(userId: string, proposal: AIHealthIssue): Promise<HealthIssue> {
  const existing = await loadIssues(userId);
  const { create, update } = reconcileIssues(existing, {
    summary: "",
    issues: [proposal],
    resolvedKeys: [],
  });

  if (update.length) {
    const { data, error } = await supabaseAdmin
      .from("health_issues")
      .update(patchToRow(update[0].patch))
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

/** Writes a reconciled review: new issues, AI-owned field updates, the summary. */
export async function applyReview(
  userId: string,
  { create, update }: IssueReconciliation,
  summary: string
): Promise<void> {
  if (create.length) {
    const { error } = await supabaseAdmin
      .from("health_issues")
      .upsert(create.map((i) => issueToRow(userId, i)), { onConflict: "user_id,key" });
    if (error) throw new Error(error.message);
  }
  for (const u of update) {
    const { error } = await supabaseAdmin
      .from("health_issues")
      .update(patchToRow(u.patch))
      .eq("id", u.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
  }

  await supabaseAdmin.from("health_profile").upsert({
    user_id: userId,
    last_review_at: new Date().toISOString(),
    last_review_summary: summary,
    updated_at: new Date().toISOString(),
  });
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
export async function upsertAiRules(userId: string, proposals: AIHealthRule[]): Promise<HealthRule[]> {
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

export async function insertAiRecord(userId: string, draft: AIHealthRecordDraft) {
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
