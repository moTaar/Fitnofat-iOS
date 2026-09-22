import { registerSW } from "virtual:pwa-register";
import { create } from "zustand";
import { toast } from "./toast";

// Registers the service worker that makes Fitnofat installable and fully usable
// offline, and drives the "a new version is ready" prompt.
//
// The SW is registered in **prompt** mode, not autoUpdate. That matters for a
// code-split app: an auto-activating worker claims the open tab and then
// `cleanupOutdatedCaches` deletes the hashed chunks that tab is still holding
// references to, so the next lazy route navigation fails to load. In prompt mode
// the new worker installs and then *waits* — the running tab keeps its own
// chunks, and the swap only happens when the user accepts, on a full reload.
//
// No-ops in dev (the SW is disabled there).

interface UpdateState {
  /** A new build is installed and waiting to take over. */
  ready: boolean;
  /** The user accepted; we're activating the new worker and reloading. */
  applying: boolean;
  /** Dismissed for this page-load — re-offered on the next check. */
  snoozed: boolean;
  markReady: () => void;
  snooze: () => void;
  apply: () => Promise<void>;
}

/** Activates the waiting worker and reloads. Replaced once the SW registers. */
let applyUpdate: (reload?: boolean) => Promise<void> = async () => {
  window.location.reload();
};

export const useUpdateStore = create<UpdateState>((set) => ({
  ready: false,
  applying: false,
  snoozed: false,
  // A fresh build re-offers itself even if an earlier one was snoozed.
  markReady: () => set({ ready: true, snoozed: false }),
  snooze: () => set({ snoozed: true }),
  apply: async () => {
    set({ applying: true });
    try {
      // Sends SKIP_WAITING, then reloads once the new worker takes control.
      await applyUpdate(true);
    } catch {
      // If messaging the worker fails for any reason, a plain reload still
      // picks up the new build on the next navigation — never leave the user
      // stuck on a button that does nothing.
      window.location.reload();
    }
  },
}));

/** Imperative accessor for non-React callers. */
export const appUpdate = {
  markReady: () => useUpdateStore.getState().markReady(),
};

// How often a long-lived tab asks whether a newer build exists. Installed PWAs
// routinely stay open for days, so without this the user would only ever learn
// about an update by cold-starting the app.
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export function setupPWA(): void {
  try {
    applyUpdate = registerSW({
      immediate: true,

      onNeedRefresh() {
        appUpdate.markReady();
      },

      onOfflineReady() {
        toast.success("Ready to use offline — open Fitnofat anytime, no signal needed.");
      },

      onRegisteredSW(_swUrl, registration) {
        if (!registration) return;

        const check = () => {
          // `update()` is a network fetch; pointless (and noisy) while offline.
          if (!navigator.onLine) return;
          void registration.update().catch(() => {
            // Transient network failure — the next tick tries again.
          });
        };

        setInterval(check, UPDATE_CHECK_INTERVAL_MS);
        // Also check when the app is brought back to the foreground, which is
        // when a phone user is most likely to have missed a deploy.
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") check();
        });
      },
    });
  } catch {
    // virtual:pwa-register is a no-op stub when the SW is disabled (dev mode).
  }
}
