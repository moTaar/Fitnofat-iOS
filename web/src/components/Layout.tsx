import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Home, Dumbbell, Sparkles, BarChart3, Settings, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOnlineStatus } from "@/lib/hooks";
import { useStore } from "@/lib/store";
import { InstallPrompt } from "./InstallPrompt";
import { RestTimerBar } from "./RestTimerBar";

const NAV = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/routines", label: "Routines", icon: Dumbbell, end: false },
  { to: "/ai-coach", label: "AI Coach", icon: Sparkles, end: false },
  { to: "/history", label: "History", icon: BarChart3, end: false },
  { to: "/settings", label: "Settings", icon: Settings, end: false },
];

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

      <RestTimerBar />
      {!inWorkout && <InstallPrompt />}

      <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-md border-t border-border bg-card/95 backdrop-blur safe-bottom">
        <div className="grid grid-cols-5">
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
