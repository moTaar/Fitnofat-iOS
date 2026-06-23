import * as React from "react";
import { cn, haptic } from "@/lib/utils";

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: "default" | "outline" | "success" | "muted" }) {
  const variants = {
    default: "bg-primary/15 text-primary",
    outline: "border border-border text-muted-foreground",
    success: "bg-success/15 text-success",
    muted: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}

export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div
        className="h-full rounded-full bg-primary transition-all duration-500"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

interface Option<T> {
  label: string;
  value: T;
  sublabel?: string;
}

export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  columns = 2,
}: {
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
  columns?: number;
}) {
  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            onClick={() => {
              haptic();
              onChange(opt.value);
            }}
            className={cn(
              "flex flex-col items-center justify-center rounded-xl border px-3 py-3 text-center tap",
              active
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border bg-card text-muted-foreground hover:border-muted-foreground/40"
            )}
          >
            <span className="text-sm font-semibold">{opt.label}</span>
            {opt.sublabel && <span className="mt-0.5 text-xs opacity-70">{opt.sublabel}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent",
        className
      )}
    />
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border py-12 px-6 text-center">
      <div className="rounded-full bg-muted p-3 text-muted-foreground">{icon}</div>
      <div>
        <p className="font-semibold">{title}</p>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
