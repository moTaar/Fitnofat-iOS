-- Add an estimated calories-burned column to workout history.
-- Per-set/per-exercise metrics (kind, durationSec, distanceKm, rpe, per-exercise
-- calories) ride inside the existing `exercises` jsonb column, so only the
-- session-level total needs a real column.
alter table public.workouts
  add column if not exists calories numeric not null default 0;
