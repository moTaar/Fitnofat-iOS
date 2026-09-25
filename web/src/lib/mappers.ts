// Postgres rows ⇄ the client's domain types.
//
// A port of server/src/mappers.ts: now that the app reads and writes Supabase
// directly, the snake_case ↔ camelCase mapping the data API used to do happens
// here instead. Keep the two in step — the server still writes these same rows
// from its AI routes, and a field one side maps and the other drops would be
// silently lost on the next round trip.

import type {
  ActionStep, Exercise, HealthIssue, HealthIssueEvent, HealthProfile, HealthRecord, HealthRule,
  IssueMetric, NutritionPlan, Program, Routine, RoutineExercise, Subscription, UserProfile,
  WorkoutSession,
} from "./types";

// Rows come back untyped from PostgREST; each mapper is the one place that
// decides what a column means.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

const ms = (v: string | null | undefined): number => (v ? new Date(v).getTime() : Date.now());
const iso = (epochMs: number) => new Date(epochMs).toISOString();
const num = (v: unknown): number | undefined => (v == null ? undefined : Number(v));

// ── profiles ──────────────────────────────────────────────────────────────
export function rowToProfile(row: Row): UserProfile & { onboarded: boolean } {
  return {
    name: row.name ?? "",
    goal: row.goal,
    equipment: row.equipment,
    equipmentMix: row.equipment_mix ?? undefined,
    equipmentPrefs: row.equipment_prefs ?? undefined,
    experience: row.experience,
    category: row.category ?? "mixed",
    daysPerWeek: row.days_per_week,
    sessionMinutes: row.session_minutes,
    bodyweightKg: num(row.bodyweight_kg),
    units: row.units,
    notes: row.notes ?? "",
    onboarded: !!row.onboarded,
    heightCm: num(row.height_cm),
    age: row.age ?? undefined,
    sex: row.sex ?? undefined,
    activityLevel: row.activity_level ?? undefined,
    dietGoal: row.diet_goal ?? undefined,
    dietRestrictions: row.diet_restrictions ?? undefined,
    cuisine: row.cuisine ?? undefined,
  };
}

export function profileToRow(userId: string, p: Partial<UserProfile> & { onboarded?: boolean }): Row {
  const row: Row = { user_id: userId, updated_at: new Date().toISOString() };
  if (p.name !== undefined) row.name = p.name;
  if (p.goal !== undefined) row.goal = p.goal;
  if (p.equipment !== undefined) row.equipment = p.equipment;
  if (p.equipmentMix !== undefined) row.equipment_mix = p.equipmentMix;
  if (p.equipmentPrefs !== undefined) row.equipment_prefs = p.equipmentPrefs;
  if (p.experience !== undefined) row.experience = p.experience;
  if (p.category !== undefined) row.category = p.category;
  if (p.daysPerWeek !== undefined) row.days_per_week = p.daysPerWeek;
  if (p.sessionMinutes !== undefined) row.session_minutes = p.sessionMinutes;
  if (p.bodyweightKg !== undefined) row.bodyweight_kg = p.bodyweightKg;
  if (p.units !== undefined) row.units = p.units;
  if (p.notes !== undefined) row.notes = p.notes;
  if (p.onboarded !== undefined) row.onboarded = p.onboarded;
  if (p.heightCm !== undefined) row.height_cm = p.heightCm;
  if (p.age !== undefined) row.age = p.age;
  if (p.sex !== undefined) row.sex = p.sex;
  if (p.activityLevel !== undefined) row.activity_level = p.activityLevel;
  if (p.dietGoal !== undefined) row.diet_goal = p.dietGoal;
  if (p.dietRestrictions !== undefined) row.diet_restrictions = p.dietRestrictions;
  if (p.cuisine !== undefined) row.cuisine = p.cuisine;
  return row;
}

// ── nutrition plans ─────────────────────────────────────────────────────────
export function rowToNutritionPlan(row: Row): NutritionPlan {
  const plan = row.plan ?? {};
  return {
    id: row.id,
    iteration: row.iteration,
    strategy: row.strategy ?? plan.strategy ?? "",
    summary: row.summary ?? plan.summary ?? "",
    trainingDay: plan.trainingDay,
    restDay: plan.restDay,
    createdAt: ms(row.created_at),
  };
}

// ── programs ──────────────────────────────────────────────────────────────
export function rowToProgram(row: Row, routineIds: string[]): Program {
  return {
    id: row.id,
    name: row.name,
    weeks: row.weeks,
    goal: row.goal,
    iteration: row.iteration,
    summary: row.summary ?? "",
    createdAt: ms(row.created_at),
    routineIds,
  };
}

// ── routines ──────────────────────────────────────────────────────────────
export function rowToRoutine(row: Row): Routine {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    dayLabel: row.day_label ?? undefined,
    source: row.source,
    favorite: !!row.favorite,
    exercises: (row.exercises ?? []) as RoutineExercise[],
    createdAt: ms(row.created_at),
  };
}

