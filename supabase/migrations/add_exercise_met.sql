-- Cache a resolved MET (metabolic equivalent) per exercise so calories can be
-- computed deterministically and reused without re-asking the AI.
-- The app resolves a MET once — from its built-in Compendium-of-Physical-
-- Activities table, or via a one-off AI lookup for unknown movements — then
-- stores it here. Every future log of that exercise reuses this value for free.
alter table public.exercises
  add column if not exists met numeric;
