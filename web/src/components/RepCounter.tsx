import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X, Lock, Unlock, Activity, Smartphone, Volume2, VolumeX, Check,
  SlidersHorizontal, Target, ShieldAlert,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { cn, haptic, playTick } from "@/lib/utils";
import type { RepSensitivity } from "@/lib/types";
import {
  RepDetector, initialPermission, meterCeiling, readMotion,
  requestMotionPermission, type MotionPermission,
} from "@/lib/repCounter";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/misc";

// ── Sensor hook ───────────────────────────────────────────────────────────────
// Owns the DeviceMotion subscription + permission flow and feeds samples into a
// RepDetector. Kept separate from the view so the gnarly listener lifecycle
// stays in one place. `onRep` is read through a ref so changing the callback
// never re-subscribes the listener mid-set.
function useRepCounter(opts: {
  active: boolean; // engine should be running (set live + sensors granted)
  sensitivity: RepSensitivity;
  onRep: () => void;
}) {
  const { active, sensitivity, onRep } = opts;
  const [permission, setPermission] = useState<MotionPermission>(initialPermission);
  const [motion, setMotion] = useState(0); // 0..1 normalized for the meter
  const [idle, setIdle] = useState(false); // sustained stillness (auto-paused)
  const [noData, setNoData] = useState(false); // granted but no samples arriving

  const detectorRef = useRef<RepDetector | null>(null);
  const onRepRef = useRef(onRep);
  onRepRef.current = onRep;

  const lastPublishRef = useRef(0);
  const lastMotionAtRef = useRef(0);
  const gotDataRef = useRef(false);

  const request = useCallback(async () => {
    setPermission(await requestMotionPermission());
  }, []);

  const listening = active && permission === "granted";

  useEffect(() => {
    if (!listening) {
      setMotion(0);
      setIdle(false);
      return;
    }
    const det = new RepDetector(sensitivity);
    detectorRef.current = det;
    gotDataRef.current = false;
    setNoData(false);
    lastMotionAtRef.current = performance.now();
    const ceiling = meterCeiling(sensitivity);

    const handler = (e: DeviceMotionEvent) => {
      const raw = readMotion(e);
      if (!raw) return;
      gotDataRef.current = true;
      const t = e.timeStamp || performance.now();
      const { rep, magnitude } = det.feed({ ...raw, t });
      if (rep) {
        lastMotionAtRef.current = t;
        onRepRef.current();
      } else if (magnitude > 0.35) {
        lastMotionAtRef.current = t;
      }
      // Throttle UI state to ~15fps; the raw event fires at ~60Hz.
      if (t - lastPublishRef.current > 66) {
        lastPublishRef.current = t;
        setMotion(Math.min(1, magnitude / ceiling));
        setIdle(t - lastMotionAtRef.current > 4000);
      }
    };

    window.addEventListener("devicemotion", handler);
    // If granted but nothing arrives, the sensor is likely blocked (insecure
    // context / policy) — surface a hint so the user falls back to manual.
    const probe = window.setTimeout(() => {
      if (!gotDataRef.current) setNoData(true);
    }, 2200);

    return () => {
      window.removeEventListener("devicemotion", handler);
      window.clearTimeout(probe);
    };
  }, [listening, sensitivity]);

  return { permission, request, listening, motion, idle, noData };
}

