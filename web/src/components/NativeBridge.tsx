import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { flushStorage, useStore } from "@/lib/store";
import { isNative } from "@/lib/platform";
import { deepLinkToRoute } from "@/lib/native";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import {
  cancelRestDone, notificationPermission, onNotificationTap, requestNotificationPermission,
  restDoneBody, scheduleRestDone, syncReminders,
} from "@/lib/notifications";
import { buildReminderPlan } from "@/lib/reminders";
import { auth } from "@/lib/api";

/**
 * The iOS app's link to the operating system. Renders nothing; in a browser it
 * does nothing. Mounted once, inside the router, for the app's lifetime.
 *
 *  • deep links — the password-reset email opens `fitnofat://reset-password#…`
 *  • lifecycle  — on backgrounding, flush the on-device store to disk and park
 *                 the token refresher; on return, restart it, sync anything
 *                 queued offline and re-plan reminders
 *  • network    — sync queued workouts the moment connectivity returns
 *  • notifications — keep the rest-over alert and the reminder schedule in
 *                 step with the app, and route taps to the right screen
 */
export function NativeBridge() {
  const navigate = useNavigate();

  // ── OS listeners ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isNative()) return;
    const cleanups: (() => void)[] = [];
    let disposed = false;
    const keep = (fn: () => void) => (disposed ? fn() : cleanups.push(fn));

    const open = (url: string) => {
      const route = deepLinkToRoute(url);
      if (route) navigate(route);
    };

    void (async () => {
      const { App } = await import("@capacitor/app");
      const { Network } = await import("@capacitor/network");

      // Cold start from a link: the listener below only sees warm opens.
      const launch = await App.getLaunchUrl().catch(() => undefined);
      if (launch?.url) open(launch.url);

      const urlHandle = await App.addListener("appUrlOpen", ({ url }) => open(url));
      keep(() => void urlHandle.remove());

      const stateHandle = await App.addListener("appStateChange", ({ isActive }) => {
        const tokens = supabaseConfigured() ? supabase().auth : null;
        if (isActive) {
          // JS timers don't run while iOS has the app suspended, so the
          // token refresher is started and stopped with the app.
          void tokens?.startAutoRefresh();
          const s = useStore.getState();
          if (s.user && auth.isAuthenticated()) void s.syncPending();
          void replanReminders();
        } else {
          void tokens?.stopAutoRefresh();
          // iOS gives a backgrounded app a few seconds; spend them making sure
          // the last logged set is on disk.
          void flushStorage();
        }
      });
      keep(() => void stateHandle.remove());

      const netHandle = await Network.addListener("networkStatusChange", ({ connected }) => {
        if (connected && auth.isAuthenticated()) void useStore.getState().syncPending();
      });
      keep(() => void netHandle.remove());

      keep(await onNotificationTap((route) => navigate(route)));
    })();

    return () => {
      disposed = true;
      cleanups.forEach((fn) => fn());
    };
  }, [navigate]);

  // ── splash + status bar ───────────────────────────────────────────────────
  const hydrated = useStore((s) => s.hydrated);
  const theme = useStore((s) => s.settings.theme);
  useEffect(() => {
    if (!isNative() || !hydrated) return;
    void import("@capacitor/splash-screen").then(({ SplashScreen }) => SplashScreen.hide());
  }, [hydrated]);
  useEffect(() => {
    if (!isNative()) return;
    void import("@capacitor/status-bar").then(({ StatusBar, Style }) =>
      StatusBar.setStyle({ style: theme === "dark" ? Style.Dark : Style.Light }).catch(() => {})
    );
  }, [theme]);

  // ── rest-over alert ───────────────────────────────────────────────────────
  // iOS asks for notification permission once; the moment a workout starts is
  // when the rest alert makes sense, so that's when the app asks (if the user
  // hasn't already answered from Settings).
  const activeId = useStore((s) => s.active?.id ?? null);
  useEffect(() => {
    if (!isNative() || !activeId || !useStore.getState().settings.restTimerAlerts) return;
    void notificationPermission().then((state) => {
      if (state === "prompt") void requestNotificationPermission();
    });
  }, [activeId]);

  const restEndsAt = useStore((s) =>
    s.active?.restTimer.active ? s.active.restTimer.endsAt : null
  );
  const restAlerts = useStore((s) => s.settings.restTimerAlerts);
  useEffect(() => {
    if (!isNative()) return;
    if (!restEndsAt || !restAlerts) {
      void cancelRestDone();
      return;
    }
    const active = useStore.getState().active;
    const next = active?.exercises.find((ex) => ex.sets.some((set) => !set.completed));
    void scheduleRestDone(restEndsAt, restDoneBody(next?.name)).catch(() => {});
  }, [restEndsAt, restAlerts]);

  // ── training / health reminders ───────────────────────────────────────────
  const settings = useStore((s) => s.settings);
  const user = useStore((s) => s.user);
  const latestSession = useStore((s) => s.history[0]?.startedAt ?? 0);
  const historyCount = useStore((s) => s.history.length);
  const routines = useStore((s) => s.routines);
  const daysPerWeek = useStore((s) => s.profile?.daysPerWeek);
  useEffect(() => {
    if (!isNative() || !hydrated) return;
    // Debounced: a burst of store changes (bootstrap, a sync) plans once.
    const t = setTimeout(() => void replanReminders(), 800);
    return () => clearTimeout(t);
  }, [
    hydrated, user, latestSession, historyCount, routines, daysPerWeek,
    settings.remindersEnabled, settings.reminderDays, settings.reminderTime,
    settings.healthCheckinReminder,
  ]);

  return null;
}

/** Recompute and replace the pending reminders from current state. */
async function replanReminders() {
  const s = useStore.getState();
  // Signed out: nothing should be pending for a user who isn't here.
  const plan = s.user && auth.isAuthenticated() ? buildReminderPlan(s) : [];
  await syncReminders(plan).catch((err) => console.warn("[notifications] sync failed:", err));
}
