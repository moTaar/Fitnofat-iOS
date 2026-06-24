import { useEffect, useMemo, useState } from "react";
import {
  Apple, Flame, Droplets, Sparkles, Dumbbell, Moon, Sliders, Salad,
  Drumstick, Wheat, Nut, Info,
} from "lucide-react";
import { useStore, todayKey } from "@/lib/store";
import { toast } from "@/lib/toast";
import type { ActivityLevel, DietGoal, MacroTargets, Sex, UserProfile } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Badge, SegmentedControl, Spinner } from "@/components/ui/misc";
import { MacroRing, MacroBar } from "@/components/MacroRing";
import { MealCard, mealKey } from "@/components/MealCard";
import { cn } from "@/lib/utils";

const RESTRICTION_PRESETS = ["Vegan", "Vegetarian", "Keto", "Gluten-free", "Dairy-free", "Nut allergy"];

const emptyMacros: MacroTargets = { calories: 0, protein: 0, carbs: 0, fats: 0 };

export function Nutrition() {
  const profile = useStore((s) => s.profile);
  const plan = useStore((s) => s.nutritionPlan);
  const log = useStore((s) => s.nutritionLog);
  const history = useStore((s) => s.history);
  const generateNutrition = useStore((s) => s.generateNutrition);
  const setNutritionDayType = useStore((s) => s.setNutritionDayType);
  const toggleMeal = useStore((s) => s.toggleMeal);

  const trainedToday = useMemo(
    () => history.some((h) => new Date(h.startedAt).toDateString() === new Date().toDateString()),
    [history]
  );

  const today = todayKey();
  const logForToday = log?.date === today ? log : null;
  const [dayType, setDayType] = useState<"training" | "rest">(
    logForToday?.dayType ?? (trainedToday ? "training" : "rest")
  );
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  // Persist the resolved day type for today on first view so the offline log
  // and the dashboard agree.
  useEffect(() => {
    setNutritionDayType(dayType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayType]);

  const changeDay = (t: "training" | "rest") => {
    setDayType(t);
  };

  const day = plan ? (dayType === "training" ? plan.trainingDay : plan.restDay) : null;
  const checked = logForToday?.checkedMeals ?? [];

  const consumed = useMemo<MacroTargets>(() => {
    if (!day) return emptyMacros;
    return day.meals.reduce<MacroTargets>((acc, m) => {
      if (!checked.includes(mealKey(m))) return acc;
      return {
        calories: acc.calories + m.macros.calories,
        protein: acc.protein + m.macros.protein,
        carbs: acc.carbs + m.macros.carbs,
        fats: acc.fats + m.macros.fats,
      };
    }, { ...emptyMacros });
  }, [day, checked]);

  const handleGenerate = async (patch?: Partial<UserProfile>) => {
    setBusy(true);
    try {
      await generateNutrition(patch);
      setEditing(false);
      toast.success(plan ? "Nutrition plan updated!" : "Your nutrition plan is ready!");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      toast.error(msg.includes("QUOTA") ? "AI quota hit — try again later." : msg || "Couldn't build the plan.");
    } finally {
      setBusy(false);
    }
  };

  // ── First-run / editing: metabolic setup form ──
  if (!plan || editing) {
    return (
      <SetupForm
        profile={profile}
        busy={busy}
        showCancel={!!plan}
        onCancel={() => setEditing(false)}
        onSubmit={handleGenerate}
      />
    );
  }

  const remaining = Math.max(0, Math.round(day!.targets.calories - consumed.calories));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-2">
          <div className="rounded-xl bg-primary/15 p-2 text-primary">
            <Apple className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold leading-tight tracking-tight">Nutrition</h1>
            <p className="text-xs text-muted-foreground">{plan.strategy} · v{plan.iteration}</p>
          </div>
        </div>
        <button
          onClick={() => setEditing(true)}
          className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-muted-foreground tap"
        >
          <Sliders className="h-3.5 w-3.5" />
          Edit
        </button>
      </div>

      {/* Training vs rest day toggle */}
      <SegmentedControl<"training" | "rest">
        value={dayType}
        onChange={changeDay}
        options={[
          { label: "Training day", value: "training" },
          { label: "Rest day", value: "rest" },
        ]}
      />
      <p className="-mt-3 flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
        {dayType === "training" ? <Dumbbell className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        {dayType === "training"
          ? "More carbs today to fuel and recover from your session."
          : "Carbs trimmed, leaning on fats — protein stays high."}
      </p>

      {/* Macro dashboard */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-5">
            <MacroRing value={consumed.calories} target={day!.targets.calories}>
              <Flame className="h-4 w-4 text-primary" />
              <p className="mt-0.5 text-2xl font-extrabold leading-none tabular-nums">
                {Math.round(consumed.calories)}
              </p>
              <p className="text-[10px] text-muted-foreground">
                / {Math.round(day!.targets.calories)} kcal
              </p>
            </MacroRing>
            <div className="flex-1 space-y-3">
              <MacroBar
                label="Protein" value={consumed.protein} target={day!.targets.protein}
                colorClass="bg-rose-400" icon={<Drumstick className="h-3.5 w-3.5 text-rose-400" />}
              />
              <MacroBar
                label="Carbs" value={consumed.carbs} target={day!.targets.carbs}
                colorClass="bg-amber-400" icon={<Wheat className="h-3.5 w-3.5 text-amber-400" />}
              />
              <MacroBar
                label="Fats" value={consumed.fats} target={day!.targets.fats}
                colorClass="bg-sky-400" icon={<Nut className="h-3.5 w-3.5 text-sky-400" />}
              />
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-sm">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Droplets className="h-4 w-4 text-cyan-400" />
              Hydration
            </span>
            <span className="font-semibold">{day!.hydrationLiters} L</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Calories remaining</span>
            <span className="font-semibold tabular-nums">{remaining} kcal</span>
          </div>
        </CardContent>
      </Card>

      {/* Meals */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <Salad className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {dayType === "training" ? "Training-day meals" : "Rest-day meals"}
          </h2>
          <span className="ml-auto text-xs text-muted-foreground">
            {checked.filter((k) => day!.meals.some((m) => mealKey(m) === k)).length}/{day!.meals.length} done
          </span>
        </div>
        <div className="space-y-2.5">
          {day!.meals.map((m) => (
            <MealCard
              key={mealKey(m)}
              meal={m}
              checked={checked.includes(mealKey(m))}
              onToggle={() => toggleMeal(mealKey(m))}
            />
          ))}
        </div>
      </div>

      {/* Strategy summary */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex gap-3 p-4">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-sm text-muted-foreground">{plan.summary}</p>
        </CardContent>
      </Card>

      {/* Regenerate */}
      <Button variant="outline" className="w-full" onClick={() => handleGenerate()} disabled={busy}>
        {busy ? <Spinner /> : <Sparkles className="h-4 w-4" />}
        {busy ? "Rebuilding plan…" : "Regenerate from current training"}
      </Button>
    </div>
  );
}

// ── Metabolic setup / edit form ────────────────────────────────────────────────
function SetupForm({
  profile,
  busy,
  showCancel,
  onCancel,
  onSubmit,
}: {
  profile: UserProfile | null;
  busy: boolean;
  showCancel: boolean;
  onCancel: () => void;
  onSubmit: (patch: Partial<UserProfile>) => void;
}) {
  const [height, setHeight] = useState(profile?.heightCm?.toString() ?? "");
  const [age, setAge] = useState(profile?.age?.toString() ?? "");
  const [weight, setWeight] = useState(profile?.bodyweightKg?.toString() ?? "");
  const [sex, setSex] = useState<Sex>(profile?.sex ?? "male");
  const [activity, setActivity] = useState<ActivityLevel>(profile?.activityLevel ?? "light");
  const [dietGoal, setDietGoal] = useState<DietGoal>(profile?.dietGoal ?? "recomp");
  const [restrictions, setRestrictions] = useState<string[]>(profile?.dietRestrictions ?? []);
  const [customRestriction, setCustomRestriction] = useState("");

  const toggleRestriction = (r: string) =>
    setRestrictions((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));

  const addCustom = () => {
    const v = customRestriction.trim();
    if (v && !restrictions.includes(v)) setRestrictions((p) => [...p, v]);
    setCustomRestriction("");
  };

  const submit = () => {
    onSubmit({
      heightCm: height ? Number(height) : undefined,
      age: age ? Number(age) : undefined,
      bodyweightKg: weight ? Number(weight) : undefined,
      sex,
      activityLevel: activity,
      dietGoal,
      dietRestrictions: restrictions,
    });
  };

  return (
    <div className="space-y-5 pb-4">
      <div className="pt-2">
        <div className="mb-2 flex items-center gap-2">
          <div className="rounded-xl bg-primary/15 p-2 text-primary">
            <Apple className="h-5 w-5" />
          </div>
          <h1 className="text-lg font-extrabold tracking-tight">
            {showCancel ? "Edit your details" : "AI Nutrition Planner"}
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          We’ll build training-day & rest-day meal plans with exact portions, tuned to your body and
          your current program. Your workout volume drives the carbs and calories.
        </p>
      </div>

      {/* Body metrics */}
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Weight (kg)</Label>
              <Input className="mt-1.5" type="number" inputMode="decimal" placeholder="75"
                value={weight} onChange={(e) => setWeight(e.target.value)} />
            </div>
            <div>
              <Label>Height (cm)</Label>
              <Input className="mt-1.5" type="number" inputMode="decimal" placeholder="178"
                value={height} onChange={(e) => setHeight(e.target.value)} />
            </div>
            <div>
              <Label>Age</Label>
              <Input className="mt-1.5" type="number" inputMode="numeric" placeholder="28"
                value={age} onChange={(e) => setAge(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Sex</Label>
            <div className="mt-1.5">
              <SegmentedControl<Sex>
                columns={3}
                value={sex}
                onChange={setSex}
                options={[
                  { label: "Male", value: "male" },
                  { label: "Female", value: "female" },
                  { label: "Other", value: "other" },
                ]}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Activity level */}
      <div>
        <Label className="mb-1.5 block">Daily activity (outside the gym)</Label>
        <SegmentedControl<ActivityLevel>
          columns={2}
          value={activity}
          onChange={setActivity}
          options={[
            { label: "Sedentary", value: "sedentary", sublabel: "Desk job" },
            { label: "Light", value: "light", sublabel: "On feet some" },
            { label: "Moderate", value: "moderate", sublabel: "Active job" },
            { label: "Very active", value: "very_active", sublabel: "Manual labour" },
          ]}
        />
      </div>

      {/* Diet goal */}
      <div>
        <Label className="mb-1.5 block">Nutrition goal</Label>
        <SegmentedControl<DietGoal>
          columns={2}
          value={dietGoal}
          onChange={setDietGoal}
          options={[
            { label: "Lean mass gain", value: "lean_gain", sublabel: "Slight surplus" },
            { label: "Recomposition", value: "recomp", sublabel: "Cycle calories" },
            { label: "Maintain", value: "maintain", sublabel: "Hold weight" },
            { label: "Fat loss", value: "deficit", sublabel: "Steady deficit" },
            { label: "Aggressive cut", value: "aggressive_deficit", sublabel: "Fast deficit" },
          ]}
        />
      </div>

      {/* Dietary restrictions */}
      <div>
        <Label className="mb-1.5 block">Dietary restrictions & allergies</Label>
        <div className="flex flex-wrap gap-1.5">
          {RESTRICTION_PRESETS.map((r) => (
            <button
              key={r}
              onClick={() => toggleRestriction(r)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium tap transition-colors",
                restrictions.includes(r)
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
              )}
            >
              {r}
            </button>
          ))}
          {restrictions
            .filter((r) => !RESTRICTION_PRESETS.includes(r))
            .map((r) => (
              <button
                key={r}
                onClick={() => toggleRestriction(r)}
                className="rounded-full border border-primary bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground tap"
              >
                {r} ✕
              </button>
            ))}
        </div>
        <div className="mt-2 flex gap-2">
          <Input
            placeholder="Add custom (e.g. no shellfish)"
            value={customRestriction}
            onChange={(e) => setCustomRestriction(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addCustom()}
          />
          <Button variant="outline" onClick={addCustom} disabled={!customRestriction.trim()}>
            Add
          </Button>
        </div>
      </div>

      <div className="flex gap-2">
        {showCancel && (
          <Button variant="outline" className="flex-1" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
        <Button className="flex-1" size="lg" onClick={submit} disabled={busy}>
          {busy ? <Spinner /> : <Sparkles className="h-5 w-5" />}
          {busy ? "Building your plan…" : showCancel ? "Save & regenerate" : "Generate my plan"}
        </Button>
      </div>
      {!showCancel && (
        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <Badge variant="muted">AI</Badge>
          Adapts automatically when you evolve your training program.
        </p>
      )}
    </div>
  );
}
