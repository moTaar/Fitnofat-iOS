// A compact, reusable anatomical muscle map (front + back silhouettes). One SVG
// drives two views: `MuscleMap` highlights the muscles an exercise trains (the
// guide's `primaryMuscles` / `secondaryMuscles` strings are matched to regions),
// and `MuscleHeatMap` shades every region by how hard it's been trained lately.

import type { SVGProps } from "react";
import { regionsFor, type MuscleRegion } from "@/lib/muscles";
import { cn } from "@/lib/utils";

const BASE = "fill-muted-foreground/20";

/**
 * How one region is drawn. `className` alone gives a flat fill; `heat` (0–1)
 * lays the primary colour at that opacity over the neutral base, so a faded
 * muscle still reads as part of the body.
 */
type Paint = (id: MuscleRegion) => { className?: string; heat?: number };

type ShapeProps =
  | ({ shape: "ellipse" } & SVGProps<SVGEllipseElement>)
  | ({ shape: "rect" } & SVGProps<SVGRectElement>)
  | ({ shape: "path" } & SVGProps<SVGPathElement>);

function BodyDiagram({
  paint,
  className,
  label,
  selected,
  onSelect,
}: {
  paint: Paint;
  className?: string;
  label: string;
  selected?: MuscleRegion | null;
  onSelect?: (id: MuscleRegion) => void;
}) {
  const R = ({ id, ...shapeProps }: { id: MuscleRegion } & ShapeProps) => {
    const { className: cls, heat } = paint(id);
    const draw = (extra: { className?: string; fillOpacity?: number }) => {
      const { shape, ...attrs } = shapeProps as ShapeProps;
      if (shape === "ellipse") return <ellipse {...(attrs as SVGProps<SVGEllipseElement>)} {...extra} />;
      if (shape === "rect") return <rect {...(attrs as SVGProps<SVGRectElement>)} {...extra} />;
      return <path {...(attrs as SVGProps<SVGPathElement>)} {...extra} />;
    };
    const isSelected = selected === id;
    return (
      <g
        onClick={onSelect ? () => onSelect(id) : undefined}
        className={cn(onSelect && "cursor-pointer")}
      >
        {heat === undefined ? (
          draw({ className: cls })
        ) : (
          <>
            {draw({ className: BASE })}
            {heat > 0 && draw({ className: "fill-primary", fillOpacity: heat })}
          </>
        )}
        {isSelected && draw({ className: "fill-none stroke-foreground", fillOpacity: 1 })}
      </g>
    );
  };

  const E = (p: { id: MuscleRegion } & SVGProps<SVGEllipseElement>) => <R shape="ellipse" {...p} />;

  return (
    <svg
      viewBox="0 0 190 200"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={label}
    >
      {/* ── FRONT ─────────────────────────────────────────────── */}
      <g>
        {/* structural (head/neck/feet) */}
        <circle cx="45" cy="13" r="9" className={BASE} />
        <rect x="41" y="20" width="8" height="6" rx="2" className={BASE} />
        <E id="delts" cx="27" cy="33" rx="8" ry="7" />
        <E id="delts" cx="63" cy="33" rx="8" ry="7" />
        <E id="chest" cx="38" cy="42" rx="9" ry="7" />
        <E id="chest" cx="52" cy="42" rx="9" ry="7" />
        <E id="biceps" cx="22" cy="52" rx="5" ry="11" />
        <E id="biceps" cx="68" cy="52" rx="5" ry="11" />
        <E id="forearms" cx="18" cy="73" rx="4.5" ry="11" />
        <E id="forearms" cx="72" cy="73" rx="4.5" ry="11" />
        <R id="abs" shape="rect" x="38" y="51" width="14" height="24" rx="4" />
        <E id="obliques" cx="33" cy="64" rx="3.2" ry="11" />
        <E id="obliques" cx="57" cy="64" rx="3.2" ry="11" />
        <E id="quads" cx="37" cy="106" rx="7.5" ry="19" />
        <E id="quads" cx="53" cy="106" rx="7.5" ry="19" />
        <E id="calves" cx="37" cy="152" rx="5.5" ry="15" />
        <E id="calves" cx="53" cy="152" rx="5.5" ry="15" />
        <circle cx="37" cy="172" r="4" className={BASE} />
        <circle cx="53" cy="172" r="4" className={BASE} />
        <text x="45" y="192" textAnchor="middle" className="fill-muted-foreground text-[9px] font-medium">
          Front
        </text>
      </g>

      {/* ── BACK ──────────────────────────────────────────────── */}
      <g transform="translate(100,0)">
        <circle cx="45" cy="13" r="9" className={BASE} />
        <R id="traps" shape="path" d="M33 26 L57 26 L52 40 L38 40 Z" />
        <E id="delts_b" cx="26" cy="34" rx="7.5" ry="7" />
        <E id="delts_b" cx="64" cy="34" rx="7.5" ry="7" />
        <E id="triceps" cx="22" cy="52" rx="5" ry="11" />
        <E id="triceps" cx="68" cy="52" rx="5" ry="11" />
        <E id="forearms" cx="18" cy="73" rx="4.5" ry="11" />
        <E id="forearms" cx="72" cy="73" rx="4.5" ry="11" />
        <E id="lats" cx="34" cy="54" rx="7" ry="14" />
        <E id="lats" cx="56" cy="54" rx="7" ry="14" />
        <R id="lowerback" shape="rect" x="38" y="68" width="14" height="13" rx="3" />
        <E id="glutes" cx="38" cy="92" rx="7.5" ry="8" />
        <E id="glutes" cx="52" cy="92" rx="7.5" ry="8" />
        <E id="hamstrings" cx="37" cy="116" rx="7.5" ry="17" />
        <E id="hamstrings" cx="53" cy="116" rx="7.5" ry="17" />
        <E id="calves" cx="37" cy="154" rx="5.5" ry="15" />
        <E id="calves" cx="53" cy="154" rx="5.5" ry="15" />
        <circle cx="37" cy="174" r="4" className={BASE} />
        <circle cx="53" cy="174" r="4" className={BASE} />
        <text x="45" y="192" textAnchor="middle" className="fill-muted-foreground text-[9px] font-medium">
          Back
        </text>
      </g>
    </svg>
  );
}

/** Highlights the muscles one exercise trains. */
export function MuscleMap({
  primary,
  secondary = [],
  className,
}: {
  primary: string[];
  secondary?: string[];
  className?: string;
}) {
  const prim = regionsFor(primary);
  const sec = regionsFor(secondary);
  return (
    <BodyDiagram
      className={className}
      label="Muscles worked diagram"
      paint={(id) => ({
        className: prim.has(id) ? "fill-primary" : sec.has(id) ? "fill-primary/40" : BASE,
      })}
    />
  );
}

// Keeps an untrained-but-not-forgotten muscle visibly tinted: below this the
// colour would be indistinguishable from never trained at all.
const MIN_VISIBLE_HEAT = 0.08;

/** Shades every region by its recent training intensity (0–1). */
export function MuscleHeatMap({
  intensity,
  className,
  selected,
  onSelect,
}: {
  intensity: Record<MuscleRegion, number>;
  className?: string;
  selected?: MuscleRegion | null;
  onSelect?: (id: MuscleRegion) => void;
}) {
  return (
    <BodyDiagram
      className={className}
      label="Training intensity by muscle"
      selected={selected}
      onSelect={onSelect}
      paint={(id) => {
        const v = intensity[id] ?? 0;
        return { heat: v <= 0.01 ? 0 : Math.max(MIN_VISIBLE_HEAT, v) };
      }}
    />
  );
}
