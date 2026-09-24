// Layer 1 — Health memory: the longitudinal health record, and who owns what in it.
//
// The record lives in Postgres (owner-RLS tables, see supabase/migrations/
// add_medical.sql); `memoryStore.ts` is the only code that reads or writes it.
// For one request, the store assembles the WHOLE record into a `HealthMemory`
// in process memory. That is "local memory": the local-processing layers
// (anatomy, privacy) may use every bit of it, because none of it leaves the
// server. What does leave is decided by the privacy layer, never here.
//
// This file stays pure (no database import) so the ownership rules below are
// unit-tested without a Supabase client.

import type {
  ActionStep,
  AIHealthReview,
  HealthIssue,
  HealthProfile,
  HealthRecord,
  HealthRule,
  IssueMetric,
  NutritionPlan,
  UserProfile,
} from "../types";

/** One person's health record, as held in memory for the length of a request. */
export interface HealthMemory {
  profile: UserProfile;
  health: HealthProfile;
  /** Every tracked issue, open and closed, each with its recent events. */
  issues: HealthIssue[];
  /** Medical history, newest first. The full local window, not a model-sized slice. */
  records: HealthRecord[];
  /** Standing do/don't rules. */
  rules?: HealthRule[];
  nutritionPlan?: NutritionPlan | null;
  /** Pre-built training digest, same string the training coach gets. */
  trainingContext?: string;
}

// ── Ownership: what a model may change ───────────────────────────────────────
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
  create: AIHealthReview["issues"];
  update: { id: string; key: string; patch: Partial<HealthIssue> }[];
  /** Tracked, still-open keys the model believes are done. Surfaced, not applied. */
  resolvedSuggestions: string[];
}

export const CLOSED_STATUSES = new Set(["resolved", "dismissed"]);

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
  const create: IssueReconciliation["create"] = [];
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
