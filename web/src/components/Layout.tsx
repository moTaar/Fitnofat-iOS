import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Home, Dumbbell, Sparkles, Apple, BarChart3, Settings, WifiOff, Play } from "lucide-react";
import { cn, formatDuration } from "@/lib/utils";
import { useNow, useOnlineStatus } from "@/lib/hooks";
import { useStore } from "@/lib/store";
import { InstallPrompt } from "./InstallPrompt";
import { RestTimerBar } from "./RestTimerBar";

const NAV = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/routines", label: "Routines", icon: Dumbbell, end: false },
  { to: "/ai-coach", label: "Coach", icon: Sparkles, end: false },
  { to: "/nutrition", label: "Nutrition", icon: Apple, end: false },
  { to: "/history", label: "History", icon: BarChart3, end: false },
  { to: "/settings", label: "Settings", icon: Settings, end: false },
];

/**
 * Sticky mini-banner visible on every Layout page while a workout is live.
 * Hides itself when the rest-timer occupies the same slot (they're mutually exclusive).
 */
function ActiveWorkoutBanner() {
  const navigate = useNavigate();
  const active = useStore((s) => s.active);
  const now = useNow(!!active, 1000);

  // Hide if rest timer is running — RestTimerBar occupies the same position at higher z-index.
  const restRunning = !!active?.restTimer.active && !!active.restTimer.endsAt;

  if (!active || restRunning) return null;

  const elapsed = Math.floor((now - active.startedAt) / 1000);

  return (
    <div className="fixed inset-x-0 bottom-[4.25rem] z-30 mx-auto max-w-md px-3">
      <button
        onClick={() => navigate("/workout")}
        aria-label="Return to active workout"
        className="flex w-full items-center gap-3 rounded-2xl bg-primary px-4 py-2.5 text-primary-foreground shadow-xl animate-slide-up tap"
      >
        {/* Pulsing indicator dot */}
        <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/20">
          <Play className="h-4 w-4 fill-current" />
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-green-400 ring-2 ring-primary" />
        </span>

        <div className="flex-1 min-w-0 text-left">
          <p className="truncate text-[11px] font-medium opacity-75 leading-none mb-0.5">
            {active.routineName}
          </p>
          <p className="font-mono text-base font-bold tabular-nums leading-none">
            {formatDuration(elapsed)}
          </p>
        </div>

        <span className="shrink-0 rounded-xl bg-white/20 px-3 py-1.5 text-xs font-semibold">
          Return →
        </span>
      </button>
    </div>
  );
}

export function Layout() {
  const online = useOnlineStatus();
  const pendingSync = useStore((s) => s.history.some((h) => !h.synced));
  const location = useLocation();
  const inWorkout = location.pathname.startsWith("/workout");

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col">
      {!online && (
        <div className="sticky top-0 z-30 flex items-center justify-center gap-2 bg-amber-500/15 py-1.5 text-xs font-medium text-amber-500">
          <WifiOff className="h-3.5 w-3.5" />
          Offline — workouts are saved locally{pendingSync ? " and will sync later" : ""}
        </div>
      )}

      <main className="flex-1 px-4 pb-28 pt-3">
        <Outlet />
      </main>

      {/* RestTimerBar and ActiveWorkoutBanner are mutually exclusive — they share the same
          fixed slot above the nav. RestTimerBar wins (z-40) when rest is active. */}
      <RestTimerBar />
      <ActiveWorkoutBanner />

      {!inWorkout && <InstallPrompt />}

      <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-md border-t border-border bg-card/95 backdrop-blur safe-bottom">
        <div className="grid grid-cols-6">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium tap",
                  isActive ? "text-primary" : "text-muted-foreground"
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={cn("h-5 w-5", isActive && "fill-primary/10")} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
