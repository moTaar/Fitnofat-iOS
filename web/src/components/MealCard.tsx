import { Check, Drumstick, Wheat, Nut, Salad, Droplets, UtensilsCrossed, Clock } from "lucide-react";
import type { FoodKind, Meal } from "@/lib/types";
import { cn, haptic } from "@/lib/utils";
import { Badge } from "./ui/misc";

// Real-world food kind → icon + accent colour (shared with the macro bars).
const KIND_META: Record<FoodKind, { icon: typeof Drumstick; color: string; bg: string }> = {
  protein:   { icon: Drumstick,      color: "text-rose-400",   bg: "bg-rose-400/10" },
  carb:      { icon: Wheat,          color: "text-amber-400",  bg: "bg-amber-400/10" },
  fat:       { icon: Nut,            color: "text-sky-400",    bg: "bg-sky-400/10" },
  veg:       { icon: Salad,          color: "text-emerald-400",bg: "bg-emerald-400/10" },
  hydration: { icon: Droplets,       color: "text-cyan-400",   bg: "bg-cyan-400/10" },
  other:     { icon: UtensilsCrossed,color: "text-muted-foreground", bg: "bg-muted" },
};

const SLOT_LABEL: Record<Meal["slot"], string> = {
  pre_workout: "Pre-workout",
  post_workout: "Post-workout",
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

export function mealKey(m: Meal) {
  return `${m.slot}:${m.name}`;
}

export function MealCard({
  meal,
  checked,
  onToggle,
}: {
  meal: Meal;
  checked: boolean;
  onToggle: () => void;
}) {
  const isWorkoutMeal = meal.slot === "pre_workout" || meal.slot === "post_workout";

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border transition-colors",
        checked ? "border-success/40 bg-success/5" : "border-border bg-card"
      )}
    >
      {/* Header — large tap target toggles the meal complete. */}
      <button
        onClick={() => { haptic(); onToggle(); }}
        className="flex w-full items-center gap-3 p-4 text-left tap"
      >
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
            checked ? "border-success bg-success text-success-foreground" : "border-border text-transparent"
          )}
        >
          <Check className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className={cn("font-semibold leading-tight", checked && "line-through opacity-60")}>
              {meal.name}
            </p>
            <Badge variant={isWorkoutMeal ? "default" : "muted"}>{SLOT_LABEL[meal.slot]}</Badge>
          </div>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {meal.timing}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-bold leading-none">{Math.round(meal.macros.calories)}</p>
          <p className="text-[10px] text-muted-foreground">kcal</p>
        </div>
      </button>

      {/* Macro chips */}
      <div className="flex gap-1.5 px-4">
        <MacroChip label="P" grams={meal.macros.protein} className="text-rose-400" />
        <MacroChip label="C" grams={meal.macros.carbs} className="text-amber-400" />
        <MacroChip label="F" grams={meal.macros.fats} className="text-sky-400" />
      </div>

      {/* Portions */}
      <div className="mt-3 space-y-1.5 px-4 pb-4">
        {meal.items.map((item, i) => {
          const meta = KIND_META[item.kind] ?? KIND_META.other;
          const Icon = meta.icon;
          return (
            <div key={i} className="flex items-center gap-2.5 rounded-xl bg-secondary/50 px-3 py-2">
              <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", meta.bg)}>
                <Icon className={cn("h-4 w-4", meta.color)} />
              </div>
              <span className="min-w-0 flex-1 truncate text-sm">{item.food}</span>
              <span className="shrink-0 text-xs font-medium tabular-nums">{item.amount}</span>
              <span className="shrink-0 rounded-md bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {item.visual}
              </span>
            </div>
          );
        })}
        {meal.note && (
          <p className="px-1 pt-1 text-xs italic text-muted-foreground">{meal.note}</p>
        )}
      </div>
    </div>
  );
}

function MacroChip({ label, grams, className }: { label: string; grams: number; className?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-secondary/60 px-2 py-0.5 text-[11px] font-medium tabular-nums">
      <span className={cn("font-bold", className)}>{label}</span>
      {Math.round(grams)}g
    </span>
  );
}
