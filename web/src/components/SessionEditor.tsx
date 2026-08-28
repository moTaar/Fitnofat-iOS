import { useMemo, useState } from "react";
import { Plus, X, Trash2, Save, Dumbbell, HeartPulse, Timer } from "lucide-react";
import { useStore } from "@/lib/store";
import type { Exercise, ExerciseKind, LoggedExercise, WorkoutSession } from "@/lib/types";
import { estimateSessionCalories, resolveKind } from "@/lib/calories";
import { formatCalories, sessionVolume, distanceUnit, kmToDisplayDistance, displayDistanceToKm } from "@/lib/utils";
import { Modal } from "./ui/modal";
import { Button } from "./ui/button";
import { ExercisePicker } from "./ExercisePicker";

// Local, fully-editable copy of an exercise (sets carry minutes for the UI; we
// convert back to durationSec on save).
interface DraftSet {
  weight: number;
  reps: number;
  minutes: number; // cardio/hold duration, shown in minutes
  distanceKm: number;
  rpe?: number;
}
interface DraftExercise {
  exerciseId: string;
  name: string;
  muscleGroup: LoggedExercise["muscleGroup"];
  restSeconds: number;
  kind: ExerciseKind;
  sets: DraftSet[];
}

function toDraft(ex: LoggedExercise): DraftExercise {
  const kind = ex.kind ?? resolveKind(ex);
  return {
    exerciseId: ex.exerciseId,
    name: ex.name,
    muscleGroup: ex.muscleGroup,
    restSeconds: ex.restSeconds,
    kind,
    sets: ex.sets.map((s) => ({
      weight: s.weight ?? 0,
      reps: s.reps ?? 0,
      // Recover minutes from explicit duration, or the legacy reps-as-minutes shape.
      minutes: s.durationSec ? Math.round(s.durationSec / 60) : kind !== "strength" ? s.reps ?? 0 : 0,
      distanceKm: s.distanceKm ?? 0,
      rpe: s.rpe,
    })),
  };
}

function emptySet(kind: ExerciseKind): DraftSet {
  return kind === "strength"
    ? { weight: 0, reps: 10, minutes: 0, distanceKm: 0 }
    : { weight: 0, reps: 0, minutes: 10, distanceKm: 0 };
}

function draftToLogged(d: DraftExercise): LoggedExercise {
  return {
    exerciseId: d.exerciseId,
    name: d.name,
    muscleGroup: d.muscleGroup,
    restSeconds: d.restSeconds,
    kind: d.kind,
    sets: d.sets.map((s) => ({
      weight: d.kind === "strength" ? s.weight : 0,
      reps: d.kind === "strength" ? s.reps : 0,
      completed: true,
      ...(d.kind !== "strength" ? { durationSec: Math.round(s.minutes * 60) } : {}),
      ...(d.kind === "cardio" && s.distanceKm > 0 ? { distanceKm: s.distanceKm } : {}),
      ...(s.rpe ? { rpe: s.rpe } : {}),
    })),
  };
}

// ms timestamp ↔ value for <input type="datetime-local"> (local time, no seconds).
function toLocalInput(ms: number): string {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}
function fromLocalInput(v: string): number {
  return new Date(v).getTime();
}

const KIND_META: Record<ExerciseKind, { icon: typeof Dumbbell; label: string }> = {
  strength: { icon: Dumbbell, label: "Strength" },
  cardio: { icon: HeartPulse, label: "Cardio" },
  hold: { icon: Timer, label: "Hold" },
};

