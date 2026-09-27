// Direct Supabase access for everything that is plain CRUD on the user's own
// rows. This used to be the data API's job (server/src/routes/data.ts and
// routes/health.ts); talking to Postgres straight from the phone removes a
// hosted hop from every save, and keeps the app working when that service is
// asleep or unreachable. Row-level security is the access control — see
// supabase/migrations/native_client_access.sql for the policies and triggers
// that make that safe.
//
// Every query still filters on user_id explicitly. RLS would scope it anyway;
// the filter lets Postgres use the (user_id, …) indexes and keeps a query from
// quietly meaning "everything I'm allowed to see" if a policy ever widens.

import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { ApiError, AuthExpiredError } from "./errors";
import {
  applyMeasurement, healthProfileToRow, issuePatchToRow, keyBase, profileToRow, rowToExercise,
  rowToHealthEvent, rowToHealthIssue, rowToHealthProfile, rowToHealthRecord, rowToHealthRule, rowToNutritionPlan,
  rowToProfile, rowToProgram, rowToRoutine, rowToSubscription, rowToWorkout, rulePatchToRow,
  uniqueKey, workoutToRow, type Row, type WorkoutUpload,
} from "./mappers";
import { slugify } from "./exercises";
import type {
  Exercise, HealthIssue, HealthIssueEvent, HealthProfile, HealthRecord, HealthRule,
  NutritionPlan, Program, Routine, Subscription, UserProfile, WorkoutSession,
} from "./types";

// ── plumbing ────────────────────────────────────────────────────────────────

/** How much history a cold start pulls. Older sessions load on demand. */
export const BOOTSTRAP_HISTORY_DAYS = Number(import.meta.env.VITE_BOOTSTRAP_HISTORY_DAYS ?? 120) || 120;

// How much of the health record is held for the Medical tab — the same limits
// the server's memoryStore used for the overview.
const RECORDS_LIMIT = 200;
const EVENTS_PER_ISSUE = 20;

interface Result<T> {
  data: T | null;
  error: PostgrestError | null;
  status?: number;
}

/**
 * PostgREST errors → the error types the store already understands. An
 * expired/invalid JWT is PGRST301/PGRST303 (401); everything else keeps its
 * message, which here is the user's own data talking to the user.
 */
export function toApiError(error: PostgrestError, status?: number): ApiError {
  if (status === 401 || error.code === "PGRST301" || error.code === "PGRST303") {
    return new AuthExpiredError();
  }
  // fetch() failures surface as a PostgrestError with an empty code and the
  // TypeError/AbortError text as the message.
  if (!error.code && /fetch|network|abort|timed? ?out/i.test(error.message ?? "")) {
    return new ApiError("You're offline — try again when you have a connection.", 0, "network");
  }
  return new ApiError(error.message || "Database request failed", status ?? 500, error.code);
}

function unwrap<T>(res: Result<T>): T {
  if (res.error) throw toApiError(res.error, res.status);
  return res.data as T;
}

/**
 * The signed-in user's id. Without a session every RLS-scoped read would come
 * back empty rather than failing — and an empty profile looks exactly like a
 * brand-new account, which would bounce the user into onboarding. So a missing
 * session is an error here, never an empty result.
 */
async function requireUserId(): Promise<string> {
  const { data } = await supabase().auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new AuthExpiredError();
  return id;
}

const db = () => supabase();

// ── bootstrap ───────────────────────────────────────────────────────────────

export interface BootstrapData {
  profile: (UserProfile & { onboarded: boolean }) | null;
  program: Program | null;
  nutritionPlan: NutritionPlan | null;
  routines: Routine[];
  exercises: Exercise[];
  /** Recent sessions only — see `history` for the window that was applied. */
  workouts: WorkoutSession[];
  history: {
    windowDays: number;
    /** Epoch ms: sessions at or after this are authoritative in `workouts`. */
    windowStart: number;
    returned: number;
    total: number;
    hasMore: boolean;
  };
}

