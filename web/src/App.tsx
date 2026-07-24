import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { useStore } from "./lib/store";
import { useTheme, useOnlineStatus, useOnVisible } from "./lib/hooks";
import { auth } from "./lib/api";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { Onboarding } from "./pages/Onboarding";
import { Dashboard } from "./pages/Dashboard";
import { Routines } from "./pages/Routines";
import { RoutineEditor } from "./pages/RoutineEditor";
import { ActiveWorkout } from "./pages/ActiveWorkout";
import { LibraryPage } from "./pages/Library";
import { AiCoach } from "./pages/AiCoach";
import { Nutrition } from "./pages/Nutrition";
import { History } from "./pages/History";
import { SettingsPage } from "./pages/Settings";
import { Billing } from "./pages/Billing";
import { Dumbbell } from "lucide-react";
import { Spinner } from "./components/ui/misc";
import { Toaster } from "./components/ui/toast";
import { Modal } from "./components/ui/modal";
import { Button } from "./components/ui/button";

const STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4 hours

function Splash({ onSkip }: { onSkip?: () => void }) {
  // If a bootstrap request is stuck (e.g. the network connection was
  // suspended while the app was backgrounded and never recovered), don't
  // strand the user on the spinner forever — offer a way out after a few
  // seconds so they can continue with whatever's cached locally.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!onSkip) return;
    const t = setTimeout(() => setSlow(true), 6000);
    return () => clearTimeout(t);
  }, [onSkip]);

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4">
      <div className="rounded-3xl bg-gradient-to-br from-primary to-orange-600 p-4 text-white shadow-lg shadow-primary/30">
        <Dumbbell className="h-9 w-9" />
      </div>
      <Spinner className="text-primary" />
      {slow && onSkip && (
        <div className="flex flex-col items-center gap-2 px-6 text-center">
          <p className="text-sm text-muted-foreground">This is taking longer than usual.</p>
          <Button size="sm" variant="outline" onClick={onSkip}>
            Continue offline
          </Button>
        </div>
      )}
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

/**
 * On cold launch, checks if there is an abandoned active workout session.
 * If it has been running for more than 4 hours the user is prompted to
 * resume, save completed sets, or discard it entirely.
 */
function StaleWorkoutGuard() {
  const hydrated = useStore((s) => s.hydrated);
  const active = useStore((s) => s.active);
  const cancelWorkout = useStore((s) => s.cancelWorkout);
  const finishWorkout = useStore((s) => s.finishWorkout);

  const [open, setOpen] = useState(false);
  // Guard against re-checking if the state somehow re-triggers the effect.
  const checked = useRef(false);

  useEffect(() => {
    if (!hydrated || checked.current) return;
    checked.current = true;
    if (active && Date.now() - active.startedAt > STALE_THRESHOLD_MS) {
      setOpen(true);
    }
  }, [hydrated, active]);

  if (!open || !active) return null;

  const hoursAgo = Math.floor((Date.now() - active.startedAt) / 3_600_000);

  const handleResume = () => setOpen(false);

  const handleSave = async () => {
    await finishWorkout();
    setOpen(false);
  };

  const handleDiscard = () => {
    cancelWorkout();
    setOpen(false);
  };

  return (
    <Modal open={open} onClose={handleResume} title="Uncompleted workout found">
      <p className="text-sm text-muted-foreground">
        Your{" "}
        <b className="font-semibold text-foreground">{active.routineName}</b>{" "}
        session started{" "}
        <b className="font-semibold text-foreground">
          ~{hoursAgo} hour{hoursAgo !== 1 ? "s" : ""} ago
        </b>{" "}
        and was never finished. What would you like to do?
      </p>
      <div className="mt-4 flex flex-col gap-2">
        <Button className="w-full" onClick={handleResume}>
          Resume workout
        </Button>
        <Button variant="outline" className="w-full" onClick={handleSave}>
          Save completed sets &amp; finish
        </Button>
        <Button variant="destructive" className="w-full" onClick={handleDiscard}>
          Discard workout
        </Button>
      </div>
    </Modal>
  );
}

export default function App() {
  useTheme();
  const online = useOnlineStatus();
  const hydrated = useStore((s) => s.hydrated);
  const bootstrapped = useStore((s) => s.bootstrapped);
  const user = useStore((s) => s.user);
  const bootstrap = useStore((s) => s.bootstrap);
  const skipBootstrap = useStore((s) => s.skipBootstrap);
  const syncPending = useStore((s) => s.syncPending);
  const pending = useStore((s) => s.history.some((h) => !h.synced));

  const authed = auth.isAuthenticated() && !!user;

  // Fetch server state once the local cache has rehydrated.
  useEffect(() => {
    if (hydrated && authed && !bootstrapped) void bootstrap();
  }, [hydrated, authed, bootstrapped, bootstrap]);

  // Retry immediately when returning from the background: a request in
  // flight when the app was backgrounded may have been suspended by the OS
  // and never resolved, leaving `bootstrapped` stuck false.
  useOnVisible(() => {
    if (hydrated && authed && !bootstrapped) void bootstrap();
  });

  // Auto-sync queued offline workouts when connectivity returns.
  useEffect(() => {
    if (online && authed && pending) {
      const t = setTimeout(() => void syncPending(), 1200);
      return () => clearTimeout(t);
    }
  }, [online, authed, pending, syncPending]);

  if (!hydrated) return <Splash />;
  if (authed && !bootstrapped) return <Splash onSkip={skipBootstrap} />;

  return (
    <>
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
          <Route path="/ai-coach" element={<AiCoach />} />
          <Route path="/nutrition" element={<Nutrition />} />
          <Route path="/history" element={<History />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/billing" element={<Billing />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <Toaster />
      {/* Checks once on cold launch whether a stale (>4 h) workout needs attention. */}
      <StaleWorkoutGuard />
    </>
  );
}
