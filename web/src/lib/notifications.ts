// Notifications.
//
// In the iOS app these are real local notifications (@capacitor/local-
// notifications): scheduled with the OS, delivered with the app closed, and
// needing no server at all — no push service, no APNs key, nothing hosted.
// Three kinds:
//
//   • rest over      — fires when the rest timer ends, so the phone can sit in
//                      a pocket between sets. Suppressed while the app is open,
//                      where the in-app timer bar already beeps.
//   • training days  — on the days/time the user picks, naming the session
//                      that's up next. Planned a few weeks ahead as one-off
//                      notifications (not a repeating rule) so that finishing
//                      today's workout can take today's reminder back.
//   • health check-in — a weekly nudge to log how tracked issues are going.
//                      Deliberately generic: a lock screen is not the place
//                      for the name of a medical condition.
//
// In a browser only the old best-effort Notification API path exists (the
// page has to stay open), kept for the PWA build.

import { isNative } from "./platform";

// ── notification ids ────────────────────────────────────────────────────────
// Stable numeric ids per kind, so rescheduling replaces instead of stacking.
export const NOTIFICATION_IDS = {
  rest: 1001,
  trainingBase: 2000,
  /** How many days ahead training reminders are planned (one id per day). */
  trainingHorizonDays: 21,
  health: 3001,
} as const;

const isTrainingId = (id: number) =>
  id >= NOTIFICATION_IDS.trainingBase &&
  id < NOTIFICATION_IDS.trainingBase + NOTIFICATION_IDS.trainingHorizonDays;

export interface PlannedNotification {
  id: number;
  at: Date;
  title: string;
  body: string;
  /** In-app route opened when the notification is tapped. */
  route: string;
}

// ── pure planning (unit-tested) ─────────────────────────────────────────────

/** "18:30" → { h: 18, m: 30 }; anything unparseable → 18:00. */
export function parseTime(value: string | undefined): { h: number; m: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value ?? "");
  if (!match) return { h: 18, m: 0 };
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return { h: 18, m: 0 };
  return { h, m };
}

