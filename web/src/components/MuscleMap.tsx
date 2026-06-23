// A compact, reusable anatomical muscle map (front + back silhouettes) that
// highlights the muscles an exercise trains. One SVG drives every exercise —
// the guide's `primaryMuscles` / `secondaryMuscles` strings are matched to
// regions, so adding it everywhere costs almost nothing.

type Props = {
  primary: string[];
  secondary?: string[];
  className?: string;
};

// Keyword (lowercased, substring-matched) → highlighted region ids.
const KEYWORD_REGIONS: Record<string, string[]> = {
  "upper chest": ["chest"],
  chest: ["chest"],
  "front delt": ["delts"],
  "rear delt": ["delts_b"],
  "side delt": ["delts", "delts_b"],
  shoulder: ["delts", "delts_b"],
  delt: ["delts", "delts_b"],
  trap: ["traps"],
  bicep: ["biceps"],
  tricep: ["triceps"],
  forearm: ["forearms"],
  "lower back": ["lowerback"],
  erector: ["lowerback"],
  lat: ["lats"],
  "upper back": ["lats", "traps"],
  "mid back": ["lats"],
  back: ["lats"],
  oblique: ["obliques"],
  core: ["abs"],
  ab: ["abs"],
  quad: ["quads"],
  hamstring: ["hamstrings"],
  glute: ["glutes"],
  calf: ["calves"],
  calves: ["calves"],
};

function regionsFor(names: string[]): Set<string> {
  const out = new Set<string>();
  for (const n of names) {
    const low = n.toLowerCase();
    for (const [kw, regs] of Object.entries(KEYWORD_REGIONS)) {
      if (low.includes(kw)) regs.forEach((r) => out.add(r));
    }
  }
  return out;
}

export function MuscleMap({ primary, secondary = [], className }: Props) {
  const prim = regionsFor(primary);
  const sec = regionsFor(secondary);

  const cls = (id: string) =>
    prim.has(id)
      ? "fill-primary"
      : sec.has(id)
        ? "fill-primary/40"
        : "fill-muted-foreground/20";

  // A muscle region (mirrored automatically when `mirror` is given a +/- x shift).
  const M = ({ id, ...rest }: { id: string } & React.SVGProps<SVGEllipseElement>) => (
    <ellipse className={cls(id)} {...rest} />
  );

  return (
    <svg
      viewBox="0 0 190 200"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Muscles worked diagram"
    >
      {/* ── FRONT ─────────────────────────────────────────────── */}
      <g>
        {/* structural (head/hands/feet) */}
        <circle cx="45" cy="13" r="9" className="fill-muted-foreground/20" />
        <rect x="41" y="20" width="8" height="6" rx="2" className="fill-muted-foreground/20" />
        {/* delts */}
        <M id="delts" cx="27" cy="33" rx="8" ry="7" />
        <M id="delts" cx="63" cy="33" rx="8" ry="7" />
        {/* chest */}
        <M id="chest" cx="38" cy="42" rx="9" ry="7" />
        <M id="chest" cx="52" cy="42" rx="9" ry="7" />
        {/* biceps */}
        <M id="biceps" cx="22" cy="52" rx="5" ry="11" />
        <M id="biceps" cx="68" cy="52" rx="5" ry="11" />
        {/* forearms */}
        <M id="forearms" cx="18" cy="73" rx="4.5" ry="11" />
        <M id="forearms" cx="72" cy="73" rx="4.5" ry="11" />
        {/* abs */}
        <rect x="38" y="51" width="14" height="24" rx="4" className={cls("abs")} />
        {/* obliques */}
        <M id="obliques" cx="33" cy="64" rx="3.2" ry="11" />
        <M id="obliques" cx="57" cy="64" rx="3.2" ry="11" />
        {/* quads */}
        <M id="quads" cx="37" cy="106" rx="7.5" ry="19" />
        <M id="quads" cx="53" cy="106" rx="7.5" ry="19" />
        {/* calves */}
        <M id="calves" cx="37" cy="152" rx="5.5" ry="15" />
        <M id="calves" cx="53" cy="152" rx="5.5" ry="15" />
        {/* feet */}
        <circle cx="37" cy="172" r="4" className="fill-muted-foreground/20" />
        <circle cx="53" cy="172" r="4" className="fill-muted-foreground/20" />
        <text x="45" y="192" textAnchor="middle" className="fill-muted-foreground text-[9px] font-medium">
          Front
        </text>
      </g>

      {/* ── BACK ──────────────────────────────────────────────── */}
      <g transform="translate(100,0)">
        <circle cx="45" cy="13" r="9" className="fill-muted-foreground/20" />
        {/* traps */}
        <path d="M33 26 L57 26 L52 40 L38 40 Z" className={cls("traps")} />
        {/* rear delts */}
        <M id="delts_b" cx="26" cy="34" rx="7.5" ry="7" />
        <M id="delts_b" cx="64" cy="34" rx="7.5" ry="7" />
        {/* triceps */}
        <M id="triceps" cx="22" cy="52" rx="5" ry="11" />
        <M id="triceps" cx="68" cy="52" rx="5" ry="11" />
        {/* forearms */}
        <M id="forearms" cx="18" cy="73" rx="4.5" ry="11" />
        <M id="forearms" cx="72" cy="73" rx="4.5" ry="11" />
        {/* lats */}
        <M id="lats" cx="34" cy="54" rx="7" ry="14" />
        <M id="lats" cx="56" cy="54" rx="7" ry="14" />
        {/* lower back */}
        <rect x="38" y="68" width="14" height="13" rx="3" className={cls("lowerback")} />
        {/* glutes */}
        <M id="glutes" cx="38" cy="92" rx="7.5" ry="8" />
        <M id="glutes" cx="52" cy="92" rx="7.5" ry="8" />
        {/* hamstrings */}
        <M id="hamstrings" cx="37" cy="116" rx="7.5" ry="17" />
        <M id="hamstrings" cx="53" cy="116" rx="7.5" ry="17" />
        {/* calves */}
        <M id="calves" cx="37" cy="154" rx="5.5" ry="15" />
        <M id="calves" cx="53" cy="154" rx="5.5" ry="15" />
        <circle cx="37" cy="174" r="4" className="fill-muted-foreground/20" />
        <circle cx="53" cy="174" r="4" className="fill-muted-foreground/20" />
        <text x="45" y="192" textAnchor="middle" className="fill-muted-foreground text-[9px] font-medium">
          Back
        </text>
      </g>
    </svg>
  );
}