// ── Lock toggle ────────────────────────────────────────────────────────────────
// Locking is a single tap; unlocking requires a deliberate ~650ms press-and-hold
// so a phone jostling in a pocket can't accidentally re-enable touch editing.
function LockToggle({
  locked,
  onLock,
  onUnlock,
}: {
  locked: boolean;
  onLock: () => void;
  onUnlock: () => void;
}) {
  const timerRef = useRef<number | null>(null);
  const [holding, setHolding] = useState(false);

  const cancel = useCallback(() => {
    setHolding(false);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => () => cancel(), [cancel]);

  if (!locked) {
    return (
      <button
        onClick={() => {
          haptic(20);
          onLock();
        }}
        className="flex items-center gap-2 rounded-xl border border-border bg-secondary px-3 py-2 text-sm font-medium tap"
      >
        <Unlock className="h-4 w-4" />
        Lock screen
      </button>
    );
  }

  return (
    <button
      onPointerDown={() => {
        setHolding(true);
        timerRef.current = window.setTimeout(() => {
          cancel();
          haptic(40);
          onUnlock();
        }, 650);
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      className="relative flex items-center gap-2 overflow-hidden rounded-xl border border-primary/50 bg-primary/15 px-3 py-2 text-sm font-semibold text-primary"
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-0 origin-left bg-primary/30 transition-transform ease-linear",
          holding ? "scale-x-100 duration-[650ms]" : "scale-x-0 duration-150"
        )}
        style={{ width: "100%" }}
      />
      <Lock className="relative h-4 w-4" />
      <span className="relative">{holding ? "Keep holding…" : "Hold to unlock"}</span>
    </button>
  );
}

// ── Main overlay ────────────────────────────────────────────────────────────────
export interface RepCounterProps {
  open: boolean;
  exerciseName: string;
  setNumber: number;
  targetReps?: number;
  initialReps: number;
  weight: number;
  units: "kg" | "lb";
  onClose: () => void;
  onLog: (reps: number) => void;
}

export function RepCounter({
  open,
  exerciseName,
  setNumber,
  targetReps,
  initialReps,
  weight,
  units,
  onClose,
  onLog,
}: RepCounterProps) {
  const sensitivity = useStore((s) => s.settings.repSensitivity);
  const sound = useStore((s) => s.settings.repSound);
  const setSetting = useStore((s) => s.setSetting);

  const [count, setCount] = useState(initialReps);
  const [locked, setLocked] = useState(false);
  const [tune, setTune] = useState(false);
  const [skipSensor, setSkipSensor] = useState(false); // user opted out of auto-count
  const [flash, setFlash] = useState(false); // brief pulse when a rep registers

  // Reset transient state every time the sheet (re)opens.
  useEffect(() => {
    if (!open) return;
    setCount(initialReps);
    setLocked(false);
    setTune(false);
    setSkipSensor(false);
  }, [open, initialReps]);

  // Lock body scroll + wire Escape-to-close while open (mirrors Modal).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  const registerRep = useCallback(
    (delta: number) => {
      setCount((c) => {
        const next = Math.max(0, c + delta);
        if (next === c) return c;
        haptic(delta > 0 ? 18 : 10);
        if (sound) playTick(delta > 0 ? 1040 : 720);
        setFlash(true);
        window.setTimeout(() => setFlash(false), 180);
        return next;
      });
    },
    [sound]
  );

  const onRep = useCallback(() => registerRep(1), [registerRep]);

  const targetReached = targetReps != null && targetReps > 0 && count >= targetReps;
  // Auto-pause the engine once the prescribed reps are hit (manual + / − still
  // works, and lowering the count below target resumes auto-counting).
  const engineActive = open && !skipSensor && !targetReached;

  const { permission, request, listening, motion, idle, noData } = useRepCounter({
    active: engineActive,
    sensitivity,
    onRep,
  });

  if (!open) return null;

  const needsPrompt = permission === "prompt" && !skipSensor;
  const sensorUnavailable = permission === "unsupported" || permission === "denied" || noData;

  // Status line under the counter.
  let statusLabel: string;
  let statusTone: "live" | "idle" | "locked" | "off" | "done";
  if (locked) {
    statusLabel = listening && !sensorUnavailable ? "Locked · auto-counting" : "Screen locked";
    statusTone = "locked";
  } else if (targetReached) {
    statusLabel = "Target reached";
    statusTone = "done";
  } else if (permission === "unsupported") {
    statusLabel = "Manual mode · no motion sensor";
    statusTone = "off";
  } else if (permission === "denied") {
    statusLabel = "Manual mode · motion blocked";
    statusTone = "off";
  } else if (noData) {
    statusLabel = "Manual mode · no sensor data";
    statusTone = "off";
  } else if (skipSensor) {
    statusLabel = "Manual mode";
    statusTone = "off";
  } else if (idle) {
    statusLabel = "Paused · waiting for movement";
    statusTone = "idle";
  } else if (listening) {
    statusLabel = "Auto-counting…";
    statusTone = "live";
  } else {
    statusLabel = "Starting…";
    statusTone = "idle";
  }

  const sensitivityOptions = [
    { label: "Low", value: "low" as const },
    { label: "Med", value: "medium" as const },
    { label: "High", value: "high" as const },
  ];

  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col bg-background animate-fade-in select-none">
      {/* Header */}
      <header
        className="flex items-center gap-3 border-b border-border px-4 py-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}
      >
        <button
          onClick={onClose}
          className="rounded-full p-1.5 hover:bg-accent tap"
          aria-label="Close rep counter"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight">{exerciseName}</p>
          <p className="text-xs text-muted-foreground">
            Set {setNumber}
            {targetReps ? ` · target ${targetReps}` : ""}
            {weight > 0 ? ` · ${weight} ${units}` : ""}
          </p>
        </div>
        <LockToggle
          locked={locked}
          onLock={() => setLocked(true)}
          onUnlock={() => setLocked(false)}
        />
      </header>

      {/* Counter touch zone */}
      <div
        className={cn(
          "relative flex-1 overflow-hidden border-y-2 transition-colors duration-500",
          locked
            ? "border-transparent bg-muted/30"
            : "border-primary/40 bg-primary/[0.04]"
        )}
      >
        {/* Tap zones — disabled while locked so pocket contact can't edit. */}
        <button
          type="button"
          disabled={locked}
          onClick={() => registerRep(1)}
          aria-label="Add one rep"
          className="absolute inset-x-0 top-0 h-1/2 w-full disabled:cursor-default"
        />
        <button
          type="button"
          disabled={locked}
          onClick={() => registerRep(-1)}
          aria-label="Remove one rep"
          className="absolute inset-x-0 bottom-0 h-1/2 w-full disabled:cursor-default"
        />

        {/* Number + hints (non-interactive, so taps fall through to the zones). */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-4">
          {!locked && (
            <span className="mb-1 flex items-center gap-1 text-sm font-medium text-muted-foreground">
              <span className="text-lg leading-none">＋</span> tap top to add
            </span>
          )}
          <span
            className={cn(
              "font-black leading-none tabular-nums tracking-tighter transition-transform duration-150",
              "text-[9rem] sm:text-[12rem]",
              targetReached ? "text-success" : "text-foreground",
              flash && "scale-110"
            )}
          >
            {count}
          </span>
          {targetReps ? (
            <span
              className={cn(
                "mt-1 text-base font-semibold",
                targetReached ? "text-success" : "text-muted-foreground"
              )}
            >
              {targetReached ? (
                <span className="inline-flex items-center gap-1">
                  <Check className="h-4 w-4" /> {count} / {targetReps}
                </span>
              ) : (
                `/ ${targetReps}`
              )}
            </span>
          ) : null}
          {!locked && (
            <span className="mt-1 flex items-center gap-1 text-sm font-medium text-muted-foreground">
              <span className="text-lg leading-none">－</span> tap bottom to remove
            </span>
          )}
          {locked && (
            <span className="mt-3 flex items-center gap-1.5 rounded-full bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground">
              <Lock className="h-3.5 w-3.5" /> Touch editing locked
            </span>
          )}
        </div>
      </div>

      {/* Status + sensor meter */}
      <div className="space-y-3 px-4 pt-3">
        <div className="flex items-center justify-between gap-3">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-sm font-medium",
              statusTone === "live" && "text-primary",
              statusTone === "done" && "text-success",
              statusTone === "locked" && "text-primary",
              (statusTone === "idle" || statusTone === "off") && "text-muted-foreground"
            )}
          >
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                statusTone === "live" && "animate-pulse bg-primary",
                statusTone === "done" && "bg-success",
                statusTone === "locked" && "bg-primary",
                statusTone === "idle" && "bg-muted-foreground",
                statusTone === "off" && "bg-muted-foreground/60"
              )}
            />
            {statusLabel}
          </span>
          <button
            onClick={() => setTune((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-accent tap"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Tune
          </button>
        </div>

        {/* Live motion meter (only meaningful while sensing). */}
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-100 ease-out",
              statusTone === "off" ? "bg-muted-foreground/40" : "bg-primary"
            )}
            style={{ width: `${listening ? Math.round(motion * 100) : 0}%` }}
          />
        </div>

        {/* Tuner */}
        {tune && (
          <div className="space-y-3 rounded-xl border border-border bg-card p-3 animate-fade-in">
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Activity className="h-3.5 w-3.5" /> Detection sensitivity
              </p>
              <SegmentedControl
                columns={3}
                options={sensitivityOptions}
                value={sensitivity}
                onChange={(v) => setSetting("repSensitivity", v)}
              />
              <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                Higher detects subtler reps; lower ignores small jitters. Tune per exercise.
              </p>
            </div>
            <button
              onClick={() => setSetting("repSound", !sound)}
              className="flex w-full items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm tap"
            >
              {sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              <span className="flex-1 text-left font-medium">Rep tick sound</span>
              <span className="text-xs text-muted-foreground">{sound ? "On" : "Off"}</span>
            </button>
          </div>
        )}
      </div>

      {/* Commit */}
      <div className="px-4 pb-4 pt-3 safe-bottom">
        <Button size="xl" variant="success" className="w-full" onClick={() => onLog(count)}>
          <Check className="h-5 w-5" />
          Log set · {count} reps
        </Button>
      </div>

      {/* First-run permission gate (iOS Safari) */}
      {needsPrompt && (
        <div className="absolute inset-0 z-10 flex items-end bg-black/70 backdrop-blur-sm animate-fade-in">
          <div className="w-full rounded-t-3xl border-t border-border bg-card p-6 animate-slide-up safe-bottom">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <Smartphone className="h-7 w-7" />
            </div>
            <h2 className="text-center text-lg font-bold">Count reps automatically</h2>
            <p className="mx-auto mt-2 max-w-xs text-center text-sm text-muted-foreground">
              Allow motion access and ForgeFit will count your reps from your phone's
              accelerometer — pocket it or strap it to an armband. You can always tap to
              correct the count.
            </p>
            <div className="mt-5 space-y-2">
              <Button size="lg" className="w-full" onClick={request}>
                <Activity className="h-5 w-5" />
                Enable motion sensors
              </Button>
              <Button size="lg" variant="ghost" className="w-full" onClick={() => setSkipSensor(true)}>
                Count manually instead
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Inline hint when granted but unusable (keeps manual fully working). */}
      {sensorUnavailable && !needsPrompt && (
        <div className="pointer-events-none absolute left-1/2 top-20 -translate-x-1/2 px-4">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-card/90 px-3 py-1.5 text-xs text-muted-foreground shadow-lg">
            {permission === "denied" ? (
              <ShieldAlert className="h-3.5 w-3.5" />
            ) : (
              <Target className="h-3.5 w-3.5" />
            )}
            Auto-count unavailable — tap to count
          </span>
        </div>
      )}
    </div>,
    document.body
  );
}