// ── workouts ──────────────────────────────────────────────────────────────
export function rowToWorkout(row: Row): WorkoutSession {
  return {
    id: row.id,
    clientId: row.client_id ?? undefined,
    routineId: row.routine_id ?? undefined,
    routineName: row.routine_name,
    startedAt: ms(row.started_at),
    endedAt: row.ended_at ? ms(row.ended_at) : undefined,
    durationSec: row.duration_sec,
    totalVolume: Number(row.total_volume),
    calories: num(row.calories),
    exercises: row.exercises ?? [],
    notes: row.notes ?? undefined,
    synced: true,
  };
}

/** The shape the store queues for sync (see workoutToApi in store.ts). */
export interface WorkoutUpload {
  clientId: string;
  routineId?: string | null;
  routineName: string;
  startedAt: number;
  endedAt?: number;
  durationSec: number;
  totalVolume: number;
  calories?: number;
  notes?: string;
  exercises: unknown[];
}

// Routine ids are uuids server-side; a routine that only ever existed locally
// (or a seed id) can't be stored in the uuid column, so it is dropped rather
// than failing the whole sync batch.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function workoutToRow(userId: string, w: WorkoutUpload): Row {
  return {
    user_id: userId,
    client_id: w.clientId,
    routine_id: w.routineId && UUID.test(w.routineId) ? w.routineId : null,
    routine_name: w.routineName,
    started_at: iso(w.startedAt),
    ended_at: w.endedAt ? iso(w.endedAt) : null,
    duration_sec: Math.round(w.durationSec),
    total_volume: w.totalVolume,
    calories: w.calories ?? 0,
    notes: w.notes ?? null,
    exercises: w.exercises,
  };
}

// ── exercises (custom) ──────────────────────────────────────────────────────
export function rowToExercise(row: Row): Exercise {
  return {
    id: row.slug,
    name: row.name,
    muscleGroup: row.muscle_group,
    equipment: row.equipment,
    isCustom: row.source !== "ai",
    guide: row.guide ?? undefined,
    met: num(row.met),
    videoId: row.video_id ?? undefined,
  };
}

// ── subscriptions ───────────────────────────────────────────────────────────
export function rowToSubscription(row: Row | null): Subscription {
  return {
    plan: row?.plan ?? "free",
    status: row?.status ?? "inactive",
    currentPeriodEnd: row?.current_period_end ?? null,
  };
}

// ── health / medical ────────────────────────────────────────────────────────
export function emptyHealthProfile(): HealthProfile {
  return { conditions: [], allergies: [], medications: [], surgeries: [], familyHistory: [] };
}

export function rowToHealthProfile(row: Row | null): HealthProfile {
  if (!row) return emptyHealthProfile();
  return {
    aiConsentAt: row.ai_consent_at ? ms(row.ai_consent_at) : undefined,
    conditions: row.conditions ?? [],
    allergies: row.allergies ?? [],
    medications: row.medications ?? [],
    surgeries: row.surgeries ?? [],
    familyHistory: row.family_history ?? [],
    bloodType: row.blood_type ?? undefined,
    smoking: row.smoking ?? undefined,
    alcohol: row.alcohol ?? undefined,
    sleepHours: num(row.sleep_hours),
    stressLevel: row.stress_level ?? undefined,
    notes: row.notes ?? undefined,
    lastReviewAt: row.last_review_at ? ms(row.last_review_at) : undefined,
    lastReviewSummary: row.last_review_summary ?? undefined,
  };
}

export function healthProfileToRow(userId: string, p: Partial<HealthProfile>): Row {
  const row: Row = { user_id: userId, updated_at: new Date().toISOString() };
  if (p.conditions !== undefined) row.conditions = p.conditions;
  if (p.allergies !== undefined) row.allergies = p.allergies;
  if (p.medications !== undefined) row.medications = p.medications;
  if (p.surgeries !== undefined) row.surgeries = p.surgeries;
  if (p.familyHistory !== undefined) row.family_history = p.familyHistory;
  if (p.bloodType !== undefined) row.blood_type = p.bloodType;
  if (p.smoking !== undefined) row.smoking = p.smoking;
  if (p.alcohol !== undefined) row.alcohol = p.alcohol;
  if (p.sleepHours !== undefined) row.sleep_hours = p.sleepHours;
  if (p.stressLevel !== undefined) row.stress_level = p.stressLevel;
  if (p.notes !== undefined) row.notes = p.notes;
  return row;
}

export function rowToHealthEvent(row: Row): HealthIssueEvent {
  return {
    id: row.id,
    issueId: row.issue_id,
    kind: row.kind,
    body: row.body ?? undefined,
    metric: row.metric ?? undefined,
    value: num(row.value),
    unit: row.unit ?? undefined,
    createdAt: ms(row.created_at),
  };
}

