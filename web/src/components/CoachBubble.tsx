import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { AiCoach } from "@/pages/AiCoach";

/**
 * Floating AI Coach launcher — a circular button tucked half-off the right
 * edge, just above the bottom nav. Tapping it expands the coach chat as a
 * bottom-sheet overlay. Replaces the old "Coach" nav tab.
 */
export function CoachBubble() {
  const [open, setOpen] = useState(false);
  const active = useStore((s) => s.active);

  // Raise the bubble above the ActiveWorkoutBanner when a workout is live so
  // they don't overlap (banner sits at bottom-[4.25rem], full width).
  const restRunning = !!active?.restTimer.active && !!active.restTimer.endsAt;
  const bannerVisible = !!active && !restRunning;

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open AI Coach"
          className={`fixed -right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-primary to-orange-600 text-white shadow-xl shadow-primary/30 tap animate-slide-up ${
            bannerVisible ? "bottom-36" : "bottom-24"
          }`}
        >
          {/* mr-5 offsets the icon left so it centers within the visible half */}
          <Sparkles className="h-6 w-6 mr-5" />
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <button
            aria-label="Close AI Coach"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in"
          />
          <div className="relative mx-auto flex h-[88dvh] w-full max-w-md flex-col rounded-t-3xl border border-border bg-background px-4 pb-3 shadow-2xl animate-slide-up">
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="absolute right-3 top-3 z-10 rounded-full bg-secondary p-1.5 text-muted-foreground tap hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
            <AiCoach embedded onClose={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
