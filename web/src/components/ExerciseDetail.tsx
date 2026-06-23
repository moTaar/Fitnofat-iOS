import type { ReactNode } from "react";
import { Dumbbell, ListChecks, Lightbulb, AlertTriangle, Wind, Target } from "lucide-react";
import type { Exercise } from "@/lib/types";
import { guideFor } from "@/lib/guides";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/misc";
import { MuscleMap } from "@/components/MuscleMap";
import { StickDemo } from "@/components/StickDemo";

// A bottom-sheet that explains how to perform an exercise correctly:
// target muscles, step-by-step execution, form cues, common mistakes, breathing.
export function ExerciseDetail({
  exercise,
  open,
  onClose,
}: {
  exercise: Exercise | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!exercise) return null;
  const g = guideFor(exercise.name);

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

        {(g.primaryMuscles.length > 0 || g.secondaryMuscles?.length) && (
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

        <Section icon={<ListChecks className="h-4 w-4" />} title="How to perform">
          <div className="mb-3 flex items-center justify-center rounded-2xl border border-border bg-secondary/30 p-2">
            <StickDemo name={exercise.name} className="h-40 w-40" />
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
      </div>
    </Modal>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <span className="text-muted-foreground">{icon}</span>
        {title}
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
