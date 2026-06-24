import { cn } from "@/lib/utils";

// A clean circular progress ring (consumed vs target) with center content.
// SVG-only, no deps — sits comfortably in the dark theme.
export function MacroRing({
  value,
  target,
  size = 132,
  stroke = 11,
  className,
  trackClassName = "text-muted",
  ringClassName = "text-primary",
  children,
}: {
  value: number;
  target: number;
  size?: number;
  stroke?: number;
  className?: string;
  trackClassName?: string;
  ringClassName?: string;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = target > 0 ? Math.min(1, Math.max(0, value / target)) : 0;
  const offset = circ * (1 - pct);

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" strokeWidth={stroke}
          className={cn("stroke-current", trackClassName)}
        />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" strokeWidth={stroke} strokeLinecap="round"
          className={cn("stroke-current transition-[stroke-dashoffset] duration-700 ease-out", ringClassName)}
          strokeDasharray={circ}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {children}
      </div>
    </div>
  );
}

// A slim macro bar with consumed / target labels and a coloured fill.
export function MacroBar({
  label,
  value,
  target,
  unit = "g",
  colorClass,
  icon,
}: {
  label: string;
  value: number;
  target: number;
  unit?: string;
  colorClass: string; // e.g. "bg-sky-400"
  icon?: React.ReactNode;
}) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 font-medium text-foreground">
          {icon}
          {label}
        </span>
        <span className="text-muted-foreground tabular-nums">
          {Math.round(value)}
          <span className="opacity-60"> / {Math.round(target)}{unit}</span>
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all duration-500", colorClass)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
