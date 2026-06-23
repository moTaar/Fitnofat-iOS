-- Adds equipment_mix to profiles so users can specify a custom combination
-- of equipment (e.g. dumbbells + resistance bands + bodyweight).
-- When equipment = 'mixed', this column lists the specific items chosen.
--
-- Run this in the Supabase SQL editor once per project.

alter table public.profiles
  add column if not exists equipment_mix jsonb;
