import { useEffect, useRef, useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { cn, haptic } from "@/lib/utils";

// How far (px, after resistance) the page must be dragged before letting go
// refreshes, and the most it will follow the finger.
const TRIGGER = 64;
const MAX_PULL = 96;
// Finger travel is damped so the pull feels elastic rather than 1:1.
const RESISTANCE = 0.5;

/**
 * Pull-down-to-refresh for a page that scrolls the window. The body sets
 * `overscroll-behavior-y: none`, which also switches off the browser's own
 * pull-to-refresh (and in the installed PWA there never was one) — this puts
 * the gesture back, but runs `onRefresh` instead of reloading the app.
 *
 * Listeners sit on the wrapper, not the window, so drags inside a modal (which
 * portals to <body>) never trigger it.
 */
export function PullToRefresh({
  onRefresh,
  children,
}: {
  onRefresh: () => Promise<unknown>;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // Latest values for the native listeners, which are bound once.
  const live = useRef({ pull: 0, refreshing: false, onRefresh });
  live.current.onRefresh = onRefresh;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let startY: number | null = null;
    let armed = false;

    const set = (v: number) => {
      live.current.pull = v;
      setPull(v);
    };

    const onStart = (e: TouchEvent) => {
      // Only from the very top of the page, one finger, and not while a modal
      // has locked scrolling or a refresh is already running.
      if (live.current.refreshing || e.touches.length !== 1) return;
      if (window.scrollY > 0 || document.body.style.overflow === "hidden") return;
      startY = e.touches[0].clientY;
      armed = false;
    };

    const onMove = (e: TouchEvent) => {
      if (startY === null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0 || window.scrollY > 0) {
        startY = dy < 0 ? null : startY; // scrolling up: this isn't a pull
        if (live.current.pull) set(0);
        return;
      }
      const next = Math.min(MAX_PULL, dy * RESISTANCE);
      if (!armed && next >= TRIGGER) {
        armed = true;
        haptic();
      } else if (armed && next < TRIGGER) {
        armed = false;
      }
      set(next);
    };

    const onEnd = async () => {
      if (startY === null) return;
      startY = null;
      if (live.current.pull < TRIGGER) {
        set(0);
        return;
      }
      live.current.refreshing = true;
      setRefreshing(true);
      set(TRIGGER * 0.75); // park the spinner while the refresh runs
      try {
        await live.current.onRefresh();
      } finally {
        live.current.refreshing = false;
        setRefreshing(false);
        set(0);
      }
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  const dragging = pull > 0 && !refreshing;
  const progress = Math.min(1, pull / TRIGGER);

  return (
    <div ref={ref} className="relative">
      <div
        aria-hidden={!refreshing}
        aria-live="polite"
        className="pointer-events-none absolute inset-x-0 top-0 flex justify-center"
        style={{
          height: pull,
          opacity: refreshing ? 1 : progress,
          transition: dragging ? "none" : "height 200ms ease, opacity 200ms ease",
        }}
      >
        <span
          className={cn(
            "mt-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card shadow-md",
            progress >= 1 || refreshing ? "text-primary" : "text-muted-foreground"
          )}
        >
          <RefreshCw
            className={cn("h-4 w-4", refreshing && "animate-spin")}
            style={refreshing ? undefined : { transform: `rotate(${progress * 270}deg)` }}
          />
          {refreshing && <span className="sr-only">Refreshing</span>}
        </span>
      </div>
      <div
        style={{
          transform: pull ? `translateY(${pull}px)` : undefined,
          transition: dragging ? "none" : "transform 200ms ease",
        }}
      >
        {children}
      </div>
    </div>
  );
}