export async function bootstrap(historyDays = BOOTSTRAP_HISTORY_DAYS): Promise<BootstrapData> {
  const userId = await requireUserId();
  const windowStart = Date.now() - historyDays * 86_400_000;
  const since = new Date(windowStart).toISOString();

  const [profileRes, routinesRes, exercisesRes, workoutsRes, totalRes, programRes, nutritionRes] =
    await Promise.all([
      db().from("profiles").select("*").eq("user_id", userId).maybeSingle(),
      db().from("routines").select("*").eq("user_id", userId).order("position", { ascending: true }),
      db().from("exercises").select("*").eq("user_id", userId),
      db()
        .from("workouts")
        .select("*")
        .eq("user_id", userId)
        .gte("started_at", since)
        .order("started_at", { ascending: false }),
      db().from("workouts").select("id", { count: "exact", head: true }).eq("user_id", userId),
      db()
        .from("programs")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db()
        .from("nutrition_plans")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const profileRow = unwrap<Row | null>(profileRes);
  const routines = (unwrap<Row[]>(routinesRes) ?? []).map(rowToRoutine);
  const exercises = (unwrap<Row[]>(exercisesRes) ?? []).map(rowToExercise);
  const workouts = (unwrap<Row[]>(workoutsRes) ?? []).map(rowToWorkout);
  if (totalRes.error) throw toApiError(totalRes.error, totalRes.status);
  const total = totalRes.count ?? workouts.length;
  const programRow = unwrap<Row | null>(programRes);
  const nutritionRow = unwrap<Row | null>(nutritionRes);

  const aiRoutineIds = routines.filter((r) => r.source === "ai").map((r) => r.id);
  return {
    profile: profileRow ? rowToProfile(profileRow) : null,
    program: programRow ? rowToProgram(programRow, aiRoutineIds) : null,
    nutritionPlan: nutritionRow ? rowToNutritionPlan(nutritionRow) : null,
    routines,
    exercises,
    workouts,
    history: {
      windowDays: historyDays,
      windowStart,
      returned: workouts.length,
      total,
      hasMore: total > workouts.length,
    },
  };
}

export interface WorkoutPage {
  workouts: WorkoutSession[];
  hasMore: boolean;
}

/** Sessions older than `before` (epoch ms, exclusive), newest first. */
export async function workoutHistory(before?: number, limit = 100): Promise<WorkoutPage> {
  const userId = await requireUserId();
  const size = Math.max(1, Math.min(200, Math.floor(limit)));
  let query = db()
    .from("workouts")
    .select("*")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(size + 1);
  if (before) query = query.lt("started_at", new Date(before).toISOString());
  const rows = unwrap<Row[]>(await query) ?? [];
  return { workouts: rows.slice(0, size).map(rowToWorkout), hasMore: rows.length > size };
}

// ── profile & account ───────────────────────────────────────────────────────

export async function updateProfile(patch: Partial<UserProfile>) {
  const userId = await requireUserId();
  const row = unwrap<Row>(
    await db().from("profiles").upsert(profileToRow(userId, patch)).select().single()
  );
  return rowToProfile(row);
}

export async function updateAccountName(name: string): Promise<void> {
  const userId = await requireUserId();
  unwrap(await db().from("profiles").upsert({ user_id: userId, name }, { onConflict: "user_id" }));
}

/** Plan/status. Written only by the accounts service; readable by the owner. */
export async function getSubscription(): Promise<Subscription> {
  const userId = await requireUserId();
  const row = unwrap<Row | null>(
    await db()
      .from("subscriptions")
      .select("plan, status, current_period_end")
      .eq("user_id", userId)
      .maybeSingle()
  );
  return rowToSubscription(row);
}

// ── routines ────────────────────────────────────────────────────────────────

type RoutineInput = Omit<Routine, "id" | "createdAt" | "source">;

export async function createRoutine(routine: RoutineInput): Promise<Routine> {
  const userId = await requireUserId();
  const row = unwrap<Row>(
    await db()
      .from("routines")
      .insert({
        user_id: userId,
        name: routine.name,
        description: routine.description ?? null,
        day_label: routine.dayLabel ?? null,
        favorite: routine.favorite ?? false,
        source: "manual",
        position: 999,
        exercises: routine.exercises,
      })
      .select()
      .single()
  );
  return rowToRoutine(row);
}

export async function updateRoutine(id: string, patch: Partial<Routine>): Promise<Routine> {
  const userId = await requireUserId();
  const update: Row = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.dayLabel !== undefined) update.day_label = patch.dayLabel;
  if (patch.favorite !== undefined) update.favorite = patch.favorite;
  if (patch.exercises !== undefined) update.exercises = patch.exercises;
  const row = unwrap<Row>(
    await db().from("routines").update(update).eq("id", id).eq("user_id", userId).select().single()
  );
  return rowToRoutine(row);
}

export async function deleteRoutine(id: string): Promise<void> {
  const userId = await requireUserId();
  unwrap(await db().from("routines").delete().eq("id", id).eq("user_id", userId));
}

// ── exercises ───────────────────────────────────────────────────────────────

export async function createExercise(e: {
  name: string;
  muscleGroup: string;
  equipment: string;
}): Promise<Exercise> {
  const userId = await requireUserId();
  const row = unwrap<Row>(
    await db()
      .from("exercises")
      .upsert(
        {
          user_id: userId,
          slug: slugify(e.name),
          name: e.name,
          muscle_group: e.muscleGroup,
          equipment: e.equipment,
        },
        { onConflict: "user_id,slug" }
      )
      .select()
      .single()
  );
  return rowToExercise(row);
}

// ── workouts ────────────────────────────────────────────────────────────────

/** Upsert by (user_id, client_id), so offline-queued sessions sync idempotently. */
export async function saveWorkouts(list: WorkoutUpload | WorkoutUpload[]): Promise<WorkoutSession[]> {
  const userId = await requireUserId();
  const items = Array.isArray(list) ? list : [list];
  if (!items.length) return [];
  const rows = unwrap<Row[]>(
    await db()
      .from("workouts")
      .upsert(items.map((w) => workoutToRow(userId, w)), { onConflict: "user_id,client_id" })
      .select()
  );
  return (rows ?? []).map(rowToWorkout);
}

export async function deleteWorkout(id: string): Promise<void> {
  const userId = await requireUserId();
  unwrap(await db().from("workouts").delete().eq("id", id).eq("user_id", userId));
}

// ── health record ───────────────────────────────────────────────────────────
// The record goes phone ⇄ Postgres only. Nothing here reaches a model provider:
// that happens solely in the server's /health/chat and /health/review, behind
// the consent gate, and even then only as the privacy layer's brief.

export interface HealthRecordData {
  health: HealthProfile;
  issues: HealthIssue[];
  records: HealthRecord[];
  rules: HealthRule[];
}

export async function loadHealthRecord(): Promise<HealthRecordData> {
  const userId = await requireUserId();
  const [profileRes, issuesRes, eventsRes, recordsRes, rulesRes] = await Promise.all([
    db().from("health_profile").select("*").eq("user_id", userId).maybeSingle(),
    db().from("health_issues").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    db()
      .from("health_issue_events")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    db()
      .from("health_records")
      .select("*")
      .eq("user_id", userId)
      .order("occurred_at", { ascending: false })
      .limit(RECORDS_LIMIT),
    db().from("health_rules").select("*").eq("user_id", userId).order("updated_at", { ascending: false }),
  ]);

  // One query for every issue's recent events, grouped here — a query per
  // issue would be a round trip per card on the dashboard.
  const byIssue = new Map<string, Row[]>();
  for (const e of unwrap<Row[]>(eventsRes) ?? []) {
    const list = byIssue.get(e.issue_id) ?? [];
    if (list.length < EVENTS_PER_ISSUE) list.push(e);
    byIssue.set(e.issue_id, list);
  }

  return {
    health: rowToHealthProfile(unwrap<Row | null>(profileRes)),
    issues: (unwrap<Row[]>(issuesRes) ?? []).map((r) => rowToHealthIssue(r, byIssue.get(r.id) ?? [])),
    records: (unwrap<Row[]>(recordsRes) ?? []).map(rowToHealthRecord),
    rules: (unwrap<Row[]>(rulesRes) ?? []).map(rowToHealthRule),
  };
}

export async function updateHealthProfile(patch: Partial<HealthProfile>): Promise<HealthProfile> {
  const userId = await requireUserId();
  const row = unwrap<Row>(
    await db().from("health_profile").upsert(healthProfileToRow(userId, patch)).select().single()
  );
  return rowToHealthProfile(row);
}

/**
 * Opt in/out of sending health data to the medical model. This only records
 * the choice; the gate itself stays on the server, which refuses the AI routes
 * until `ai_consent_at` is set.
 */
export async function setHealthConsent(granted: boolean): Promise<HealthProfile> {
  const userId = await requireUserId();
  const now = new Date().toISOString();
  const row = unwrap<Row>(
    await db()
      .from("health_profile")
      .upsert({ user_id: userId, ai_consent_at: granted ? now : null, updated_at: now })
      .select()
      .single()
  );
  return rowToHealthProfile(row);
}

/** Existing keys that start with `base`, for picking a free one. */
async function takenKeys(table: "health_issues" | "health_rules", userId: string, base: string) {
  const rows = unwrap<Row[]>(
    await db().from(table).select("key").eq("user_id", userId).like("key", `${base}%`)
  );
  return (rows ?? []).map((r) => r.key as string);
}

const UNIQUE_VIOLATION = "23505";

/**
 * Insert with a fresh per-user key, retrying if another device took the same
 * key between our read and our write.
 */
async function insertWithKey(
  table: "health_issues" | "health_rules",
  userId: string,
  base: string,
  row: Row
): Promise<Row> {
  for (let attempt = 0; ; attempt++) {
    const key = uniqueKey(base, await takenKeys(table, userId, base));
    const res = await db().from(table).insert({ ...row, user_id: userId, key }).select().single();
    if (res.error?.code === UNIQUE_VIOLATION && attempt < 2) continue;
    return unwrap<Row>(res);
  }
}

export interface IssueInput {
  title: string;
  category?: HealthIssue["category"];
  severity?: HealthIssue["severity"];
  summary?: string;
  whyItMatters?: string;
  bodyRegion?: string;
  actionPlan?: HealthIssue["actionPlan"];
  metrics?: HealthIssue["metrics"];
  targetDate?: string;
  firstNoticedAt?: number;
}

export async function createHealthIssue(issue: IssueInput): Promise<HealthIssue> {
  const userId = await requireUserId();
  const title = issue.title.trim();
  if (!title) throw new ApiError("Give the issue a title.", 400);
  const row = await insertWithKey("health_issues", userId, keyBase(title, "issue"), {
    title,
    category: issue.category ?? "other",
    severity: issue.severity ?? "moderate",
    summary: issue.summary ?? null,
    why_it_matters: issue.whyItMatters ?? null,
    body_region: issue.bodyRegion ?? null,
    action_plan: issue.actionPlan ?? [],
    metrics: issue.metrics ?? [],
    target_date: issue.targetDate ?? null,
    first_noticed_at: issue.firstNoticedAt ? new Date(issue.firstNoticedAt).toISOString() : null,
    source: "user",
  });
  return rowToHealthIssue(row, []);
}

export async function updateHealthIssue(id: string, patch: Partial<HealthIssue>): Promise<HealthIssue> {
  const userId = await requireUserId();
  // The status_change timeline event is written by a database trigger, so a
  // status flip is recorded no matter which client made it.
  const row = unwrap<Row | null>(
    await db()
      .from("health_issues")
      .update(issuePatchToRow(patch))
      .eq("id", id)
      .eq("user_id", userId)
      .select()
      .maybeSingle()
  );
  if (!row) throw new ApiError("Issue not found", 404);
  return rowToHealthIssue(row, []);
}

export async function deleteHealthIssue(id: string): Promise<void> {
  const userId = await requireUserId();
  unwrap(await db().from("health_issues").delete().eq("id", id).eq("user_id", userId));
}

export interface IssueEventInput {
  kind?: HealthIssueEvent["kind"];
  body?: string;
  metric?: string;
  value?: number;
  unit?: string;
}

/** A check-in or measurement on an issue's timeline. */
export async function addIssueEvent(
  id: string,
  event: IssueEventInput
): Promise<{ event: HealthIssueEvent; issue: HealthIssue }> {
  const userId = await requireUserId();
  if (!event.body && event.value == null) {
    throw new ApiError("A check-in needs a note or a measurement.", 400);
  }
  const issue = unwrap<Row | null>(
    await db().from("health_issues").select("*").eq("id", id).eq("user_id", userId).maybeSingle()
  );
  if (!issue) throw new ApiError("Issue not found", 404);

  const saved = unwrap<Row>(
    await db()
      .from("health_issue_events")
      .insert({
        user_id: userId,
        issue_id: id,
        kind: event.kind ?? (event.value != null ? "measurement" : "check_in"),
        body: event.body ?? null,
        metric: event.metric ?? null,
        value: event.value ?? null,
        unit: event.unit ?? null,
      })
      .select()
      .single()
  );

  // Mirror a measurement onto the issue's metric so the dashboard can show the
  // latest reading without walking the whole event log.
  let updated = issue;
  if (event.metric && event.value != null) {
    const metrics = applyMeasurement(issue.metrics ?? [], event.metric, event.value);
    const res = await db()
      .from("health_issues")
      .update({ metrics, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", userId)
      .select()
      .maybeSingle();
    if (!res.error && res.data) updated = res.data;
  }
  return { event: rowToHealthEvent(saved), issue: rowToHealthIssue(updated, []) };
}

export interface RuleInput {
  subject: string;
  domain?: HealthRule["domain"];
  direction?: HealthRule["direction"];
  detail?: string;
  reason?: string;
  issueId?: string;
}

export async function createHealthRule(rule: RuleInput): Promise<HealthRule> {
  const userId = await requireUserId();
  const subject = rule.subject.trim();
  if (!subject) throw new ApiError("Say what the rule is about.", 400);
  const row = await insertWithKey("health_rules", userId, keyBase(subject, "rule"), {
    subject,
    domain: rule.domain ?? "lifestyle",
    direction: rule.direction ?? "less",
    detail: rule.detail ?? null,
    reason: rule.reason ?? null,
    issue_id: rule.issueId ?? null,
    source: "user",
    user_edited: true,
  });
  return rowToHealthRule(row);
}

export async function updateHealthRule(id: string, patch: Partial<HealthRule>): Promise<HealthRule> {
  const userId = await requireUserId();
  const row = unwrap<Row | null>(
    await db()
      .from("health_rules")
      .update(rulePatchToRow(patch))
      .eq("id", id)
      .eq("user_id", userId)
      .select()
      .maybeSingle()
  );
  if (!row) throw new ApiError("Rule not found", 404);
  return rowToHealthRule(row);
}

export async function deleteHealthRule(id: string): Promise<void> {
  const userId = await requireUserId();
  unwrap(await db().from("health_rules").delete().eq("id", id).eq("user_id", userId));
}

export interface RecordInput {
  kind?: HealthRecord["kind"];
  title: string;
  detail?: string;
  occurredAt?: number;
  issueId?: string;
  data?: Record<string, unknown>;
}

export async function createHealthRecord(record: RecordInput): Promise<HealthRecord> {
  const userId = await requireUserId();
  const title = record.title.trim();
  if (!title) throw new ApiError("Give the entry a title.", 400);
  const row = unwrap<Row>(
    await db()
      .from("health_records")
      .insert({
        user_id: userId,
        issue_id: record.issueId ?? null,
        kind: record.kind ?? "note",
        title,
        detail: record.detail ?? null,
        occurred_at: new Date(record.occurredAt ?? Date.now()).toISOString(),
        data: record.data ?? {},
        source: "user",
      })
      .select()
      .single()
  );
  return rowToHealthRecord(row);
}

export async function deleteHealthRecord(id: string): Promise<void> {
  const userId = await requireUserId();
  unwrap(await db().from("health_records").delete().eq("id", id).eq("user_id", userId));
}
