import { useState } from "react";
import {
  Search, X, Plus, ScanSearch, Flame, Drumstick, Wheat, Nut, Sparkles, Info,
} from "lucide-react";
import type { FoodLookupResult, MacroTargets } from "@/lib/types";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Modal } from "./ui/modal";
import { Badge, Spinner } from "./ui/misc";

// Horizontal stacked bar splitting a food's calories across protein/carbs/fats.
function MacroSplitBar({ macros }: { macros: MacroTargets }) {
  const p = macros.protein * 4;
  const c = macros.carbs * 4;
  const f = macros.fats * 9;
  const total = p + c + f || 1;
  const seg = (v: number) => `${(v / total) * 100}%`;
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
      <div className="bg-rose-400 transition-all" style={{ width: seg(p) }} />
      <div className="bg-amber-400 transition-all" style={{ width: seg(c) }} />
      <div className="bg-sky-400 transition-all" style={{ width: seg(f) }} />
    </div>
  );
}

function MacroStat({
  label, grams, icon, className,
}: { label: string; grams: number; icon: React.ReactNode; className: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-xl bg-secondary/50 py-2.5">
      <span className={cn("flex items-center gap-1 text-xs font-medium", className)}>
        {icon}
        {label}
      </span>
      <span className="text-base font-bold tabular-nums">{Math.round(grams)}g</span>
    </div>
  );
}

const CONFIDENCE_LABEL: Record<NonNullable<FoodLookupResult["confidence"]>, string> = {
  high: "High confidence",
  medium: "Estimated",
  low: "Rough estimate",
};

// AI-powered nutritional lookup. A prominent search bar; results slide up in a
// sheet with a visual macro breakdown and a one-tap "Add to Daily Tracker".
export function FoodLookup({ onLog }: { onLog: (food: FoodLookupResult) => void }) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<FoodLookupResult | null>(null);

  const search = async () => {
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    try {
      const { result } = await api.lookupFood(q);
      setResult(result);
      setOpen(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      toast.error(msg.includes("QUOTA") ? "AI quota hit — try again later." : "Lookup failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    if (!result) return;
    onLog(result);
    toast.success(`Added ${result.foodName} to today's tracker`);
    setOpen(false);
  };

  const isUnknown = !result || result.foodName.toLowerCase() === "unknown";

  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 px-1">
        <ScanSearch className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">L'apport nutritif</h2>
        <span className="text-xs text-muted-foreground">· Nutritional lookup</span>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="Search any food (e.g. '100g cooked salmon', 'un croissant')…"
            className="pl-9 pr-9 text-sm"
            enterKeyHint="search"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-accent tap"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Button onClick={search} disabled={busy || !query.trim()} size="icon" aria-label="Search food">
          {busy ? <Spinner className="h-5 w-5" /> : <Search className="h-5 w-5" />}
        </Button>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Nutritional breakdown">
        {isUnknown ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="rounded-full bg-muted p-3 text-muted-foreground">
              <Search className="h-6 w-6" />
            </div>
            <div>
              <p className="font-semibold">No food found</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {result?.notes || "Couldn't identify a food from that query. Try being more specific."}
              </p>
            </div>
          </div>
        ) : (
          result && (
            <div className="space-y-4">
              {/* Title + portion */}
              <div>
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-lg font-bold leading-tight">{result.foodName}</h3>
                  {result.confidence && (
                    <Badge variant={result.confidence === "high" ? "success" : "muted"}>
                      {CONFIDENCE_LABEL[result.confidence]}
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">{result.portion}</p>
              </div>

              {/* Calories + split bar */}
              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="mb-3 flex items-end justify-between">
                  <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Flame className="h-4 w-4 text-primary" />
                    Calories
                  </span>
                  <span className="text-2xl font-extrabold leading-none tabular-nums">
                    {Math.round(result.macros.calories)}
                    <span className="ml-1 text-sm font-medium text-muted-foreground">kcal</span>
                  </span>
                </div>
                <MacroSplitBar macros={result.macros} />
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <MacroStat label="Protein" grams={result.macros.protein}
                    icon={<Drumstick className="h-3.5 w-3.5" />} className="text-rose-400" />
                  <MacroStat label="Carbs" grams={result.macros.carbs}
                    icon={<Wheat className="h-3.5 w-3.5" />} className="text-amber-400" />
                  <MacroStat label="Fats" grams={result.macros.fats}
                    icon={<Nut className="h-3.5 w-3.5" />} className="text-sky-400" />
                </div>
              </div>

              {/* Micronutrients */}
              {result.micros && result.micros.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Key micronutrients
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {result.micros.map((m) => (
                      <span key={m.name}
                        className="inline-flex items-center gap-1 rounded-lg bg-secondary/60 px-2.5 py-1 text-xs">
                        <span className="font-medium">{m.name}</span>
                        <span className="text-muted-foreground tabular-nums">{m.amount}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {result.notes && (
                <p className="flex gap-2 rounded-xl bg-primary/5 p-3 text-xs text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  {result.notes}
                </p>
              )}

              <Button className="w-full" size="lg" onClick={add}>
                <Plus className="h-5 w-5" />
                Add to Daily Tracker
              </Button>
              <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
                <Sparkles className="h-3 w-3" />
                AI-analyzed nutritional data
              </p>
            </div>
          )
        )}
      </Modal>
    </div>
  );
}
