import { useMemo, useState } from "react";
import { Search, Plus, Dumbbell } from "lucide-react";
import { useStore } from "@/lib/store";
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

  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<MuscleGroup | "All">("All");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newGroup, setNewGroup] = useState<MuscleGroup>("Chest");
  const [newEquip, setNewEquip] = useState("Barbell");

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

  const createAndPick = async () => {
    if (!newName.trim()) return;
    const e = await addCustomExercise({
      name: newName.trim(),
      muscleGroup: newGroup,
      equipment: newEquip,
    });
    setNewName("");
    setCreating(false);
    pick(e);
  };

  return (
    <Modal open={open} onClose={onClose} title={creating ? "New exercise" : "Add exercise"}>
      {creating ? (
        <div className="space-y-4">
          <div>
            <Label>Name</Label>
            <Input
              autoFocus
              className="mt-1.5"
              placeholder="e.g. Cable Pullover"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <div>
            <Label>Muscle group</Label>
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
            <Label>Equipment</Label>
            <Input
              className="mt-1.5"
              placeholder="Barbell / Dumbbell / Bodyweight…"
              value={newEquip}
              onChange={(e) => setNewEquip(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setCreating(false)}>
              Back
            </Button>
            <Button className="flex-1" onClick={createAndPick} disabled={!newName.trim()}>
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
