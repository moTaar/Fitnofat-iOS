-- Adds equipment_prefs to profiles: fine-grained per-item overrides on top of
-- the main `equipment`/`equipment_mix` choice (Settings → Equipment
-- Preferences). Shape: {"bands"?: "include"|"exclude", "freeWeights"?:
-- "include"|"exclude", "machines"?: "include"|"exclude"}. Absent key = no
-- override for that item.
--
-- Run this in the Supabase SQL editor once per project.

alter table public.profiles
  add column if not exists equipment_prefs jsonb;