/** Sensible weekdays for N sessions a week (0 = Sunday … 6 = Saturday). */
export function defaultReminderDays(daysPerWeek: number | undefined): number[] {
  const presets: Record<number, number[]> = {
    1: [1],
    2: [1, 4],
    3: [1, 3, 5],
    4: [1, 2, 4, 5],
    5: [1, 2, 3, 4, 5],
    6: [1, 2, 3, 4, 5, 6],
    7: [0, 1, 2, 3, 4, 5, 6],
  };
  const n = Math.max(1, Math.min(7, Math.round(daysPerWeek ?? 3)));
  return presets[n];
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Mon, Wed & Fri at 18:00" — for confirmations in the UI. */
export function describeReminderDays(days: number[], time: string): string {
  // Monday-first, the way a training week reads.
  const names = [...new Set(days)]
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    .map((d) => DAY_NAMES[d]);
  const list =
    names.length === 7
      ? "Every day"
      : names.length <= 1
        ? names.join("")
        : `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
  const { h, m } = parseTime(time);
  return `${list} at ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export interface TrainingReminderInput {
  days: number[];
  time: string;
  now: Date;
  /** A session was already logged today — today's reminder is dropped. */
  trainedToday: boolean;
  nextRoutine?: { name: string; exerciseCount: number };
  horizonDays?: number;
}

export function planTrainingReminders(input: TrainingReminderInput): PlannedNotification[] {
  const { h, m } = parseTime(input.time);
  const horizon = Math.min(
    input.horizonDays ?? NOTIFICATION_IDS.trainingHorizonDays,
    NOTIFICATION_IDS.trainingHorizonDays,
  );
  const days = new Set(input.days);
  const body = input.nextRoutine
    ? `${input.nextRoutine.name} is up next — ${input.nextRoutine.exerciseCount} exercise${
        input.nextRoutine.exerciseCount === 1 ? "" : "s"
      }. Tap to start.`
    : "Your next session is ready. Tap to start.";

  const out: PlannedNotification[] = [];
  for (let d = 0; d < horizon; d++) {
    // Built from calendar fields, not by adding 24h, so DST changes don't
    // shift the reminder by an hour.
    const at = new Date(
      input.now.getFullYear(),
      input.now.getMonth(),
      input.now.getDate() + d,
      h,
      m,
      0,
      0,
    );
    if (!days.has(at.getDay())) continue;
    if (at.getTime() <= input.now.getTime()) continue;
    if (d === 0 && input.trainedToday) continue;
    out.push({
      id: NOTIFICATION_IDS.trainingBase + d,
      at,
      title: "Time to train 💪",
      body,
      route: "/",
    });
  }
  return out;
}

/** Next weekly health check-in (Sunday by default, at the reminder time). */
export function planHealthCheckin(now: Date, time: string, weekday = 0): PlannedNotification {
  const { h, m } = parseTime(time);
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
  let add = (weekday - at.getDay() + 7) % 7;
  if (add === 0 && at.getTime() <= now.getTime()) add = 7;
  at.setDate(at.getDate() + add);
  return {
    id: NOTIFICATION_IDS.health,
    at,
    title: "Weekly check-in",
    body: "A minute to log how things are going keeps your health tracker useful.",
    route: "/health",
  };
}

/** Body for the "rest over" alert: the exercise whose next set is waiting. */
export function restDoneBody(nextExercise?: string): string {
  return nextExercise
    ? `Rest's over — next up: ${nextExercise}.`
    : "Rest's over — time for your next set.";
}

/** Same calendar day in local time. */
export function sameLocalDay(a: number | Date, b: number | Date): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
}

// ── permission ──────────────────────────────────────────────────────────────

export type PermissionState = "granted" | "denied" | "prompt";

export function notificationsSupported(): boolean {
  return isNative() || typeof Notification !== "undefined";
}

type LocalNotificationsPlugin = typeof import("@capacitor/local-notifications").LocalNotifications;

/**
 * Runs `fn` with the plugin. Never `return` a Capacitor plugin from an async
 * function: it's a Proxy that answers every property, `then` included, so the
 * Promise machinery treats it as a thenable and calls a native "then" method
 * that doesn't exist.
 */
async function withNotifications<T>(fn: (ln: LocalNotificationsPlugin) => Promise<T>): Promise<T> {
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  return fn(LocalNotifications);
}

function mapPermission(value: string): PermissionState {
  if (value === "granted") return "granted";
  if (value === "denied") return "denied";
  return "prompt";
}

export async function notificationPermission(): Promise<PermissionState> {
  if (isNative()) {
    try {
      return mapPermission((await withNotifications((ln) => ln.checkPermissions())).display);
    } catch {
      return "denied";
    }
  }
  if (typeof Notification === "undefined") return "denied";
  return Notification.permission === "default"
    ? "prompt"
    : (Notification.permission as PermissionState);
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (isNative()) {
    try {
      const state = mapPermission(
        (await withNotifications((ln) => ln.requestPermissions())).display,
      );
      return state === "prompt" ? "default" : state;
    } catch {
      return "denied";
    }
  }
  if (typeof Notification === "undefined") return "denied";
  if (Notification.permission === "granted") return "granted";
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

// ── native scheduling ───────────────────────────────────────────────────────

/** Rest-over alert at `endsAt`. Silent while the app is in the foreground. */
export async function scheduleRestDone(endsAt: number, body: string): Promise<void> {
  if (!isNative() || endsAt <= Date.now()) return;
  if ((await notificationPermission()) !== "granted") return;
  await withNotifications(async (ln) => {
    await ln.cancel({ notifications: [{ id: NOTIFICATION_IDS.rest }] }).catch(() => {});
    await ln.schedule({
      notifications: [
        {
          id: NOTIFICATION_IDS.rest,
          title: "Rest complete",
          body,
          schedule: { at: new Date(endsAt), allowWhileIdle: true },
          // Bundled with the web assets (web/public) — the plugin looks there.
          sound: "rest-done.wav",
          interruptionLevel: "timeSensitive",
          foreground: false,
          threadIdentifier: "workout",
          extra: { route: "/workout" },
        },
      ],
    });
  });
}

export async function cancelRestDone(): Promise<void> {
  if (!isNative()) return;
  try {
    await withNotifications((ln) => ln.cancel({ notifications: [{ id: NOTIFICATION_IDS.rest }] }));
  } catch {
    /* nothing pending */
  }
}

/**
 * Replaces every pending training/health reminder with `planned`. Called
 * whenever an input changes (settings, a finished workout, the next routine)
 * and on each return to the foreground.
 */
export async function syncReminders(planned: PlannedNotification[]): Promise<void> {
  if (!isNative()) return;
  const granted = (await notificationPermission()) === "granted";
  await withNotifications(async (ln) => {
    const pending = await ln.getPending().catch(() => ({ notifications: [] as { id: number }[] }));
    const stale = pending.notifications
      .map((n) => Number(n.id))
      .filter((id) => isTrainingId(id) || id === NOTIFICATION_IDS.health);
    if (stale.length)
      await ln.cancel({ notifications: stale.map((id) => ({ id })) }).catch(() => {});
    if (!planned.length || !granted) return;
    await ln.schedule({
      notifications: planned.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        schedule: { at: n.at, allowWhileIdle: true },
        interruptionLevel:
          n.id === NOTIFICATION_IDS.health ? ("passive" as const) : ("active" as const),
        threadIdentifier: n.id === NOTIFICATION_IDS.health ? "health" : "training",
        extra: { route: n.route },
      })),
    });
  });
}

/** Routes the app to wherever a tapped notification points. */
export async function onNotificationTap(open: (route: string) => void): Promise<() => void> {
  if (!isNative()) return () => {};
  const handle = await withNotifications((ln) =>
    ln.addListener("localNotificationActionPerformed", (event) => {
      const route = event.notification.extra?.route;
      if (typeof route === "string" && route.startsWith("/")) open(route);
    }),
  );
  return () => void handle.remove();
}

// ── browser fallback (PWA) ──────────────────────────────────────────────────

export function fireNotification(title: string, body: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: "/pwa-192x192.png", badge: "/pwa-192x192.png" });
  } catch {
    /* ignore */
  }
}

const timers = new Map<string, number>();

/** Schedules a local reminder `delayMs` from now (while the page stays alive). */
export function scheduleReminder(id: string, delayMs: number, title: string, body: string) {
  cancelReminder(id);
  if (delayMs <= 0) return;
  const handle = window.setTimeout(
    () => {
      fireNotification(title, body);
      timers.delete(id);
    },
    Math.min(delayMs, 2_147_000_000),
  );
  timers.set(id, handle);
}

export function cancelReminder(id: string) {
  const h = timers.get(id);
  if (h) {
    clearTimeout(h);
    timers.delete(id);
  }
}
