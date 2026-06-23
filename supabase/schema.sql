-- ForgeFit database schema for Supabase (PostgreSQL)
-- Run this in the Supabase SQL editor (or via the CLI) once per project.
--
-- The backend connects with the SERVICE ROLE key and scopes every query by
-- user_id, so it bypasses RLS. RLS policies below are defense-in-depth in case
-- the anon/public key is ever used directly against these tables.

create extension if not exists "pgcrypto";

-- ── profiles ──────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  name           text,
  goal           text not null default 'general',
  category       text not null default 'mixed',
  equipment      text not null default 'full_gym',
  experience     text not null default 'beginner',
  days_per_week  int  not null default 3,
  session_minutes int not null default 60,
  bodyweight_kg  numeric,
  units          text not null default 'kg',
  notes          text,
  onboarded      boolean not null default false,
  updated_at     timestamptz not null default now()
);

-- ── programs ──────────────────────────────────────────────────────────────
create table if not exists public.programs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  weeks       int  not null default 4,
  goal        text not null default 'general',
  iteration   int  not null default 1,
  summary     text,
  created_at  timestamptz not null default now()
);
create index if not exists programs_user_idx on public.programs (user_id, created_at desc);

-- ── routines ──────────────────────────────────────────────────────────────
-- exercises stored as JSONB to keep the AI-first JSON contract intact.
create table if not exists public.routines (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  program_id  uuid references public.programs (id) on delete set null,
  name        text not null,
  description text,
  day_label   text,
  source      text not null default 'manual',  -- 'ai' | 'manual'
  favorite    boolean not null default false,
  position    int not null default 0,
  exercises   jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists routines_user_idx on public.routines (user_id, position);

-- ── exercises (user custom only; the seed library lives in the client) ──────
create table if not exists public.exercises (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  slug         text not null,
  name         text not null,
  muscle_group text not null,
  equipment    text not null default 'Other',
  created_at   timestamptz not null default now(),
  unique (user_id, slug)
);

-- ── workouts (history) ──────────────────────────────────────────────────────
create table if not exists public.workouts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  client_id     text,                         -- for idempotent offline sync
  routine_id    uuid,
  routine_name  text not null,
  started_at    timestamptz not null,
  ended_at      timestamptz,
  duration_sec  int not null default 0,
  total_volume  numeric not null default 0,
  notes         text,
  exercises     jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  unique (user_id, client_id)
);
create index if not exists workouts_user_idx on public.workouts (user_id, started_at desc);

-- ── Row Level Security ───────────────────────────────────────────────────────
alter table public.profiles  enable row level security;
alter table public.programs  enable row level security;
alter table public.routines  enable row level security;
alter table public.exercises enable row level security;
alter table public.workouts  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['profiles','programs','routines','exercises','workouts'] loop
    execute format('drop policy if exists "owner_all" on public.%I;', t);
    -- profiles keys on user_id; others also key on user_id
    execute format(
      'create policy "owner_all" on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid());',
      t
    );
  end loop;
end $$;
