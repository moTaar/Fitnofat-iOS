// Lightweight local-notification helpers. Real push needs a server; for an
// installable PWA, local Notification scheduling keeps users accountable.

export function notificationsSupported(): boolean {
  return typeof Notification !== "undefined";
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return "denied";
  if (Notification.permission === "granted") return "granted";
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

export function fireNotification(title: string, body: string) {
  if (!notificationsSupported() || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: "/pwa-192x192.png", badge: "/pwa-192x192.png" });
  } catch {
    /* ignore */
  }
}

const timers = new Map<string, number>();

/** Schedules a local reminder `delayMs` from now (while the app stays alive). */
export function scheduleReminder(id: string, delayMs: number, title: string, body: string) {
  cancelReminder(id);
  if (delayMs <= 0) return;
  const handle = window.setTimeout(() => {
    fireNotification(title, body);
    timers.delete(id);
  }, Math.min(delayMs, 2_147_000_000));
  timers.set(id, handle);
}

export function cancelReminder(id: string) {
  const h = timers.get(id);
  if (h) {
    clearTimeout(h);
    timers.delete(id);
  }
}
