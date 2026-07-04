import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function uid(prefix = "id"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Epley formula for estimated one-rep max. */
export function estimate1RM(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return 0;
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30));
}

export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function formatVolume(volume: number, units: "kg" | "lb"): string {
  if (volume >= 1000) return `${(volume / 1000).toFixed(1)}k ${units}`;
  return `${Math.round(volume)} ${units}`;
}

/** "420 kcal" / "1.2k kcal" for the calories-burned figure. */
export function formatCalories(kcal: number): string {
  const v = Math.round(kcal || 0);
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k kcal`;
  return `${v} kcal`;
}

// ── Distance units ────────────────────────────────────────────────────────────
// Distances are ALWAYS stored in kilometers; athletes on imperial weights (lb)
// see and enter miles. These helpers convert at the display boundary only.
const KM_PER_MILE = 1.609344;

export function distanceUnit(units: "kg" | "lb"): "km" | "mi" {
  return units === "lb" ? "mi" : "km";
}

/** Stored km → display value in the athlete's distance unit (2-decimal max). */
export function kmToDisplayDistance(km: number, units: "kg" | "lb"): number {
  const v = units === "lb" ? km / KM_PER_MILE : km;
  return Math.round(v * 100) / 100;
}

/** Display value (km or mi) → stored kilometers. */
export function displayDistanceToKm(value: number, units: "kg" | "lb"): number {
  const km = units === "lb" ? value * KM_PER_MILE : value;
  return Math.round(km * 1000) / 1000;
}

/** "5 km" / "3.11 mi" for a stored-km distance. */
export function formatDistance(km: number, units: "kg" | "lb"): string {
  return `${kmToDisplayDistance(km, units)} ${distanceUnit(units)}`;
}

/** Compact "45:00" / "1:02:00" label for a duration in seconds (cardio/holds). */
export function formatClock(totalSec: number): string {
  return formatDuration(totalSec);
}

/** Seconds → minutes, rounded, for compact summaries (e.g. "45 min"). */
export function minutesLabel(totalSec: number): string {
  return `${Math.round(totalSec / 60)} min`;
}

export function sessionVolume(
  exercises: { sets: { weight: number; reps: number; completed: boolean }[] }[]
): number {
  return exercises.reduce(
    (total, ex) =>
      total +
      ex.sets.reduce((v, s) => (s.completed ? v + s.weight * s.reps : v), 0),
    0
  );
}

const GOAL_LABELS: Record<string, string> = {
  strength: "Strength",
  hypertrophy: "Muscle (Hypertrophy)",
  weight_loss: "Weight Loss",
  endurance: "Endurance",
  general: "General Fitness",
};

export function goalLabel(goal: string): string {
  return GOAL_LABELS[goal] ?? goal;
}

/** Trigger a tiny haptic pulse where supported (Android/Chrome). */
export function haptic(ms = 12) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* no-op */
  }
}

// Lazily-created, shared AudioContext. Browsers cap the number of contexts a
// page may open, so we reuse one and resume it on demand (it can be suspended
// until the first user gesture).
let _audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    if (!_audioCtx) _audioCtx = new AC();
    if (_audioCtx.state === "suspended") void _audioCtx.resume();
    return _audioCtx;
  } catch {
    return null;
  }
}

/**
 * Play a crisp, short "tick" cue — used to confirm a logged rep without the
 * user needing to look at the screen. Best-effort: silently ignored where the
 * Web Audio API is blocked or unavailable.
 */
export function playTick(frequency = 1040) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "triangle";
    osc.frequency.value = frequency;
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.start(t);
    osc.stop(t + 0.13);
  } catch {
    /* no-op */
  }
}
