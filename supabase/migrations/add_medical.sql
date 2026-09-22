-- ── Medical / health coaching tables ─────────────────────────────────────────
-- Backs the AI nutritionist + medical helper (server/src/medical.ts) and the
-- Medical dashboard. Everything here is personal health data, so it stays in
-- THIS database: the API never mirrors it anywhere else, and the web client
-- deliberately keeps it out of its localStorage cache.
--
-- Four tables:
--   health_profile       one row per user — the standing medical background
--   health_issues        "things to be worked on" — the dashboard's tracker
--   health_issue_events  the timeline of each issue (check-ins, measurements)
--   health_records       chronological medical history (symptoms, labs, meds…)
--
-- Like every other table here, the API talks to these with the service-role key
-- and scopes each query by user_id; the owner RLS policies are defense in depth.

-- ── health_profile ───────────────────────────────────────────────────────────
-- `ai_consent_at` is a gate, not a preference: until the user explicitly opts in,
-- the medical AI routes refuse to run, so no health data leaves the database for
-- a model provider. Revoking consent clears it back to null.
create table if not exists public.health_profile (
  user_id             uuid primary key references auth.users (id) on delete cascade,
  ai_consent_at       timestamptz,
  conditions          jsonb not null default '[]'::jsonb,  -- ["hypothyroidism"]
  allergies           jsonb not null default '[]'::jsonb,
  medications         jsonb not null default '[]'::jsonb,  -- [{name, dose, schedule}]
  surgeries           jsonb not null default '[]'::jsonb,
  family_history      jsonb not null default '[]'::jsonb,
  blood_type          text,
  smoking             text,        -- 'never' | 'former' | 'current'
  alcohol             text,        -- 'none' | 'occasional' | 'regular' | 'heavy'
  sleep_hours         numeric,
  stress_level        text,        -- 'low' | 'moderate' | 'high'
  notes               text,
  -- Cached result of the last AI review, so the dashboard can show when the
  -- issue list was last refreshed without re-running a (billable) review.
  last_review_at      timestamptz,
  last_review_summary text,
  updated_at          timestamptz not null default now()
);

-- ── health_issues ────────────────────────────────────────────────────────────
-- One row per thing that needs working on. `key` is a stable slug so a repeated
-- AI review updates the issue it already created instead of duplicating it —
-- that is what makes the list trackable over time rather than regenerated.
create table if not exists public.health_issues (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  key              text not null,
  title            text not null,
  category         text not null default 'other',    -- injury|pain|nutrition|metabolic|sleep|stress|medical|lifestyle|other
  status           text not null default 'open',     -- open|in_progress|monitoring|resolved|dismissed
  severity         text not null default 'moderate', -- low|moderate|high|urgent
  progress         int  not null default 0,          -- 0..100, user-owned
  body_region      text,
  summary          text,
  why_it_matters   text,
  action_plan      jsonb not null default '[]'::jsonb, -- [{step, cadence, done}]
  metrics          jsonb not null default '[]'::jsonb, -- [{label, unit, target, latest}]
  red_flags        jsonb not null default '[]'::jsonb, -- ["see a clinician if …"]
  source           text not null default 'ai',       -- ai|user
  confidence       text,                             -- low|medium|high
  first_noticed_at timestamptz,
  target_date      date,
  resolved_at      timestamptz,
  last_reviewed_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, key)
);
create index if not exists health_issues_user_idx on public.health_issues (user_id, status, severity);

-- ── health_issue_events ──────────────────────────────────────────────────────
-- Append-only timeline per issue. A "measurement" event carries metric/value/unit
-- so progress on a tracked number (pain score, weight, blood pressure…) is real
-- data rather than prose.
create table if not exists public.health_issue_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  issue_id   uuid not null references public.health_issues (id) on delete cascade,
  kind       text not null default 'note',  -- note|check_in|status_change|measurement|ai_review
  body       text,
  metric     text,
  value      numeric,
  unit       text,
  created_at timestamptz not null default now()
);
create index if not exists health_issue_events_issue_idx
  on public.health_issue_events (issue_id, created_at desc);

-- ── health_records ───────────────────────────────────────────────────────────
-- The medical history itself: what happened and when. Records can stand alone
-- (a past surgery, a lab panel) or hang off an issue.
create table if not exists public.health_records (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  issue_id    uuid references public.health_issues (id) on delete set null,
  kind        text not null default 'note',  -- symptom|condition|medication|allergy|injury|surgery|lab|vitals|appointment|note
  title       text not null,
  detail      text,
  occurred_at timestamptz not null default now(),
  data        jsonb not null default '{}'::jsonb, -- structured extras (lab values, BP…)
  source      text not null default 'user',  -- user|ai
  created_at  timestamptz not null default now()
);
create index if not exists health_records_user_idx on public.health_records (user_id, occurred_at desc);

-- ── Row Level Security ───────────────────────────────────────────────────────
alter table public.health_profile      enable row level security;
alter table public.health_issues       enable row level security;
alter table public.health_issue_events enable row level security;
alter table public.health_records      enable row level security;

do $$
declare t text;
begin
  foreach t in array array['health_profile','health_issues','health_issue_events','health_records'] loop
    execute format('drop policy if exists "owner_all" on public.%I;', t);
    execute format(
      'create policy "owner_all" on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid());',
      t
    );
  end loop;
end $$;
