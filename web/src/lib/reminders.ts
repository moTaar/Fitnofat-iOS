// Turns app state into the set of reminders that should be pending on the
// phone. Pure, so it can be tested without a device; NativeBridge feeds the
// result to syncReminders() whenever an input changes.

import type { Routine, UserProfile, WorkoutSession } from "./types";
import {
  defaultReminderDays, planHealthCheckin, planTrainingReminders, sameLocalDay,
  type PlannedNotification,
} from "./notifications";

export interface ReminderSettings {
  remindersEnabled: boolean;
  reminderDays: number[] | null;
  reminderTime: string;
  healthCheckinReminder: boolean;
}

/** The AI routine next in rotation — the same pick the Dashboard shows. */
export function nextRoutineFor(routines: Routine[], history: WorkoutSession[]): Routine | undefined {
  const ai = routines.filter((r) => r.source === "ai");
  return ai.length ? ai[history.length % ai.length] : undefined;
}

export function effectiveReminderDays(settings: ReminderSettings, profile: UserProfile | null): number[] {
  return settings.reminderDays?.length ? settings.reminderDays : defaultReminderDays(profile?.daysPerWeek);
}

export function buildReminderPlan(
  state: {
    settings: ReminderSettings;
    profile: UserProfile | null;
    routines: Routine[];
    history: WorkoutSession[];
  },
  now = new Date()
): PlannedNotification[] {
  const plan: PlannedNotification[] = [];
  if (state.settings.remindersEnabled) {
    const next = nextRoutineFor(state.routines, state.history);
    plan.push(
      ...planTrainingReminders({
        days: effectiveReminderDays(state.settings, state.profile),
        time: state.settings.reminderTime,
        now,
        trainedToday: state.history.some((w) => sameLocalDay(w.startedAt, now)),
        nextRoutine: next ? { name: next.name, exerciseCount: next.exercises.length } : undefined,
      })
    );
  }
  if (state.settings.healthCheckinReminder) {
    plan.push(planHealthCheckin(now, state.settings.reminderTime));
  }
  return plan;
}
