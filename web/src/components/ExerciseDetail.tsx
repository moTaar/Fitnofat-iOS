import { useEffect, useState, type ReactNode } from "react";
import { Dumbbell, ListChecks, Lightbulb, AlertTriangle, Wind, Target, Sparkles, RefreshCw } from "lucide-react";
import type { Exercise, ExerciseGuide } from "@/lib/types";
import { guideFor, hasGuide, genericGuide } from "@/lib/guides";
import { useStore } from "@/lib/store";
import { Modal } from "@/components/ui/modal";
import { Badge, Spinner } from "@/components/ui/misc";
import { MuscleMap } from "@/components/MuscleMap";
import { StickDemo } from "@/components/StickDemo";

// A bottom-sheet that explains how to perform an exercise correctly:
// target muscles, step-by-step execution, form cues, common mistakes, breathing.
//
// Guide resolution order: a hand-written guide in the seed library → a cached
// AI guide (for exercises the AI invented) → lazily generate one via AI on the
// first view, falling back to a generic guide if generation fails.
export function ExerciseDetail({
  exercise,
  open,
  onClose,
}: {
  exercise: Exercise | null;
  open: boolean;
  onClose: () => void;
}) {
  const exercises = useStore((s) => s.exercises);
  const fetchExerciseGuide = useStore((s) => s.fetchExerciseGuide);
  const [aiGuide, setAiGuide] = useState<ExerciseGuide | null>(null);
  const [loadingGuide, setLoadingGuide] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const name = exercise?.name;
  const builtIn = name ? hasGuide(name) : false;
  // Prefer a freshly cached library copy (it may already carry an AI guide).
  const cached = exercise ? exercises.find((e) => e.id === exercise.id)?.guide : undefined;

  useEffect(() => {
    if (!open || !exercise || builtIn) return;
    const existing = cached ?? aiGuide;
    if (existing) return;
    let cancelled = false;
    setLoadingGuide(true);
    fetchExerciseGuide({
      name: exercise.name,
      muscleGroup: exercise.muscleGroup,
      equipment: exercise.equipment !== "—" ? exercise.equipment : undefined,
    })
      .then((res) => {
        if (!cancelled) setAiGuide(res.guide ?? genericGuide);
      })
      .catch(() => {
        if (!cancelled) setAiGuide(genericGuide);
      })
      .finally(() => {
        if (!cancelled) setLoadingGuide(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, name, builtIn]);

  const handleRefresh = () => {
    if (!exercise || refreshing) return;
    setRefreshing(true);
    fetchExerciseGuide({
      name: exercise.name,
      muscleGroup: exercise.muscleGroup,
      equipment: exercise.equipment !== "—" ? exercise.equipment : undefined,
      force: true,
    })
      .then((res) => setAiGuide(res.guide ?? genericGuide))
      .catch(() => {/* keep existing guide */})
      .finally(() => setRefreshing(false));
  };

  if (!exercise) return null;

  const g: ExerciseGuide = builtIn ? guideFor(exercise.name) : cached ?? aiGuide ?? genericGuide;
  // Only the AI path (no hand-written guide, nothing cached yet) shows a loader.
  const showLoader = !builtIn && !cached && !aiGuide && loadingGuide;

  const refreshAction = !builtIn ? (
    <button
      onClick={handleRefresh}
      disabled={refreshing}
      title="Regenerate guide"
      className="ml-auto rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
    >
      <RefreshCw className={`h-3.5 w-3.5${refreshing ? " animate-spin" : ""}`} />
    </button>
  ) : null;

  return (
    <Modal open={open} onClose={onClose} title={exercise.name}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge>{exercise.muscleGroup}</Badge>
          <Badge variant="outline">
            <Dumbbell className="mr-1 h-3 w-3" />
            {exercise.equipment}
          </Badge>
          {exercise.isCustom && <Badge variant="muted">Custom</Badge>}
        </div>

        {showLoader && (
          <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-primary/30 bg-primary/10 py-8 text-sm font-medium text-primary">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              <Spinner className="h-4 w-4" />
            </div>
            Generating a how-to guide for this exercise…
          </div>
        )}

        {!showLoader && (g.primaryMuscles.length > 0 || g.secondaryMuscles?.length) && (
          <Section icon={<Target className="h-4 w-4" />} title="Muscles worked">
            <div className="rounded-2xl border border-border bg-secondary/30 p-3">
              <MuscleMap
                primary={g.primaryMuscles}
                secondary={g.secondaryMuscles}
                className="mx-auto h-44 w-full max-w-[260px]"
              />
              <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-primary" /> Primary
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-primary/40" /> Secondary
                </span>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {g.primaryMuscles.map((m) => (
                <Badge key={m}>{m}</Badge>
              ))}
              {g.secondaryMuscles?.map((m) => (
                <Badge key={m} variant="muted">
                  {m}
                </Badge>
              ))}
            </div>
          </Section>
        )}

        {!showLoader && (
          <>
            <Section icon={<ListChecks className="h-4 w-4" />} title="How to perform" action={refreshAction}>
              <div className="mb-3 flex items-center justify-center rounded-2xl border border-border bg-secondary/30 p-2">
                <StickDemo
                  name={exercise.name}
                  pattern={g.pattern}
                  load={g.load}
                  prop={g.prop}
                  className="h-40 w-40"
                />
              </div>
              <ol className="space-y-2">
                {g.steps.map((s, i) => (
                  <li key={i} className="flex gap-2.5 text-sm">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                      {i + 1}
                    </span>
                    <span className="text-foreground/90">{s}</span>
                  </li>
                ))}
              </ol>
            </Section>

            <Section icon={<Lightbulb className="h-4 w-4" />} title="Form tips">
              <BulletList items={g.cues} dotClass="bg-success" />
            </Section>

            <Section icon={<AlertTriangle className="h-4 w-4" />} title="Common mistakes">
              <BulletList items={g.mistakes} dotClass="bg-destructive" />
            </Section>

            {g.breathing && (
              <Section icon={<Wind className="h-4 w-4" />} title="Breathing">
                <p className="text-sm text-foreground/90">{g.breathing}</p>
              </Section>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function Section({
  icon,
  title,
  action,
  children,
}: {
  icon: ReactNode;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <span className="text-muted-foreground">{icon}</span>
        {title}
        {action}
      </div>
      {children}
    </div>
  );
}

function BulletList({ items, dotClass }: { items: string[]; dotClass: string }) {
  return (
    <ul className="space-y-1.5">
      {items.map((t, i) => (
        <li key={i} className="flex gap-2.5 text-sm text-foreground/90">
          <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
          {t}
        </li>
      ))}
    </ul>
  );
}
