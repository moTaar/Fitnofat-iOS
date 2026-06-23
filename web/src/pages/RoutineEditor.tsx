import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ChevronLeft, Plus, Trash2, ChevronUp, ChevronDown, GripVertical, Minus,
} from "lucide-react";
import { useStore } from "@/lib/store";
import type { Exercise, RoutineExercise } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ExercisePicker } from "@/components/ExercisePicker";
import { EmptyState } from "@/components/ui/misc";
import { Dumbbell } from "lucide-react";

export function RoutineEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const existing = useStore((s) => s.routines.find((r) => r.id === id));
  const defaultRest = useStore((s) => s.settings.defaultRestSeconds);
  const saveRoutine = useStore((s) => s.saveRoutine);

  const [name, setName] = useState(existing?.name ?? "");
  const [exercises, setExercises] = useState<RoutineExercise[]>(existing?.exercises ?? []);
  const [picker, setPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addExercise = (e: Exercise) => {
    setExercises((prev) => [
      ...prev,
      {
        exerciseId: e.id,
        name: e.name,
        muscleGroup: e.muscleGroup,
        restSeconds: defaultRest,
        sets: [
          { targetReps: 10, targetWeight: 0 },
          { targetReps: 10, targetWeight: 0 },
          { targetReps: 10, targetWeight: 0 },
        ],
      },
    ]);
  };

  const move = (idx: number, dir: -1 | 1) => {
    setExercises((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const removeExercise = (idx: number) =>
    setExercises((prev) => prev.filter((_, i) => i !== idx));

  const setCount = (idx: number, delta: number) =>
    setExercises((prev) =>
      prev.map((ex, i) => {
        if (i !== idx) return ex;
        let sets = [...ex.sets];
        if (delta > 0) sets.push({ ...(sets[sets.length - 1] ?? { targetReps: 10, targetWeight: 0 }) });
        else if (sets.length > 1) sets = sets.slice(0, -1);
        return { ...ex, sets };
      })
    );

  const updateSetField = (
    exIdx: number,
    field: "targetReps" | "targetWeight" | "restSeconds",
    value: number
  ) =>
    setExercises((prev) =>
      prev.map((ex, i) => {
        if (i !== exIdx) return ex;
        if (field === "restSeconds") return { ...ex, restSeconds: value };
        // Apply target uniformly across this exercise's sets (default scheme).
        return { ...ex, sets: ex.sets.map((s) => ({ ...s, [field]: value })) };
      })
    );

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveRoutine({
        id: existing?.id,
        name: name.trim() || "Untitled Routine",
        exercises,
        dayLabel: existing?.dayLabel,
        favorite: existing?.favorite,
        description: existing?.description,
      });
      navigate("/routines");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save routine.");
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 pb-4">
      <div className="flex items-center gap-2 pt-2">
        <button onClick={() => navigate(-1)} className="rounded-full p-1.5 hover:bg-accent tap">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="text-xl font-bold">{existing ? "Edit routine" : "New routine"}</h1>
      </div>

      <Input
        placeholder="Routine name (e.g. Push Day)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="text-base font-semibold"
      />

      {exercises.length === 0 ? (
        <EmptyState
          icon={<Dumbbell className="h-6 w-6" />}
          title="No exercises"
          description="Add exercises to build this routine."
        />
      ) : (
        <div className="space-y-2">
          {exercises.map((ex, idx) => (
            <Card key={`${ex.exerciseId}-${idx}`}>
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  <GripVertical className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1">
                    <p className="font-semibold leading-tight">{ex.name}</p>
                    <p className="text-xs text-muted-foreground">{ex.muscleGroup}</p>
                  </div>
                  <button onClick={() => move(idx, -1)} className="rounded-lg p-1.5 hover:bg-accent tap">
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button onClick={() => move(idx, 1)} className="rounded-lg p-1.5 hover:bg-accent tap">
                    <ChevronDown className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => removeExercise(idx)}
                    className="rounded-lg p-1.5 text-destructive hover:bg-accent tap"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2">
                  <Field label="Sets">
                    <div className="flex items-center gap-1">
                      <button onClick={() => setCount(idx, -1)} className="rounded-lg bg-secondary p-2 tap">
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-6 text-center text-sm font-bold">{ex.sets.length}</span>
                      <button onClick={() => setCount(idx, 1)} className="rounded-lg bg-secondary p-2 tap">
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </Field>
                  <Field label="Target reps">
                    <Input
                      type="number"
                      inputMode="numeric"
                      className="h-9 text-center"
                      value={ex.sets[0]?.targetReps || ""}
                      onChange={(e) => updateSetField(idx, "targetReps", parseInt(e.target.value) || 0)}
                    />
                  </Field>
                  <Field label="Rest (s)">
                    <Input
                      type="number"
                      inputMode="numeric"
                      className="h-9 text-center"
                      value={ex.restSeconds || ""}
                      onChange={(e) => updateSetField(idx, "restSeconds", parseInt(e.target.value) || 0)}
                    />
                  </Field>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Button variant="outline" className="w-full" onClick={() => setPicker(true)}>
        <Plus className="h-4 w-4" /> Add exercise
      </Button>

      {error && (
        <div className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      )}

      <div className="sticky bottom-24 flex gap-2">
        <Button variant="outline" className="flex-1" onClick={() => navigate(-1)} disabled={saving}>
          Cancel
        </Button>
        <Button className="flex-1" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save routine"}
        </Button>
      </div>

      <ExercisePicker open={picker} onClose={() => setPicker(false)} onPick={addExercise} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}
