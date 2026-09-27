import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_IDS, defaultReminderDays, describeReminderDays, parseTime, planHealthCheckin,
  planTrainingReminders, restDoneBody, sameLocalDay,
} from "./notifications";
import { buildReminderPlan, nextRoutineFor } from "./reminders";
import type { Routine, WorkoutSession } from "./types";

// Wednesday 10 Sept 2025, 09:00 local.
const WED_9AM = new Date(2025, 8, 10, 9, 0, 0);

const routine = (id: string, name: string, n = 5): Routine => ({
  id,
  name,
  source: "ai",
  createdAt: 0,
  exercises: Array.from({ length: n }, (_, i) => ({
    exerciseId: `e${i}`,
    name: `E${i}`,
    muscleGroup: "Chest",
    sets: [],
    restSeconds: 60,
  })),
});

const session = (startedAt: number): WorkoutSession => ({
  id: String(startedAt),
  routineName: "x",
  startedAt,
  durationSec: 0,
  exercises: [],
  totalVolume: 0,
  synced: true,
});

describe("parseTime", () => {
  it("parses HH:mm and falls back to 18:00", () => {
    expect(parseTime("07:05")).toEqual({ h: 7, m: 5 });
    expect(parseTime("7:30")).toEqual({ h: 7, m: 30 });
    expect(parseTime("25:00")).toEqual({ h: 18, m: 0 });
    expect(parseTime("nope")).toEqual({ h: 18, m: 0 });
    expect(parseTime(undefined)).toEqual({ h: 18, m: 0 });
  });
});

describe("defaultReminderDays", () => {
  it("spreads sessions across the week and clamps out-of-range input", () => {
    expect(defaultReminderDays(3)).toEqual([1, 3, 5]);
    expect(defaultReminderDays(0)).toEqual([1]);
    expect(defaultReminderDays(12)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(defaultReminderDays(undefined)).toEqual([1, 3, 5]);
  });
});

describe("describeReminderDays", () => {
  it("reads Monday-first", () => {
    expect(describeReminderDays([5, 1, 3], "18:00")).toBe("Mon, Wed & Fri at 18:00");
    expect(describeReminderDays([0, 6], "7:5")).toBe("Sat & Sun at 18:00");
    expect(describeReminderDays([0, 1, 2, 3, 4, 5, 6], "06:30")).toBe("Every day at 06:30");
  });
});

describe("planTrainingReminders", () => {
  it("schedules only chosen weekdays, at the chosen time, within the horizon", () => {
    const plan = planTrainingReminders({ days: [1, 3, 5], time: "18:00", now: WED_9AM, trainedToday: false });
    expect(plan.length).toBeGreaterThan(0);
    for (const n of plan) {
      expect([1, 3, 5]).toContain(n.at.getDay());
      expect(n.at.getHours()).toBe(18);
      expect(n.at.getMinutes()).toBe(0);
      expect(n.id).toBeGreaterThanOrEqual(NOTIFICATION_IDS.trainingBase);
      expect(n.id).toBeLessThan(NOTIFICATION_IDS.trainingBase + NOTIFICATION_IDS.trainingHorizonDays);
    }
    // Today (Wed) 18:00 is still ahead, so it's first.
    expect(sameLocalDay(plan[0].at, WED_9AM)).toBe(true);
    // 21 days from a Wednesday cover 9 Mon/Wed/Fri slots.
    expect(plan).toHaveLength(9);
  });

  it("drops today's reminder once today's session is logged", () => {
    const plan = planTrainingReminders({ days: [3], time: "18:00", now: WED_9AM, trainedToday: true });
    expect(plan.every((n) => !sameLocalDay(n.at, WED_9AM))).toBe(true);
  });

  it("never schedules in the past", () => {
    const evening = new Date(2025, 8, 10, 19, 0, 0);
    const plan = planTrainingReminders({ days: [3], time: "18:00", now: evening, trainedToday: false });
    expect(plan.every((n) => n.at.getTime() > evening.getTime())).toBe(true);
    expect(sameLocalDay(plan[0].at, new Date(2025, 8, 17))).toBe(true);
  });

  it("names the next session when there is one", () => {
    const [n] = planTrainingReminders({
      days: [3],
      time: "18:00",
      now: WED_9AM,
      trainedToday: false,
      nextRoutine: { name: "Push A", exerciseCount: 1 },
    });
    expect(n.body).toBe("Push A is up next — 1 exercise. Tap to start.");
    expect(n.route).toBe("/");
  });

  it("gives every planned reminder a distinct id", () => {
    const plan = planTrainingReminders({ days: [0, 1, 2, 3, 4, 5, 6], time: "18:00", now: WED_9AM, trainedToday: false });
    expect(new Set(plan.map((n) => n.id)).size).toBe(plan.length);
  });
});

describe("planHealthCheckin", () => {
  it("lands on the next Sunday at the reminder time", () => {
    const n = planHealthCheckin(WED_9AM, "18:00");
    expect(n.at.getDay()).toBe(0);
    expect(n.at.getHours()).toBe(18);
    expect(n.at.getTime()).toBeGreaterThan(WED_9AM.getTime());
    expect(n.route).toBe("/health");
  });

  it("rolls a week forward once this week's slot has passed", () => {
    const sundayNight = new Date(2025, 8, 14, 20, 0, 0);
    const n = planHealthCheckin(sundayNight, "18:00");
    expect(n.at.getDate()).toBe(21);
  });

  it("keeps health details off the lock screen", () => {
    const n = planHealthCheckin(WED_9AM, "18:00");
    expect(n.title + n.body).not.toMatch(/knee|pain|reflux|condition|medication/i);
  });
});

describe("restDoneBody", () => {
  it("names the next exercise when known", () => {
    expect(restDoneBody("Bench Press")).toContain("Bench Press");
    expect(restDoneBody()).toMatch(/next set/);
  });
});

describe("buildReminderPlan", () => {
  const base = {
    profile: null,
    routines: [routine("a", "Push A", 6), routine("b", "Pull B", 4)],
    history: [] as WorkoutSession[],
  };

  it("is empty when every reminder is off", () => {
    const plan = buildReminderPlan(
      {
        ...base,
        settings: { remindersEnabled: false, reminderDays: null, reminderTime: "18:00", healthCheckinReminder: false },
      },
      WED_9AM
    );
    expect(plan).toEqual([]);
  });

  it("combines training days (derived from the profile) with the health check-in", () => {
    const plan = buildReminderPlan(
      {
        ...base,
        profile: { daysPerWeek: 2 } as never,
        settings: { remindersEnabled: true, reminderDays: null, reminderTime: "18:00", healthCheckinReminder: true },
      },
      WED_9AM
    );
    const training = plan.filter((n) => n.id !== NOTIFICATION_IDS.health);
    expect(training.every((n) => [1, 4].includes(n.at.getDay()))).toBe(true);
    expect(plan.some((n) => n.id === NOTIFICATION_IDS.health)).toBe(true);
    expect(training[0].body).toContain("Push A");
  });

  it("skips today after a session today and rotates the named routine", () => {
    const history = [session(new Date(2025, 8, 10, 7, 0).getTime())];
    const plan = buildReminderPlan(
      {
        ...base,
        history,
        settings: { remindersEnabled: true, reminderDays: [3], reminderTime: "18:00", healthCheckinReminder: false },
      },
      WED_9AM
    );
    expect(plan.every((n) => !sameLocalDay(n.at, WED_9AM))).toBe(true);
    expect(plan[0].body).toContain("Pull B");
    expect(nextRoutineFor(base.routines, history)?.name).toBe("Pull B");
  });
});
