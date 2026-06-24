// ── Smart Rep Counter — sensor engine ────────────────────────────────────────
// A lightweight, fully client-side accelerometer rep detector plus the
// capability/permission helpers needed to drive the DeviceMotion API across
// platforms (notably iOS Safari, which gates motion behind an explicit prompt).
//
// The detection algorithm is deliberately framework-agnostic and side-effect
// free so it stays easy to reason about and tune — the React glue lives in the
// useRepCounter hook (components/RepCounter.tsx).

import type { RepSensitivity } from "./types";

export type MotionPermission = "unsupported" | "prompt" | "granted" | "denied";

interface Thresholds {
  /** Smoothed linear-acceleration magnitude (m/s²) that arms a rep. */
  high: number;
  /** Magnitude the signal must fall back below before the next rep can count. */
  low: number;
}

// Higher sensitivity → lower thresholds → subtler movements register.
const PRESETS: Record<RepSensitivity, Thresholds> = {
  high: { high: 1.2, low: 0.6 },
  medium: { high: 2.2, low: 1.1 },
  low: { high: 3.6, low: 1.9 },
};

const REFRACTORY_MS = 320; // min spacing between reps (caps cadence ~180/min)
const MEAN_ALPHA = 0.92; // per-sample weight of the slow gravity/DC tracker
const MAG_ALPHA = 0.45; // magnitude smoothing (light, to preserve peaks)
const REARM_RATIO = 0.6; // re-arm once the signal falls to 60% of its peak

export interface MotionSample {
  x: number;
  y: number;
  z: number;
  t: number; // high-res timestamp (ms)
}

export interface DetectResult {
  rep: boolean; // a repetition was registered on this sample
  magnitude: number; // current smoothed linear-acceleration magnitude
}

/**
 * Peak detector with a refractory period and *peak-relative* re-arming.
 *
 * Each axis is high-pass filtered by subtracting a slow EMA, which removes the
 * gravity / DC offset — so it works equally well with `acceleration`
 * (gravity-free) and `accelerationIncludingGravity`. One rep is counted per
 * oscillation: the smoothed magnitude crossing above `high` registers a rep
 * (and disarms); the detector re-arms once the signal falls back to a fraction
 * of that rep's peak (or below `low`). Re-arming relative to the peak — rather
 * than a fixed floor — keeps detection robust across rep tempos and any
 * residual DC offset left by sustained movement.
 */
export class RepDetector {
  private mean = { x: 0, y: 0, z: 0 };
  private smooth = 0;
  private primed = false; // seed the mean from the first sample
  private armed = true; // ready to register the next peak
  private peak = 0; // highest magnitude seen since the last rep
  private lastRepAt = 0;
  private readonly high: number;
  private readonly low: number;

  constructor(sensitivity: RepSensitivity) {
    const t = PRESETS[sensitivity];
    this.high = t.high;
    this.low = t.low;
  }

  reset() {
    this.mean = { x: 0, y: 0, z: 0 };
    this.smooth = 0;
    this.primed = false;
    this.armed = true;
    this.peak = 0;
    this.lastRepAt = 0;
  }

  feed(s: MotionSample): DetectResult {
    if (!this.primed) {
      this.mean = { x: s.x, y: s.y, z: s.z };
      this.primed = true;
    } else {
      this.mean.x = MEAN_ALPHA * this.mean.x + (1 - MEAN_ALPHA) * s.x;
      this.mean.y = MEAN_ALPHA * this.mean.y + (1 - MEAN_ALPHA) * s.y;
      this.mean.z = MEAN_ALPHA * this.mean.z + (1 - MEAN_ALPHA) * s.z;
    }
    const lx = s.x - this.mean.x;
    const ly = s.y - this.mean.y;
    const lz = s.z - this.mean.z;
    const mag = Math.sqrt(lx * lx + ly * ly + lz * lz);
    this.smooth = MAG_ALPHA * mag + (1 - MAG_ALPHA) * this.smooth;

    let rep = false;
    if (this.armed) {
      if (this.smooth > this.high && s.t - this.lastRepAt > REFRACTORY_MS) {
        rep = true;
        this.armed = false;
        this.lastRepAt = s.t;
        this.peak = this.smooth;
      }
    } else {
      if (this.smooth > this.peak) this.peak = this.smooth;
      if (this.smooth < Math.max(this.low, this.peak * REARM_RATIO)) this.armed = true;
    }
    return { rep, magnitude: this.smooth };
  }
}

// ── Capability / permission helpers ──────────────────────────────────────────

type DMEStatic = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<PermissionState | "granted" | "denied">;
};

export function motionSupported(): boolean {
  return typeof window !== "undefined" && typeof window.DeviceMotionEvent !== "undefined";
}

/** iOS 13+ Safari requires an explicit, gesture-initiated permission prompt. */
export function motionNeedsPermission(): boolean {
  if (!motionSupported()) return false;
  const DME = window.DeviceMotionEvent as DMEStatic;
  return typeof DME.requestPermission === "function";
}

/** Best initial guess before the user acts (we can't query a prior grant). */
export function initialPermission(): MotionPermission {
  if (!motionSupported()) return "unsupported";
  return motionNeedsPermission() ? "prompt" : "granted";
}

/** Must be invoked from a user gesture on iOS, or the prompt is suppressed. */
export async function requestMotionPermission(): Promise<MotionPermission> {
  if (!motionSupported()) return "unsupported";
  const DME = window.DeviceMotionEvent as DMEStatic;
  if (typeof DME.requestPermission !== "function") return "granted";
  try {
    const res = await DME.requestPermission();
    return res === "granted" ? "granted" : "denied";
  } catch {
    return "denied";
  }
}

/**
 * Normalize a DeviceMotionEvent into a usable {x,y,z}. Prefers gravity-free
 * `acceleration`; falls back to `accelerationIncludingGravity` (the detector
 * removes the gravity component either way). Returns null when the device
 * reports no usable values.
 */
export function readMotion(e: DeviceMotionEvent): { x: number; y: number; z: number } | null {
  const a = e.acceleration;
  if (a && (a.x != null || a.y != null || a.z != null)) {
    return { x: a.x ?? 0, y: a.y ?? 0, z: a.z ?? 0 };
  }
  const g = e.accelerationIncludingGravity;
  if (g && (g.x != null || g.y != null || g.z != null)) {
    return { x: g.x ?? 0, y: g.y ?? 0, z: g.z ?? 0 };
  }
  return null;
}

/** Magnitude that maps to a full motion-meter bar, scaled by sensitivity. */
export function meterCeiling(sensitivity: RepSensitivity): number {
  return PRESETS[sensitivity].high * 2.2;
}
