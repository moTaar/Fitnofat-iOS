import { useMemo, useState } from "react";
import { Search, Plus, Dumbbell, Sparkles, CheckCircle2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import { MUSCLE_GROUPS } from "@/lib/exercises";
import type { Exercise, MuscleGroup } from "@/lib/types";
import { Modal } from "./ui/modal";
import { Input, Label } from "./ui/input";
import { Button } from "./ui/button";
import { Badge } from "./ui/misc";
import { cn } from "@/lib/utils";

export function ExercisePicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (e: Exercise) => void;
}) {
  const exercises = useStore((s) => s.exercises);
  const addCustomExercise = useStore((s) => s.addCustomExercise);
  const receiveExercise = useStore((s) => s.receiveExercise);

  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<MuscleGroup | "All">("All");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newGroup, setNewGroup] = useState<MuscleGroup>("Chest");
  const [newEquip, setNewEquip] = useState("Barbell");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<Exercise | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return exercises.filter(
      (e) =>
        (group === "All" || e.muscleGroup === group) &&
        (!q || e.name.toLowerCase().includes(q))
    );
  }, [exercises, query, group]);

  const pick = (e: Exercise) => {
    onPick(e);
    onClose();
    setQuery("");
  };

  const resetCreateForm = () => {
    setNewName("");
    setNewGroup("Chest");
    setNewEquip("Barbell");
    setAiResult(null);
    setAiLoading(false);
  };

  const handleAiAssist = async () => {
    const name = newName.trim();
    if (!name) return;
    setAiLoading(true);
    setAiResult(null);
    try {
      const exercise = await api.aiAssistExercise(name);
      setAiResult(exercise);
      setNewGroup(exercise.muscleGroup);
      setNewEquip(exercise.equipment);
    } catch {
      // silently fall back — user can fill manually
    } finally {
      setAiLoading(false);
    }
  };

  const createAndPick = async () => {
    if (!newName.trim()) return;
    if (aiResult) {
      // AI already created + saved the exercise; just register it locally and pick it.
      receiveExercise(aiResult);
      resetCreateForm();
      setCreating(false);
      pick(aiResult);
      return;
    }
    const e = await addCustomExercise({
      name: newName.trim(),
      muscleGroup: newGroup,
      equipment: newEquip,
    });
    resetCreateForm();
    setCreating(false);
    pick(e);
  };

  return (
    <Modal open={open} onClose={onClose} title={creating ? "New exercise" : "Add exercise"}>
      {creating ? (
        <div className="space-y-4">
          <div>
            <Label>Name</Label>
            <div className="mt-1.5 flex gap-2">
              <Input
                autoFocus
                className="flex-1"
                placeholder="e.g. Cable Pullover"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  setAiResult(null);
                }}
              />
              <Button
                variant="outline"
                className={cn(
                  "shrink-0 gap-1.5 px-3",
                  aiResult && "border-primary/50 text-primary"
                )}
                onClick={handleAiAssist}
                disabled={!newName.trim() || aiLoading}
                title="Let AI identify muscle group, equipment, and generate a full guide"
              >
                {aiLoading ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : aiResult ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                <span className="text-xs">
                  {aiLoading ? "Filling…" : aiResult ? "AI filled" : "AI fill"}
                </span>
              </Button>
            </div>
            {aiLoading && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                Identifying muscle group, equipment, and generating a guide…
              </p>
            )}
            {aiResult && !aiLoading && (
              <p className="mt-1.5 text-xs text-primary">
                AI identified this exercise. Fields below are pre-filled — edit if needed.
              </p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label>Muscle group</Label>
              {aiResult && <span className="text-[10px] text-primary font-medium">AI</span>}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {MUSCLE_GROUPS.map((g) => (
                <button
                  key={g}
                  onClick={() => setNewGroup(g)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium tap",
                    newGroup === g ? "bg-primary text-primary-foreground" : "bg-secondary"
                  )}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label>Equipment</Label>
              {aiResult && <span className="text-[10px] text-primary font-medium">AI</span>}
            </div>
            <Input
              className="mt-1.5"
              placeholder="Barbell / Dumbbell / Bodyweight…"
              value={newEquip}
              onChange={(e) => setNewEquip(e.target.value)}
            />
          </div>

          {aiResult && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                Guide generated
              </p>
              <p>A complete how-to guide has been generated for this exercise and will be available when you view it.</p>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                setCreating(false);
                resetCreateForm();
              }}
            >
              Back
            </Button>
            <Button className="flex-1" onClick={createAndPick} disabled={!newName.trim() || aiLoading}>
              Create & add
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              className="pl-9"
              placeholder="Search exercises…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="mt-3 flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
            {(["All", ...MUSCLE_GROUPS] as const).map((g) => (
              <button
                key={g}
                onClick={() => setGroup(g)}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1 text-xs font-medium tap",
                  group === g ? "bg-primary text-primary-foreground" : "bg-secondary"
                )}
              >
                {g}
              </button>
            ))}
          </div>

          <div className="mt-3 max-h-[45vh] space-y-1.5 overflow-y-auto no-scrollbar">
            {filtered.map((e) => (
              <button
                key={e.id}
                onClick={() => pick(e)}
                className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-left tap hover:border-primary/40"
              >
                <div className="rounded-lg bg-secondary p-2 text-muted-foreground">
                  <Dumbbell className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <p className="font-medium leading-tight">{e.name}</p>
                  <p className="text-xs text-muted-foreground">{e.equipment}</p>
                </div>
                <Badge variant="muted">{e.muscleGroup}</Badge>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No exercises found.
              </p>
            )}
          </div>

          <Button variant="outline" className="mt-3 w-full" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            Create custom exercise
          </Button>
        </div>
      )}
    </Modal>
  );
}
