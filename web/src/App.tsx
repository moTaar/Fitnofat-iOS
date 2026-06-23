import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { useStore } from "./lib/store";
import { useTheme, useOnlineStatus } from "./lib/hooks";
import { auth } from "./lib/api";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { Onboarding } from "./pages/Onboarding";
import { Dashboard } from "./pages/Dashboard";
import { Routines } from "./pages/Routines";
import { RoutineEditor } from "./pages/RoutineEditor";
import { ActiveWorkout } from "./pages/ActiveWorkout";
import { LibraryPage } from "./pages/Library";
import { History } from "./pages/History";
import { SettingsPage } from "./pages/Settings";
import { Dumbbell } from "lucide-react";
import { Spinner } from "./components/ui/misc";

function Splash() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4">
      <div className="rounded-3xl bg-gradient-to-br from-primary to-orange-600 p-4 text-white shadow-lg shadow-primary/30">
        <Dumbbell className="h-9 w-9" />
      </div>
      <Spinner className="text-primary" />
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const user = useStore((s) => s.user);
  const location = useLocation();
  if (!auth.isAuthenticated() || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

function RequireOnboarding({ children }: { children: React.ReactNode }) {
  const onboarded = useStore((s) => s.onboarded);
  if (!onboarded) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

export default function App() {
  useTheme();
  const online = useOnlineStatus();
  const hydrated = useStore((s) => s.hydrated);
  const bootstrapped = useStore((s) => s.bootstrapped);
  const user = useStore((s) => s.user);
  const bootstrap = useStore((s) => s.bootstrap);
  const syncPending = useStore((s) => s.syncPending);
  const pending = useStore((s) => s.history.some((h) => !h.synced));

  const authed = auth.isAuthenticated() && !!user;

  // Fetch server state once the local cache has rehydrated.
  useEffect(() => {
    if (hydrated && authed && !bootstrapped) void bootstrap();
  }, [hydrated, authed, bootstrapped, bootstrap]);

  // Auto-sync queued offline workouts when connectivity returns.
  useEffect(() => {
    if (online && authed && pending) {
      const t = setTimeout(() => void syncPending(), 1200);
      return () => clearTimeout(t);
    }
  }, [online, authed, pending, syncPending]);

  if (!hydrated) return <Splash />;
  if (authed && !bootstrapped) return <Splash />;

  return (
    <Routes>
      <Route path="/login" element={authed ? <Navigate to="/" replace /> : <Login />} />

      <Route
        path="/onboarding"
        element={
          <RequireAuth>
            <Onboarding />
          </RequireAuth>
        }
      />

      <Route
        path="/workout"
        element={
          <RequireAuth>
            <RequireOnboarding>
              <ActiveWorkout />
            </RequireOnboarding>
          </RequireAuth>
        }
      />

      <Route
        element={
          <RequireAuth>
            <RequireOnboarding>
              <Layout />
            </RequireOnboarding>
          </RequireAuth>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/routines" element={<Routines />} />
        <Route path="/routines/:id" element={<RoutineEditor />} />
        <Route path="/routines/new" element={<RoutineEditor />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/history" element={<History />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