export function rowToHealthIssue(row: Row, events?: Row[]): HealthIssue {
  return {
    id: row.id,
    key: row.key,
    title: row.title,
    category: row.category,
    status: row.status,
    severity: row.severity,
    progress: Number(row.progress ?? 0),
    bodyRegion: row.body_region ?? undefined,
    summary: row.summary ?? undefined,
    whyItMatters: row.why_it_matters ?? undefined,
    actionPlan: (row.action_plan ?? []) as ActionStep[],
    metrics: (row.metrics ?? []) as IssueMetric[],
    redFlags: (row.red_flags ?? []) as string[],
    source: row.source,
    confidence: row.confidence ?? undefined,
    firstNoticedAt: row.first_noticed_at ? ms(row.first_noticed_at) : undefined,
    targetDate: row.target_date ?? undefined,
    resolvedAt: row.resolved_at ? ms(row.resolved_at) : undefined,
    lastReviewedAt: row.last_reviewed_at ? ms(row.last_reviewed_at) : undefined,
    createdAt: ms(row.created_at),
    updatedAt: ms(row.updated_at),
    ...(events ? { events: events.map(rowToHealthEvent) } : {}),
  };
}

/** The user-editable columns of an issue. `resolved_at` follows `status`. */
export function issuePatchToRow(patch: Partial<HealthIssue>): Row {
  const row: Row = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.category !== undefined) row.category = patch.category;
  if (patch.severity !== undefined) row.severity = patch.severity;
  if (patch.summary !== undefined) row.summary = patch.summary;
  if (patch.whyItMatters !== undefined) row.why_it_matters = patch.whyItMatters;
  if (patch.bodyRegion !== undefined) row.body_region = patch.bodyRegion;
  if (patch.actionPlan !== undefined) row.action_plan = patch.actionPlan;
  if (patch.metrics !== undefined) row.metrics = patch.metrics;
  if (patch.targetDate !== undefined) row.target_date = patch.targetDate;
  if (patch.progress !== undefined) row.progress = Math.max(0, Math.min(100, Math.round(patch.progress)));
  if (patch.status !== undefined) {
    row.status = patch.status;
    // Resolving stamps the date; reopening clears it. The database trigger does
    // the same — this keeps the returned row right even before it is applied.
    row.resolved_at = patch.status === "resolved" ? new Date().toISOString() : null;
  }
  return row;
}

export function rowToHealthRecord(row: Row): HealthRecord {
  return {
    id: row.id,
    issueId: row.issue_id ?? undefined,
    kind: row.kind,
    title: row.title,
    detail: row.detail ?? undefined,
    occurredAt: ms(row.occurred_at),
    data: row.data ?? {},
    source: row.source,
    createdAt: ms(row.created_at),
  };
}

export function rowToHealthRule(row: Row): HealthRule {
  return {
    id: row.id,
    issueId: row.issue_id ?? undefined,
    key: row.key,
    domain: row.domain,
    direction: row.direction,
    subject: row.subject,
    detail: row.detail ?? undefined,
    reason: row.reason ?? undefined,
    status: row.status,
    source: row.source,
    confidence: row.confidence ?? undefined,
    userEdited: !!row.user_edited,
    createdAt: ms(row.created_at),
    updatedAt: ms(row.updated_at),
  };
}

/**
 * The user-editable columns of a rule. Any edit hands the rule to the user —
 * `user_edited` is what stops a later AI turn from rewriting it (see
 * upsertAiRules in the server). The database trigger sets it too, so the
 * guarantee doesn't depend on this client remembering.
 */
export function rulePatchToRow(patch: Partial<HealthRule>): Row {
  const row: Row = { updated_at: new Date().toISOString(), user_edited: true };
  if (patch.subject !== undefined) row.subject = patch.subject;
  if (patch.domain !== undefined) row.domain = patch.domain;
  if (patch.direction !== undefined) row.direction = patch.direction;
  if (patch.detail !== undefined) row.detail = patch.detail;
  if (patch.reason !== undefined) row.reason = patch.reason;
  if (patch.status !== undefined) row.status = patch.status;
  return row;
}

// ── keys ────────────────────────────────────────────────────────────────────

/** Slug base for a user-created issue/rule key. */
export function keyBase(text: string, fallback: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
}

/**
 * First free key for `base`: `base`, then `base-2`, `base-3`… The key is unique
 * per user and is what lets the AI update an entry instead of duplicating it.
 */
export function uniqueKey(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let key = base;
  for (let n = 2; used.has(key); n++) key = `${base}-${n}`;
  return key;
}

/** Mirror a measurement onto the matching metric so the card shows the latest reading. */
export function applyMeasurement(
  metrics: IssueMetric[],
  metric: string,
  value: number,
  at = Date.now()
): IssueMetric[] {
  const target = metric.trim().toLowerCase();
  return metrics.map((m) =>
    m.label.trim().toLowerCase() === target ? { ...m, latest: value, latestAt: at } : m
  );
}
