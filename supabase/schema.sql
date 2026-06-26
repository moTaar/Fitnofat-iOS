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
  equipment_mix  jsonb,
  onboarded      boolean not null default false,
  -- metabolic data for the AI Nutrition planner
  height_cm      numeric,
  age            int,
  sex            text,                          -- 'male' | 'female' | 'other'
  activity_level text,                          -- 'sedentary' | 'light' | 'moderate' | 'very_active'
  diet_goal      text,                          -- 'lean_gain' | 'recomp' | 'maintain' | 'deficit' | 'aggressive_deficit'
  diet_restrictions jsonb,                      -- e.g. ['vegan','no peanuts']
  cuisine        text not null default 'standard', -- default culinary style for AI meals
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

-- ── exercises (user custom + AI-generated; the seed library lives in the client) ──
-- `guide` caches AI-generated how-to guidance for exercises the AI invents that
-- aren't in the client seed library. `source` is 'custom' (user-added) or 'ai'.
create table if not exists public.exercises (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  slug         text not null,
  name         text not null,
  muscle_group text not null,
  equipment    text not null default 'Other',
  guide        jsonb,
  source       text not null default 'custom',
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

-- ── nutrition_plans (AI diet plan, evolves with the training program) ─────────
-- The full plan (training-day + rest-day macro targets, meals and portions) is
-- stored as JSONB to keep the AI-first JSON contract intact. One active plan per
-- user (latest by created_at); older iterations are kept for history.
create table if not exists public.nutrition_plans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  iteration   int  not null default 1,
  strategy    text,
  summary     text,
  plan        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists nutrition_plans_user_idx on public.nutrition_plans (user_id, created_at desc);

-- ── subscriptions (billing state, owned by the accounts microservice) ─────────
-- One row per user; created (free/inactive) at signup, kept in sync with Stripe
-- via webhooks. The data API reads this table to gate premium features. Tiers
-- live in code (accounts/src/entitlements.ts), not here.
create table if not exists public.subscriptions (
  user_id                uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id     text unique,
  stripe_subscription_id text,
  plan                   text not null default 'free',     -- 'free' | 'pro'
  status                 text not null default 'inactive',  -- active|trialing|past_due|canceled|inactive
  current_period_end     timestamptz,
  updated_at             timestamptz not null default now()
);
create index if not exists subscriptions_customer_idx on public.subscriptions (stripe_customer_id);

-- ── Row Level Security ───────────────────────────────────────────────────────
alter table public.profiles        enable row level security;
alter table public.programs        enable row level security;
alter table public.routines        enable row level security;
alter table public.exercises       enable row level security;
alter table public.workouts        enable row level security;
alter table public.nutrition_plans enable row level security;
alter table public.subscriptions   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['profiles','programs','routines','exercises','workouts','nutrition_plans','subscriptions'] loop
    execute format('drop policy if exists "owner_all" on public.%I;', t);
    -- profiles keys on user_id; others also key on user_id
    execute format(
      'create policy "owner_all" on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid());',
      t
    );
  end loop;
end $$;
