import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Check, Plus, X, Timer, MoreVertical, Trash2, Flag, ChevronLeft, Info, Activity,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { useNow } from "@/lib/hooks";
import { cn, formatDuration, formatCalories, haptic, sessionVolume } from "@/lib/utils";
import { estimateSessionCalories, resolveKind } from "@/lib/calories";
import type { Exercise, ExerciseKind, WorkoutSession } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ExercisePicker } from "@/components/ExercisePicker";
import { ExerciseDetail } from "@/components/ExerciseDetail";
import { RestTimerBar } from "@/components/RestTimerBar";
import { RepCounter } from "@/components/RepCounter";

// Find the most recent completed set for a given exercise+set index.
function usePrevious(history: WorkoutSession[]) {
  return useMemo(() => {
    const map = new Map<string, { weight: number; reps: number }[]>();
    for (const session of history) {
      for (const ex of session.exercises) {
        if (!map.has(ex.exerciseId)) {
          map.set(
            ex.exerciseId,
            ex.sets.map((s) => ({ weight: s.weight, reps: s.reps }))
          );
        }
      }
    }
    return map;
  }, [history]);
}

export function ActiveWorkout() {
  const navigate = useNavigate();
  const active = useStore((s) => s.active);
  const history = useStore((s) => s.history);
  const exercises = useStore((s) => s.exercises);
  const units = useStore((s) => s.profile?.units ?? "kg");
  const bodyweightKg = useStore((s) => s.profile?.bodyweightKg);
  const logSet = useStore((s) => s.logSet);
  const addSetToExercise = useStore((s) => s.addSetToExercise);
  const removeSet = useStore((s) => s.removeSet);
  const addExerciseToActive = useStore((s) => s.addExerciseToActive);
  const removeExerciseFromActive = useStore((s) => s.removeExerciseFromActive);
  const setActiveExerciseKind = useStore((s) => s.setActiveExerciseKind);
  const startRest = useStore((s) => s.startRest);
  const finishWorkout = useStore((s) => s.finishWorkout);
  const cancelWorkout = useStore((s) => s.cancelWorkout);

  const [picker, setPicker] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [detail, setDetail] = useState<Exercise | null>(null);
  const [counter, setCounter] = useState<{ exIdx: number; setIdx: number } | null>(null);

  const prev = usePrevious(history);
  const now = useNow(!!active, 1000);

  if (!active) {
    navigate("/", { replace: true });
    return null;
  }

  const elapsed = Math.floor((now - active.startedAt) / 1000);
  const completedSets = active.exercises.reduce(
    (n, ex) => n + ex.sets.filter((s) => s.completed).length,
    0
  );
  const volume = sessionVolume(active.exercises);
  // Running calorie estimate over completed sets only (mirrors how finishWorkout saves).
  const calories = estimateSessionCalories(
    active.exercises.map((ex) => ({ ...ex, sets: ex.sets.filter((s) => s.completed) })),
    bodyweightKg ?? undefined
  );

  const toggleSet = (exIdx: number, setIdx: number) => {
    const set = active.exercises[exIdx].sets[setIdx];
    const completing = !set.completed;
    logSet(exIdx, setIdx, { completed: completing });
    if (completing) {
      haptic(20);
      startRest(active.exercises[exIdx].restSeconds || 90);
    }
  };

  // Launch the Smart Rep Counter against an exercise's current set — the first
  // not-yet-completed set, falling back to the last set when all are done.
  const openCounter = (exIdx: number) => {
    const sets = active.exercises[exIdx].sets;
    const firstOpen = sets.findIndex((s) => !s.completed);
    setCounter({ exIdx, setIdx: firstOpen === -1 ? sets.length - 1 : firstOpen });
  };

  // Commit the counted reps to the targeted set, marking it complete and
  // kicking off the rest timer (mirrors toggleSet's completion behavior).
  const logFromCounter = (reps: number) => {
    if (!counter) return;
    const { exIdx, setIdx } = counter;
    const wasCompleted = active.exercises[exIdx].sets[setIdx].completed;
    logSet(exIdx, setIdx, { reps, completed: true });
    haptic(20);
    if (!wasCompleted) startRest(active.exercises[exIdx].restSeconds || 90);
    setCounter(null);
  };

  const onPick = (e: Exercise) => addExerciseToActive(e);

  const finish = async () => {
    await finishWorkout();
    setConfirmFinish(false);
    navigate("/history", { replace: true });
  };

  return (
    <div className="mx-auto min-h-[100dvh] w-full max-w-md pb-40">
      {/* Sticky timer header */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            onClick={() => navigate("/")}
            className="rounded-full p-1.5 hover:bg-accent tap"
            title="Minimize"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <p className="text-sm font-medium leading-tight">{active.routineName}</p>
            <div className="flex items-center gap-1.5 text-primary">
              <Timer className="h-4 w-4" />
              <span className="font-mono text-xl font-bold tabular-nums">
                {formatDuration(elapsed)}
              </span>
            </div>
          </div>
          <Button size="sm" variant="success" onClick={() => setConfirmFinish(true)}>
            <Flag className="h-4 w-4" />
            Finish
          </Button>
        </div>
        <div className="flex justify-around border-t border-border py-1.5 text-center text-xs text-muted-foreground">
          <span>
            <b className="text-foreground">{completedSets}</b> sets
          </span>
          <span>
            <b className="text-foreground">{active.exercises.length}</b> exercises
          </span>
          <span>
            <b className="text-foreground">{Math.round(volume)}</b> {units} vol
          </span>
          <span>
            <b className="text-primary">{Math.round(calories)}</b> kcal
          </span>
        </div>
      </header>

      <div className="space-y-4 px-4 pt-4">
        {active.exercises.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border py-12 text-center">
            <p className="font-semibold">Empty workout</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add your first exercise to start logging.
            </p>
          </div>
        )}

        {active.exercises.map((ex, exIdx) => {
          const previous = prev.get(ex.exerciseId);
          const kind: ExerciseKind = ex.kind ?? resolveKind(ex);
          const isStrength = kind === "strength";
          const nextKind: ExerciseKind =
            kind === "strength" ? "cardio" : kind === "cardio" ? "hold" : "strength";
          return (
            <div key={`${ex.exerciseId}-${exIdx}`} className="rounded-2xl border border-border bg-card">
              <div className="flex items-center justify-between p-3 pb-2">
                <div className="flex items-center gap-2">
                  <div>
                    <h3 className="font-semibold leading-tight">{ex.name}</h3>
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {ex.muscleGroup} · {ex.restSeconds}s rest ·
                      <button
                        onClick={() => setActiveExerciseKind(exIdx, nextKind)}
                        className="rounded-full bg-secondary px-2 py-0.5 font-medium text-primary tap"
                        title="Change how this exercise is measured"
                      >
                        {kind === "strength" ? "Strength" : kind === "cardio" ? "Cardio" : "Hold"}
                      </button>
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      setDetail(
                        exercises.find((e) => e.id === ex.exerciseId) ?? {
                          id: ex.exerciseId,
                          name: ex.name,
                          muscleGroup: ex.muscleGroup,
                          equipment: "—",
                        }
                      )
                    }
                    className="rounded-full p-1 text-muted-foreground hover:bg-accent tap"
                    title="How to perform"
                  >
                    <Info className="h-4 w-4" />
                  </button>
                </div>
                <button
                  onClick={() => setMenuFor(menuFor === exIdx ? null : exIdx)}
                  className="relative rounded-full p-1.5 hover:bg-accent tap"
                >
                  <MoreVertical className="h-5 w-5 text-muted-foreground" />
                  {menuFor === exIdx && (
                    <div
                      className="absolute right-0 top-9 z-10 w-44 rounded-xl border border-border bg-card p-1 shadow-xl"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => {
                          removeExerciseFromActive(exIdx);
                          setMenuFor(null);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-destructive hover:bg-accent tap"
                      >
                        <Trash2 className="h-4 w-4" />
                        Remove exercise
                      </button>
                    </div>
                  )}
                </button>
              </div>

              {/* Column headers */}
              <div className="grid grid-cols-[2.2rem_1fr_1fr_1fr_2.6rem] items-center gap-2 px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <span>Set</span>
                {isStrength ? (
                  <>
                    <span className="text-center">Prev</span>
                    <span className="text-center">{units}</span>
                    <span className="text-center">Reps</span>
                  </>
                ) : (
                  <>
                    <span className="text-center">Min</span>
                    <span className="text-center">{kind === "cardio" ? "Km" : "—"}</span>
                    <span className="text-center">RPE</span>
                  </>
                )}
                <span />
              </div>

              <div className="space-y-1.5 px-2 pb-2">
                {ex.sets.map((set, setIdx) => {
                  const p = previous?.[setIdx];
                  return (
                    <div
                      key={setIdx}
                      className={cn(
                        "grid grid-cols-[2.2rem_1fr_1fr_1fr_2.6rem] items-center gap-2 rounded-xl px-1 py-1 transition-colors",
                        set.completed && "bg-success/10"
                      )}
                    >
                      <span className="text-center text-sm font-semibold text-muted-foreground">
                        {setIdx + 1}
                      </span>
                      {isStrength ? (
                        <>
                          <span className="text-center text-xs text-muted-foreground">
                            {p ? `${p.weight}×${p.reps}` : "—"}
                          </span>
                          <input
                            type="number"
                            inputMode="decimal"
                            value={set.weight || ""}
                            placeholder={p ? String(p.weight) : "0"}
                            onChange={(e) =>
                              logSet(exIdx, setIdx, { weight: parseFloat(e.target.value) || 0 })
                            }
                            className="h-10 w-full rounded-lg border border-input bg-background text-center text-base font-semibold focus:border-primary focus:outline-none"
                          />
                          <input
                            type="number"
                            inputMode="numeric"
                            value={set.reps || ""}
                            placeholder={p ? String(p.reps) : "0"}
                            onChange={(e) =>
                              logSet(exIdx, setIdx, { reps: parseInt(e.target.value) || 0 })
                            }
                            className="h-10 w-full rounded-lg border border-input bg-background text-center text-base font-semibold focus:border-primary focus:outline-none"
                          />
                        </>
                      ) : (
                        <>
                          <input
                            type="number"
                            inputMode="decimal"
                            value={set.durationSec ? Math.round(set.durationSec / 60) : ""}
                            placeholder="0"
                            onChange={(e) =>
                              logSet(exIdx, setIdx, {
                                durationSec: Math.round((parseFloat(e.target.value) || 0) * 60),
                              })
                            }
                            className="h-10 w-full rounded-lg border border-input bg-background text-center text-base font-semibold focus:border-primary focus:outline-none"
                          />
                          <input
                            type="number"
                            inputMode="decimal"
                            disabled={kind !== "cardio"}
                            value={set.distanceKm || ""}
                            placeholder={kind === "cardio" ? "0" : "—"}
                            onChange={(e) =>
                              logSet(exIdx, setIdx, { distanceKm: parseFloat(e.target.value) || 0 })
                            }
                            className="h-10 w-full rounded-lg border border-input bg-background text-center text-base font-semibold focus:border-primary focus:outline-none disabled:opacity-40"
                          />
                          <input
                            type="number"
                            inputMode="numeric"
                            value={set.rpe || ""}
                            placeholder="–"
                            onChange={(e) =>
                              logSet(exIdx, setIdx, { rpe: parseFloat(e.target.value) || 0 })
                            }
                            className="h-10 w-full rounded-lg border border-input bg-background text-center text-base font-semibold focus:border-primary focus:outline-none"
                          />
                        </>
                      )}
                      <button
                        onClick={() => toggleSet(exIdx, setIdx)}
                        className={cn(
                          "flex h-10 w-full items-center justify-center rounded-lg tap",
                          set.completed
                            ? "bg-success text-success-foreground"
                            : "bg-secondary text-muted-foreground"
                        )}
                      >
                        <Check className="h-5 w-5" />
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-2 px-3 pb-3">
                <Button variant="ghost" size="sm" className="flex-1" onClick={() => addSetToExercise(exIdx)}>
                  <Plus className="h-4 w-4" />
                  Add set
                </Button>
                {isStrength && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 border-primary/30 text-primary"
                    onClick={() => openCounter(exIdx)}
                  >
                    <Activity className="h-4 w-4" />
                    Rep counter
                  </Button>
                )}
                {ex.sets.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeSet(exIdx, ex.sets.length - 1)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}

        <Button variant="outline" size="lg" className="w-full" onClick={() => setPicker(true)}>
          <Plus className="h-5 w-5" />
          Add exercise
        </Button>

        <button
          onClick={() => setConfirmCancel(true)}
          className="w-full py-2 text-sm text-muted-foreground tap"
        >
          Discard workout
        </button>
      </div>

      <RestTimerBar />
      <ExercisePicker open={picker} onClose={() => setPicker(false)} onPick={onPick} />
      <ExerciseDetail exercise={detail} open={!!detail} onClose={() => setDetail(null)} />

      {counter && (
        <RepCounter
          open
          exerciseName={active.exercises[counter.exIdx].name}
          setNumber={counter.setIdx + 1}
          targetReps={active.exercises[counter.exIdx].sets[counter.setIdx].reps || undefined}
          initialReps={
            active.exercises[counter.exIdx].sets[counter.setIdx].completed
              ? active.exercises[counter.exIdx].sets[counter.setIdx].reps
              : 0
          }
          weight={active.exercises[counter.exIdx].sets[counter.setIdx].weight}
          units={units}
          onClose={() => setCounter(null)}
          onLog={logFromCounter}
        />
      )}

      <Modal open={confirmFinish} onClose={() => setConfirmFinish(false)} title="Finish workout?">
        <p className="text-sm text-muted-foreground">
          {completedSets > 0
            ? `You completed ${completedSets} sets for ${Math.round(volume)} ${units} of volume. Only completed sets are saved.`
            : "No sets are marked complete yet — nothing will be saved."}
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => setConfirmFinish(false)}>
            Keep going
          </Button>
          <Button variant="success" className="flex-1" onClick={finish}>
            Finish & save
          </Button>
        </div>
      </Modal>

      <Modal open={confirmCancel} onClose={() => setConfirmCancel(false)} title="Discard this workout?">
        <p className="text-sm text-muted-foreground">
          This will delete the current session. This can’t be undone.
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => setConfirmCancel(false)}>
            Keep going
          </Button>
          <Button
            variant="destructive"
            className="flex-1"
            onClick={() => {
              cancelWorkout();
              navigate("/", { replace: true });
            }}
          >
            Discard
          </Button>
        </div>
      </Modal>
    </div>
  );
}
