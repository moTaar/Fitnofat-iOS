import { useMemo, useState } from "react";
import { Search, Plus, Dumbbell, Check, ChevronRight, MoreVertical, EyeOff, Eye } from "lucide-react";
import { useStore } from "@/lib/store";
import { MUSCLE_GROUPS } from "@/lib/exercises";
import type { Exercise, MuscleGroup } from "@/lib/types";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { ExerciseDetail } from "@/components/ExerciseDetail";
import { cn } from "@/lib/utils";

export function LibraryPage() {
  const exercises = useStore((s) => s.exercises);
  const hiddenExerciseIds = useStore((s) => s.hiddenExerciseIds);
  const addCustomExercise = useStore((s) => s.addCustomExercise);
  const toggleExerciseHidden = useStore((s) => s.toggleExerciseHidden);

  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<MuscleGroup | "All">("All");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newGroup, setNewGroup] = useState<MuscleGroup>("Chest");
  const [newEquip, setNewEquip] = useState("Barbell");
  const [detail, setDetail] = useState<Exercise | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return exercises.filter(
      (e) =>
        (group === "All" || e.muscleGroup === group) &&
        (!q || e.name.toLowerCase().includes(q))
    );
  }, [exercises, query, group]);

  const grouped = useMemo(() => {
    const map = new Map<MuscleGroup, typeof filtered>();
    for (const e of filtered) {
      const arr = map.get(e.muscleGroup) ?? [];
      arr.push(e);
      map.set(e.muscleGroup, arr);
    }
    return MUSCLE_GROUPS.map((g) => ({ group: g, items: map.get(g) ?? [] })).filter(
      (s) => s.items.length > 0
    );
  }, [filtered]);

  const create = async () => {
    if (!newName.trim()) return;
    try {
      await addCustomExercise({ name: newName.trim(), muscleGroup: newGroup, equipment: newEquip });
      setNewName("");
      setCreating(false);
    } catch {
      /* surfaced inline could be added; keep modal open on failure */
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between pt-2">
        <h1 className="text-2xl font-extrabold tracking-tight">Exercises</h1>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> Custom
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search exercises…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
        {(["All", ...MUSCLE_GROUPS] as const).map((g) => (
          <button
            key={g}
            onClick={() => setGroup(g)}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium tap",
              group === g ? "bg-primary text-primary-foreground" : "bg-secondary"
            )}
          >
            {g}
          </button>
        ))}
      </div>

      <div className="space-y-5">
        {grouped.map(({ group: g, items }) => (
          <div key={g}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {g} <span className="opacity-60">({items.length})</span>
            </h2>
            <div className="space-y-1.5">
              {items.map((e) => {
                const hidden = hiddenExerciseIds.includes(e.id);
                return (
                  <div
                    key={e.id}
                    className={cn(
                      "flex items-center gap-1 rounded-xl border border-border bg-card p-3 hover:border-muted-foreground/40",
                      hidden && "opacity-60"
                    )}
                  >
                    <button
                      onClick={() => setDetail(e)}
                      className="flex flex-1 items-center gap-3 text-left tap"
                    >
                      <div className="rounded-lg bg-secondary p-2 text-muted-foreground">
                        <Dumbbell className="h-4 w-4" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium leading-tight">{e.name}</p>
                        <p className="text-xs text-muted-foreground">{e.equipment} · How to</p>
                      </div>
                      {e.isCustom && <Badge variant="outline">Custom</Badge>}
                      {hidden && <Badge variant="muted">Hidden</Badge>}
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </button>
                    <div className="relative">
                      <button
                        onClick={() => setMenuFor(menuFor === e.id ? null : e.id)}
                        className="rounded-full p-1.5 hover:bg-accent tap"
                      >
                        <MoreVertical className="h-4 w-4 text-muted-foreground" />
                      </button>
                      {menuFor === e.id && (
                        <div
                          className="absolute right-0 top-9 z-10 w-56 rounded-xl border border-border bg-card p-1 shadow-xl"
                          onClick={(ev) => ev.stopPropagation()}
                        >
                          <button
                            onClick={() => {
                              toggleExerciseHidden(e.id);
                              setMenuFor(null);
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-accent tap"
                          >
                            {hidden ? (
                              <>
                                <Eye className="h-4 w-4" /> Show in suggestions
                              </>
                            ) : (
                              <>
                                <EyeOff className="h-4 w-4" /> Hide from suggestions
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">No exercises found.</p>
        )}
      </div>

      <ExerciseDetail exercise={detail} open={!!detail} onClose={() => setDetail(null)} />

      <Modal open={creating} onClose={() => setCreating(false)} title="New exercise">
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
              value={newEquip}
              onChange={(e) => setNewEquip(e.target.value)}
            />
          </div>
          <Button className="w-full" onClick={create} disabled={!newName.trim()}>
            <Check className="h-4 w-4" /> Add to library
          </Button>
        </div>
      </Modal>
    </div>
  );
}
