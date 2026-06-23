export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Epley estimated one-rep max. */
export function estimate1RM(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return 0;
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30));
}

const GOAL_LABELS: Record<string, string> = {
  strength: "Strength",
  hypertrophy: "Muscle (Hypertrophy)",
  weight_loss: "Weight Loss",
  endurance: "Endurance",
  general: "General Fitness",
};
export function goalLabel(goal: string): string {
  return GOAL_LABELS[goal] ?? goal;
}
