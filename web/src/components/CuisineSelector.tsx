import { Globe, Croissant, Pizza, Soup, Citrus, Beef, Fish, type LucideIcon } from "lucide-react";
import type { Cuisine } from "@/lib/types";
import { cn, haptic } from "@/lib/utils";
import { Spinner } from "./ui/misc";

interface CuisineOption {
  value: Cuisine;
  label: string;
  icon: LucideIcon;
}

// Ordered chip list. "Standard/Any" first as the neutral default.
export const CUISINE_OPTIONS: CuisineOption[] = [
  { value: "standard", label: "Standard", icon: Globe },
  { value: "french", label: "French", icon: Croissant },
  { value: "italian", label: "Italian", icon: Pizza },
  { value: "korean", label: "Korean", icon: Soup },
  { value: "mediterranean", label: "Mediterranean", icon: Citrus },
  { value: "mexican", label: "Mexican", icon: Beef },
  { value: "japanese", label: "Japanese", icon: Fish },
];

export function cuisineLabel(c: Cuisine): string {
  return CUISINE_OPTIONS.find((o) => o.value === c)?.label ?? "Standard";
}

// Horizontal scrolling chip-list for picking the culinary style. Selecting a
// chip restyles the AI meal suggestions while keeping the macro targets fixed.
export function CuisineSelector({
  value,
  onSelect,
  disabled = false,
  pending = null,
  title = "Today's Culinary Style",
  bleed = true,
}: {
  value: Cuisine;
  onSelect: (c: Cuisine) => void;
  disabled?: boolean;
  pending?: Cuisine | null; // chip currently being applied (shows a spinner)
  title?: string;
  bleed?: boolean;          // bleed chips to the screen edges (page-level use)
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 px-1">
        <Globe className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className={cn("flex gap-2 overflow-x-auto no-scrollbar pb-1", bleed && "-mx-4 px-4")}>
        {CUISINE_OPTIONS.map(({ value: v, label, icon: Icon }) => {
          const active = v === value;
          const isPending = pending === v;
          return (
            <button
              key={v}
              onClick={() => {
                if (disabled || active) return;
                haptic();
                onSelect(v);
              }}
              disabled={disabled}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium tap transition-colors",
                "disabled:opacity-60",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-muted-foreground/40"
              )}
            >
              {isPending ? <Spinner className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
