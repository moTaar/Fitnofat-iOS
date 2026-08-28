import { useEffect, useRef } from "react";
import { Plus, Minus, X, Timer } from "lucide-react";
import { useStore } from "@/lib/store";
import { useNow } from "@/lib/hooks";
import { formatDuration, haptic } from "@/lib/utils";
import { Progress } from "./ui/misc";

export function RestTimerBar() {
  const active = useStore((s) => s.active);
  const startRest = useStore((s) => s.startRest);
  const stopRest = useStore((s) => s.stopRest);
  const firedRef = useRef(false);

  const timer = active?.restTimer;
  const running = !!timer?.active && !!timer.endsAt;
  const now = useNow(running, 250);

  const remainingMs = running && timer?.endsAt ? timer.endsAt - now : 0;
  const remaining = Math.max(0, Math.ceil(remainingMs / 1000));

  useEffect(() => {
    if (!running) {
      firedRef.current = false;
      return;
    }
    if (remaining <= 0 && !firedRef.current) {
      firedRef.current = true;
      haptic(200);
      // Audible cue (best-effort; ignored if blocked).
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        osc.start();
        osc.stop(ctx.currentTime + 0.4);
      } catch {
        /* ignore */
      }
      stopRest();
    }
  }, [running, remaining, stopRest]);

  if (!running || !timer?.endsAt) return null;

  const pct = (remaining / timer.durationSec) * 100;

  const adjust = (delta: number) => {
    const newRemaining = Math.max(5, remaining + delta);
    startRest(newRemaining);
  };

  return (
    <div className="px-4 pb-2">
      <div className="rounded-2xl border border-primary/30 bg-card/95 p-3 shadow-2xl backdrop-blur animate-slide-up">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-primary">
            <Timer className="h-5 w-5" />
            <span className="font-mono text-2xl font-bold tabular-nums">
              {formatDuration(remaining)}
            </span>
          </div>
          <span className="text-sm text-muted-foreground">Rest</span>
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={() => adjust(-15)} className="rounded-lg bg-secondary p-2 tap">
              <Minus className="h-4 w-4" />
            </button>
            <button onClick={() => adjust(15)} className="rounded-lg bg-secondary p-2 tap">
              <Plus className="h-4 w-4" />
            </button>
            <button onClick={stopRest} className="rounded-lg bg-secondary p-2 tap">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <Progress value={pct} className="mt-2" />
      </div>
    </div>
  );
}