export function SessionEditor({
  open,
  onClose,
  initial,
  mode = "create",
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  initial: WorkoutSession | null; // null → blank manual log
  // "create" → save as a NEW entry (blank log or a clone of `initial`).
  // "edit"   → update `initial` in place.
  mode?: "create" | "edit";
  onSaved?: () => void;
}) {
  const units = useStore((s) => s.profile?.units ?? "kg");
  const bodyweightKg = useStore((s) => s.profile?.bodyweightKg);
  const libraryExercises = useStore((s) => s.exercises);
  const saveManualSession = useStore((s) => s.saveManualSession);
  const updateManualSession = useStore((s) => s.updateManualSession);

  const isEdit = mode === "edit" && !!initial;

  const [name, setName] = useState("");
  const [startedAt, setStartedAt] = useState<number>(Date.now());
  const [durationMin, setDurationMin] = useState(0);
  const [exercises, setExercises] = useState<DraftExercise[]>([]);
  const [picker, setPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [seededFor, setSeededFor] = useState<string | null>(null);

  // Seed local state when the modal opens (or the source session changes).
  const seedKey = open ? `${mode}:${initial?.id ?? "blank"}` : "closed";
  if (open && seededFor !== seedKey) {
    setName(initial?.routineName || "Manual Workout");
    // Editing keeps the original date; a clone / blank log starts "now".
    setStartedAt(isEdit && initial ? initial.startedAt : Date.now());
    setDurationMin(initial ? Math.max(1, Math.round(initial.durationSec / 60)) : 30);
    setExercises((initial?.exercises ?? []).map(toDraft));
    setSeededFor(seedKey);
  }

  const logged = useMemo(() => exercises.map(draftToLogged), [exercises]);
  const metMap = useMemo(() => {
    const m: Record<string, number | undefined> = {};
    for (const e of libraryExercises) if (e.met != null) m[e.id] = e.met;
    return m;
  }, [libraryExercises]);
  const calories = useMemo(
    () => estimateSessionCalories(logged, bodyweightKg ?? undefined, metMap),
    [logged, bodyweightKg, metMap]
  );
  const volume = useMemo(() => sessionVolume(logged), [logged]);

  const patchSet = (exIdx: number, setIdx: number, patch: Partial<DraftSet>) =>
    setExercises((prev) =>
      prev.map((ex, i) =>
        i !== exIdx ? ex : { ...ex, sets: ex.sets.map((s, j) => (j === setIdx ? { ...s, ...patch } : s)) }
      )
    );
  const addSet = (exIdx: number) =>
    setExercises((prev) =>
      prev.map((ex, i) =>
        i !== exIdx ? ex : { ...ex, sets: [...ex.sets, ex.sets[ex.sets.length - 1] ?? emptySet(ex.kind)] }
      )
    );
  const removeSet = (exIdx: number, setIdx: number) =>
    setExercises((prev) =>
      prev.map((ex, i) => (i !== exIdx ? ex : { ...ex, sets: ex.sets.filter((_, j) => j !== setIdx) }))
    );
  const removeExercise = (exIdx: number) =>
    setExercises((prev) => prev.filter((_, i) => i !== exIdx));
  const cycleKind = (exIdx: number) =>
    setExercises((prev) =>
      prev.map((ex, i) => {
        if (i !== exIdx) return ex;
        const order: ExerciseKind[] = ["strength", "cardio", "hold"];
        const next = order[(order.indexOf(ex.kind) + 1) % order.length];
        return { ...ex, kind: next };
      })
    );

  const onPick = (e: Exercise) => {
    const kind: ExerciseKind = e.muscleGroup === "Cardio" ? "cardio" : "strength";
    setExercises((prev) => [
      ...prev,
      {
        exerciseId: e.id,
        name: e.name,
        muscleGroup: e.muscleGroup,
        restSeconds: 60,
        kind,
        sets: [emptySet(kind)],
      },
    ]);
    setPicker(false);
  };

  const close = () => {
    setSeededFor(null);
    onClose();
  };

  const save = async () => {
    setSaving(true);
    try {
      const draft = {
        routineName: name.trim() || "Logged Workout",
        startedAt,
        durationSec: Math.max(0, Math.round(durationMin * 60)),
        exercises: logged.filter((ex) => ex.sets.length > 0),
      };
      if (isEdit && initial) {
        await updateManualSession(initial.id, draft);
      } else {
        await saveManualSession(draft);
      }
      onSaved?.();
      close();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title={isEdit ? "Edit session" : initial ? "Duplicate session" : "Log a workout"}>
      <div className="space-y-4">
        {/* Session meta */}
        <div className="space-y-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Workout name"
            className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-base font-semibold focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-xs text-muted-foreground">When</span>
              <input
                type="datetime-local"
                value={toLocalInput(startedAt)}
                onChange={(e) => setStartedAt(fromLocalInput(e.target.value))}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-muted-foreground">Duration (min)</span>
              <input
                type="number"
                inputMode="numeric"
                value={durationMin || ""}
                onChange={(e) => setDurationMin(parseInt(e.target.value) || 0)}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
          </div>
        </div>

        {/* Live totals */}
        <div className="grid grid-cols-3 gap-2 rounded-xl bg-secondary p-2 text-center">
          <Total label="Calories" value={formatCalories(calories)} />
          <Total label="Volume" value={`${Math.round(volume)} ${units}`} />
          <Total label="Exercises" value={String(exercises.length)} />
        </div>

        {/* Exercises */}
        <div className="space-y-3">
          {exercises.map((ex, exIdx) => {
            const Icon = KIND_META[ex.kind].icon;
            return (
              <div key={`${ex.exerciseId}-${exIdx}`} className="rounded-2xl border border-border bg-card p-3">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-semibold leading-tight">{ex.name}</p>
                    <button
                      onClick={() => cycleKind(exIdx)}
                      className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground tap"
                      title="Change how this exercise is measured"
                    >
                      <Icon className="h-3 w-3" />
                      {KIND_META[ex.kind].label}
                    </button>
                  </div>
                  <button
                    onClick={() => removeExercise(exIdx)}
                    className="rounded-full p-1.5 text-destructive tap hover:bg-accent"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                {/* Column headers */}
                <div className="mt-2 grid grid-cols-[1.6rem_1fr_1fr_1fr_1.8rem] items-center gap-1.5 px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  <span>#</span>
                  {ex.kind === "strength" ? (
                    <>
                      <span className="text-center">{units}</span>
                      <span className="text-center">Reps</span>
                    </>
                  ) : (
                    <>
                      <span className="text-center">Min</span>
                      <span className="text-center">{ex.kind === "cardio" ? distanceUnit(units) : "—"}</span>
                    </>
                  )}
                  <span className="text-center">RPE</span>
                  <span />
                </div>

                <div className="space-y-1">
                  {ex.sets.map((s, setIdx) => (
                    <div
                      key={setIdx}
                      className="grid grid-cols-[1.6rem_1fr_1fr_1fr_1.8rem] items-center gap-1.5"
                    >
                      <span className="text-center text-sm font-semibold text-muted-foreground">
                        {setIdx + 1}
                      </span>
                      {ex.kind === "strength" ? (
                        <>
                          <NumInput
                            value={s.weight}
                            onChange={(v) => patchSet(exIdx, setIdx, { weight: v })}
                          />
                          <NumInput
                            value={s.reps}
                            onChange={(v) => patchSet(exIdx, setIdx, { reps: v })}
                          />
                        </>
                      ) : (
                        <>
                          <NumInput
                            value={s.minutes}
                            onChange={(v) => patchSet(exIdx, setIdx, { minutes: v })}
                          />
                          <NumInput
                            value={kmToDisplayDistance(s.distanceKm, units)}
                            disabled={ex.kind !== "cardio"}
                            onChange={(v) => patchSet(exIdx, setIdx, { distanceKm: displayDistanceToKm(v, units) })}
                          />
                        </>
                      )}
                      <NumInput
                        value={s.rpe ?? 0}
                        placeholder="–"
                        onChange={(v) => patchSet(exIdx, setIdx, { rpe: v || undefined })}
                      />
                      {ex.sets.length > 1 ? (
                        <button
                          onClick={() => removeSet(exIdx, setIdx)}
                          className="flex h-9 items-center justify-center rounded-lg text-muted-foreground tap hover:text-destructive"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      ) : (
                        <span />
                      )}
                    </div>
                  ))}
                </div>

                <Button variant="ghost" size="sm" className="mt-1 w-full" onClick={() => addSet(exIdx)}>
                  <Plus className="h-4 w-4" />
                  Add set
                </Button>
              </div>
            );
          })}
        </div>

        <Button variant="outline" className="w-full" onClick={() => setPicker(true)}>
          <Plus className="h-4 w-4" />
          Add exercise
        </Button>

        <Button
          className="w-full"
          variant="success"
          disabled={saving || exercises.length === 0}
          onClick={save}
        >
          <Save className="h-4 w-4" />
          {isEdit ? "Save changes" : initial ? "Save as new entry" : "Save workout"}
        </Button>
      </div>

      <ExercisePicker open={picker} onClose={() => setPicker(false)} onPick={onPick} />
    </Modal>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm font-bold leading-none">{value}</p>
      <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}

function NumInput({
  value,
  onChange,
  placeholder = "0",
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      disabled={disabled}
      value={value || ""}
      placeholder={placeholder}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      className="h-9 w-full rounded-lg border border-input bg-background text-center text-sm font-semibold focus:border-primary focus:outline-none disabled:opacity-40"
    />
  );
}
