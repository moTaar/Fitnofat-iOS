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
