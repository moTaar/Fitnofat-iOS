import { RefreshCw, Sparkles, X } from "lucide-react";
import { useUpdateStore } from "@/lib/pwa";
import { useStore } from "@/lib/store";
import { Button } from "./ui/button";
import { Spinner } from "./ui/misc";

/**
 * Whether the "new version is ready" banner is currently on screen.
 *
 * It appears once the service worker has installed a newer build (see
 * `lib/pwa.ts`), and is deliberately suppressed while a workout is live.
 * Reloading mid-session is safe — the active workout, including the rest-timer
 * deadline, is persisted and restored — but interrupting someone between sets
 * to advertise an update is not what this app is for. The banner reappears the
 * moment the session ends.
 *
 * Exported because other bottom-anchored banners share this slot above the dock
 * and need to yield to it rather than stack on top.
 */
export function useUpdateBannerVisible(): boolean {
  const ready = useUpdateStore((s) => s.ready);
  const snoozed = useUpdateStore((s) => s.snoozed);
  const activeWorkout = useStore((s) => s.active);
  return ready && !snoozed && !activeWorkout;
}

/**
 * Bottom padding for full-height screens that have no dock reserving space for
 * the banner (login, password reset, onboarding). Without it the banner floats
 * over vertically-centred content that can't be scrolled clear, covering the
 * screen's primary action. Empty string when the banner isn't showing.
 */
export function useUpdateBannerPadding(): string {
  return useUpdateBannerVisible() ? "pb-56" : "";
}

/**
 * "A new version is ready — Reload" banner. Until the user accepts, the app
 * keeps running on the version it started with, so nothing changes underfoot.
 */
export function UpdatePrompt() {
  const visible = useUpdateBannerVisible();
  const applying = useUpdateStore((s) => s.applying);
  const apply = useUpdateStore((s) => s.apply);
  const snooze = useUpdateStore((s) => s.snooze);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-[calc(var(--dock-height,4rem)_+_0.75rem)] z-50 mx-auto max-w-md px-4 animate-slide-up"
    >
      <div className="flex items-start gap-3 rounded-2xl border border-primary/30 bg-card/95 p-4 shadow-2xl backdrop-blur">
        <div className="rounded-xl bg-primary/15 p-2 text-primary">
          <Sparkles className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight">A new version is ready</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Reload to get the latest improvements. Your logged workouts are safe.
          </p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => void apply()} disabled={applying} className="flex-1">
              {applying ? (
                <>
                  <Spinner className="mr-2 h-4 w-4" />
                  Reloading…
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Reload
                </>
              )}
            </Button>
            <Button size="sm" variant="ghost" onClick={snooze} disabled={applying}>
              Later
            </Button>
          </div>
        </div>

        <button
          onClick={snooze}
          disabled={applying}
          aria-label="Dismiss update notice"
          className="rounded-full p-1 hover:bg-accent tap disabled:opacity-50"
        >
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}
