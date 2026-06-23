import { useNavigate } from "react-router-dom";
import { Plus, Play, Star, Pencil, Sparkles, Dumbbell, MoreVertical, Trash2 } from "lucide-react";
import { useState } from "react";
import { useStore } from "@/lib/store";
import type { Routine } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, EmptyState } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";

export function Routines() {
  const navigate = useNavigate();
  const routines = useStore((s) => s.routines);
  const toggleFavorite = useStore((s) => s.toggleFavorite);
  const deleteRoutine = useStore((s) => s.deleteRoutine);
  const startWorkout = useStore((s) => s.startWorkout);
  const [deleteTarget, setDeleteTarget] = useState<Routine | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const aiRoutines = routines.filter((r) => r.source === "ai");
  const manualRoutines = routines.filter((r) => r.source === "manual");

  const begin = (r: Routine) => {
    startWorkout(r);
    navigate("/workout");
  };

  const Section = ({ title, items, icon }: { title: string; items: Routine[]; icon: React.ReactNode }) =>
    items.length === 0 ? null : (
      <div>
        <div className="mb-2 flex items-center gap-2 text-muted-foreground">
          {icon}
          <h2 className="text-sm font-semibold uppercase tracking-wide">{title}</h2>
        </div>
        <div className="space-y-2">
          {items.map((r) => (
            <Card key={r.id}>
              <CardContent className="p-3">
                <div className="flex items-start gap-3">
                  <div className="flex-1" onClick={() => navigate(`/routines/${r.id}`)}>
                    <div className="flex items-center gap-2">
                      {r.dayLabel && <Badge variant="muted">{r.dayLabel}</Badge>}
                      <h3 className="font-semibold leading-tight">{r.name}</h3>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {r.exercises.length} exercises ·{" "}
                      {r.exercises.reduce((n, e) => n + e.sets.length, 0)} sets
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {r.exercises.map((e) => e.name).join(", ")}
                    </p>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <button
                      onClick={() => toggleFavorite(r.id)}
                      className="rounded-full p-1.5 hover:bg-accent tap"
                    >
                      <Star
                        className={r.favorite ? "h-4 w-4 fill-primary text-primary" : "h-4 w-4 text-muted-foreground"}
                      />
                    </button>
                    <div className="relative">
                      <button
                        onClick={() => setMenuFor(menuFor === r.id ? null : r.id)}
                        className="rounded-full p-1.5 hover:bg-accent tap"
                      >
                        <MoreVertical className="h-4 w-4 text-muted-foreground" />
                      </button>
                      {menuFor === r.id && (
                        <div
                          className="absolute right-0 top-9 z-10 w-40 rounded-xl border border-border bg-card p-1 shadow-xl"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => {
                              navigate(`/routines/${r.id}`);
                              setMenuFor(null);
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-accent tap"
                          >
                            <Pencil className="h-4 w-4" /> Edit
                          </button>
                          <button
                            onClick={() => {
                              setDeleteTarget(r);
                              setMenuFor(null);
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-destructive hover:bg-accent tap"
                          >
                            <Trash2 className="h-4 w-4" /> Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <Button size="sm" className="mt-3 w-full" onClick={() => begin(r)}>
                  <Play className="h-4 w-4" /> Start
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between pt-2">
        <h1 className="text-2xl font-extrabold tracking-tight">Routines</h1>
        <Button size="sm" onClick={() => navigate("/routines/new")}>
          <Plus className="h-4 w-4" /> New
        </Button>
      </div>

      {routines.length === 0 ? (
        <EmptyState
          icon={<Dumbbell className="h-6 w-6" />}
          title="No routines yet"
          description="Create one manually or regenerate your AI program."
          action={
            <Button onClick={() => navigate("/routines/new")}>
              <Plus className="h-4 w-4" /> Create routine
            </Button>
          }
        />
      ) : (
        <>
          <Section
            title="AI Program"
            items={aiRoutines}
            icon={<Sparkles className="h-4 w-4" />}
          />
          <Section
            title="My Routines"
            items={manualRoutines}
            icon={<Dumbbell className="h-4 w-4" />}
          />
        </>
      )}

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete routine?">
        <p className="text-sm text-muted-foreground">
          “{deleteTarget?.name}” will be permanently removed.
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => setDeleteTarget(null)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="flex-1"
            onClick={() => {
              if (deleteTarget) deleteRoutine(deleteTarget.id);
              setDeleteTarget(null);
            }}
          >
            Delete
          </Button>
        </div>
      </Modal>
    </div>
  );
}
