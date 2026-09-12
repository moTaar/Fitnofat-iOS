import { slugify } from "./util";
import type {
  ActionStep,
  AIProgramResponse,
  HealthIssue,
  HealthIssueEvent,
  HealthProfile,
  HealthRecord,
  IssueMetric,
  NutritionPlan,
  RoutineExercise,
  UserProfile,
} from "./types";

const ms = (v: string | null | undefined): number =>
  v ? new Date(v).getTime() : Date.now();

// ── profiles ──────────────────────────────────────────────────────────────
export function rowToProfile(row: any): UserProfile & { onboarded: boolean } {
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
    bodyweightKg: row.bodyweight_kg ?? undefined,
    units: row.units,
    notes: row.notes ?? "",
    onboarded: row.onboarded,
    heightCm: row.height_cm ?? undefined,
    age: row.age ?? undefined,
    sex: row.sex ?? undefined,
    activityLevel: row.activity_level ?? undefined,
    dietGoal: row.diet_goal ?? undefined,
    dietRestrictions: row.diet_restrictions ?? undefined,
    cuisine: row.cuisine ?? undefined,
  };
}

export function profileToRow(userId: string, p: Partial<UserProfile> & { onboarded?: boolean }) {
  const row: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() };
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
export function rowToNutritionPlan(row: any): NutritionPlan {
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
export function rowToProgram(row: any, routineIds: string[]) {
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
export function rowToRoutine(row: any) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    dayLabel: row.day_label ?? undefined,
    source: row.source,
    favorite: row.favorite,
    exercises: (row.exercises ?? []) as RoutineExercise[],
    createdAt: ms(row.created_at),
  };
}

// ── workouts ──────────────────────────────────────────────────────────────
export function rowToWorkout(row: any) {
  return {
    id: row.id,
    clientId: row.client_id ?? undefined,
    routineId: row.routine_id ?? undefined,
    routineName: row.routine_name,
    startedAt: ms(row.started_at),
    endedAt: row.ended_at ? ms(row.ended_at) : undefined,
    durationSec: row.duration_sec,
    totalVolume: Number(row.total_volume),
    calories: row.calories != null ? Number(row.calories) : undefined,
    exercises: row.exercises ?? [],
    notes: row.notes ?? undefined,
    synced: true,
  };
}

// ── exercises (custom) ──────────────────────────────────────────────────────
export function rowToExercise(row: any) {
  return {
    id: row.slug,
    name: row.name,
    muscleGroup: row.muscle_group,
    equipment: row.equipment,
    isCustom: row.source !== "ai",
    guide: row.guide ?? undefined,
    met: row.met != null ? Number(row.met) : undefined,
  };
}

// ── AI response → routine insert rows ─────────────────────────────────────────
export function aiRoutinesToRows(
  userId: string,
  programId: string,
  ai: AIProgramResponse
) {
  return ai.routines.map((r, idx) => {
    const exercises: RoutineExercise[] = r.exercises.map((e) => ({
      exerciseId: slugify(e.name),
      name: e.name,
      muscleGroup: e.muscleGroup,
      restSeconds: e.restSeconds,
      notes: e.notes,
      sets: e.sets.map((s) => ({
        targetReps: s.reps,
        targetWeight: s.weight,
        rpe: s.rpe,
      })),
    }));
    return {
      user_id: userId,
      program_id: programId,
      name: r.name,
      description: r.description ?? null,
      day_label: r.dayLabel,
      source: "ai",
      favorite: false,
      position: idx,
      exercises,
    };
  });
}

// ── health / medical ────────────────────────────────────────────────────────
export function rowToHealthProfile(row: any): HealthProfile {
  return {
    aiConsentAt: row?.ai_consent_at ? ms(row.ai_consent_at) : undefined,
    conditions: row?.conditions ?? [],
    allergies: row?.allergies ?? [],
    medications: row?.medications ?? [],
    surgeries: row?.surgeries ?? [],
    familyHistory: row?.family_history ?? [],
    bloodType: row?.blood_type ?? undefined,
    smoking: row?.smoking ?? undefined,
    alcohol: row?.alcohol ?? undefined,
    sleepHours: row?.sleep_hours != null ? Number(row.sleep_hours) : undefined,
    stressLevel: row?.stress_level ?? undefined,
    notes: row?.notes ?? undefined,
    lastReviewAt: row?.last_review_at ? ms(row.last_review_at) : undefined,
    lastReviewSummary: row?.last_review_summary ?? undefined,
  };
}

/**
 * Empty background for a user who hasn't filled anything in yet. A function,
 * not a constant: a shared constant would hand every caller the same array
 * instances.
 */
export function emptyHealthProfile(): HealthProfile {
  return {
    conditions: [],
    allergies: [],
    medications: [],
    surgeries: [],
    familyHistory: [],
  };
}

export function healthProfileToRow(userId: string, p: Partial<HealthProfile>) {
  const row: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() };
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

export function rowToHealthIssue(row: any, events?: any[]): HealthIssue {
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

export function rowToHealthEvent(row: any): HealthIssueEvent {
  return {
    id: row.id,
    issueId: row.issue_id,
    kind: row.kind,
    body: row.body ?? undefined,
    metric: row.metric ?? undefined,
    value: row.value != null ? Number(row.value) : undefined,
    unit: row.unit ?? undefined,
    createdAt: ms(row.created_at),
  };
}

export function rowToHealthRecord(row: any): HealthRecord {
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
