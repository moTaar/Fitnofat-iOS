-- Adds AI-generated how-to guide storage to the exercises table.
-- When the AI invents an exercise that isn't in the client seed library, the
-- app generates full form guidance (muscles worked, steps, cues, mistakes,
-- breathing) on first view and caches it here so it's permanent and synced.
--
-- Run this in the Supabase SQL editor once per project.

alter table public.exercises
  add column if not exists guide jsonb;

-- 'ai' marks exercises auto-created from AI program output (vs. user-added
-- custom exercises). Existing rows are treated as user customs.
alter table public.exercises
  add column if not exists source text not null default 'custom';
