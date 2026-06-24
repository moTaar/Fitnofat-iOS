import { useEffect, useMemo, useRef } from "react";
import { animationFor, type Load, type Pose, type Prop, type Pt } from "@/lib/animations";

// Renders a looping stick-figure demo for an exercise. Animation is driven by
// requestAnimationFrame mutating SVG attributes directly (no React re-renders),
// so it stays smooth and cheap. When the exercise's AI guide supplies a movement
// `pattern` (+ optional load/prop) the demo follows it; otherwise it's inferred
// from the name.
export function StickDemo({
  name,
  pattern,
  load,
  prop,
  className,
}: {
  name: string;
  pattern?: string;
  load?: Load;
  prop?: Prop;
  className?: string;
}) {
  const anim = useMemo(
    () => animationFor(name, { pattern, load, prop }),
    [name, pattern, load, prop]
  );
  const refs = useRef<Record<string, SVGElement | null>>({});

  useEffect(() => {
    const [a, b] = anim.frames;
    let raf = 0;
    let start = 0;
    const ease = (t: number) => t * t * (3 - 2 * t); // smoothstep

    const lerpPt = (p: Pt, q: Pt, t: number): Pt => [
      p[0] + (q[0] - p[0]) * t,
      p[1] + (q[1] - p[1]) * t,
    ];

    const apply = (pose: Pose) => {
      const line = (id: string, p: Pt, q: Pt) => {
        const el = refs.current[id];
        if (!el) return;
        el.setAttribute("x1", String(p[0]));
        el.setAttribute("y1", String(p[1]));
        el.setAttribute("x2", String(q[0]));
        el.setAttribute("y2", String(q[1]));
      };
      const dot = (id: string, p: Pt) => {
        const el = refs.current[id];
        if (!el) return;
        el.setAttribute("cx", String(p[0]));
        el.setAttribute("cy", String(p[1]));
      };
      line("neck", pose.head, pose.sh);
      line("spine", pose.sh, pose.hip);
      line("uarm", pose.sh, pose.el);
      line("farm", pose.el, pose.ha);
      line("thigh", pose.hip, pose.kn);
      line("shin", pose.kn, pose.ft);
      dot("head", pose.head);

      // Barbell: thin shaft + thick plate caps at each end.
      if (anim.load === "bar") {
        line("bar",  [pose.ha[0] - 13, pose.ha[1]], [pose.ha[0] + 13, pose.ha[1]]);
        line("barL", [pose.ha[0] - 13, pose.ha[1] - 5], [pose.ha[0] - 13, pose.ha[1] + 5]);
        line("barR", [pose.ha[0] + 13, pose.ha[1] - 5], [pose.ha[0] + 13, pose.ha[1] + 5]);
      }
      // Dumbbell: two disc heads with a short connecting handle.
      if (anim.load === "db") {
        dot("dbL", [pose.ha[0] - 6, pose.ha[1]]);
        dot("dbR", [pose.ha[0] + 6, pose.ha[1]]);
        line("dbShaft", [pose.ha[0] - 3, pose.ha[1]], [pose.ha[0] + 3, pose.ha[1]]);
      }
    };

    const loop = (ts: number) => {
      if (!start) start = ts;
      const dur = anim.speedMs;
      const phase = ((ts - start) % (dur * 2)) / dur; // 0..2
      const t = ease(phase <= 1 ? phase : 2 - phase);
      apply({
        head: lerpPt(a.head, b.head, t),
        sh:   lerpPt(a.sh,   b.sh,   t),
        el:   lerpPt(a.el,   b.el,   t),
        ha:   lerpPt(a.ha,   b.ha,   t),
        hip:  lerpPt(a.hip,  b.hip,  t),
        kn:   lerpPt(a.kn,   b.kn,   t),
        ft:   lerpPt(a.ft,   b.ft,   t),
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [anim]);

  const set = (id: string) => (el: SVGElement | null) => {
    refs.current[id] = el;
  };

  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`Animated demo of ${name}`}
    >
      {/* prop / context */}
      {anim.prop === "floor" && (
        <line x1="6" y1="92" x2="94" y2="92" className="stroke-muted-foreground/30" strokeWidth="1.5" />
      )}
      {anim.prop === "bench" && (
        <rect x="20" y="66" width="56" height="6" rx="2" className="fill-muted-foreground/25" />
      )}
      {anim.prop === "seat" && (
        <>
          <rect x="40" y="62" width="22" height="5" rx="2" className="fill-muted-foreground/25" />
          <rect x="38" y="40" width="5"  height="24" rx="2" className="fill-muted-foreground/25" />
        </>
      )}

      {/* figure — strokes share the primary color */}
      <g className="stroke-primary" strokeWidth="3" strokeLinecap="round" fill="none">
        <line ref={set("spine")} />
        <line ref={set("thigh")} />
        <line ref={set("shin")} />
        <line ref={set("uarm")} />
        <line ref={set("farm")} />
        <line ref={set("neck")} />
      </g>
      <circle ref={set("head")} r="6" className="fill-primary" />

      {/* ── equipment — steel blue, distinct from the orange figure ── */}

      {/* Barbell: thin shaft + thick plate caps */}
      {anim.load === "bar" && (
        <g className="stroke-sky-400" strokeLinecap="round" fill="none">
          <line ref={set("bar")}  strokeWidth="2" />
          <line ref={set("barL")} strokeWidth="5" />
          <line ref={set("barR")} strokeWidth="5" />
        </g>
      )}

      {/* Dumbbell: two disc heads + short handle */}
      {anim.load === "db" && (
        <g strokeLinecap="round">
          <line ref={set("dbShaft")} className="stroke-sky-400" strokeWidth="2.5" fill="none" />
          <circle ref={set("dbL")} r="4" className="fill-sky-400" />
          <circle ref={set("dbR")} r="4" className="fill-sky-400" />
        </g>
      )}
    </svg>
  );
}
