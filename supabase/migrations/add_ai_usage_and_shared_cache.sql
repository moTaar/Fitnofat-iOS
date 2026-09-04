-- ── ai_usage : per-user, per-day meter for AI calls ──────────────────────────
-- Backs the daily quotas in server/src/ratelimit.ts. In-process counters are
-- useless here (they reset on deploy and aren't shared between instances), so
-- the meter lives in Postgres. Service-role only — the client never reads it
-- directly, so there is no owner policy and RLS stays on with no grants.
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day     date not null,
  feature text not null,
  count   int  not null default 0,
  primary key (user_id, day, feature)
);
create index if not exists ai_usage_day_idx on public.ai_usage (day);

alter table public.ai_usage enable row level security;
-- No policy: only the service role (which bypasses RLS) touches this table.

-- Atomic increment. Returns the count *after* the bump so the caller can decide
-- in one round trip, and so two concurrent requests can't both see the same
-- pre-increment value and slip past the limit.
create or replace function public.increment_ai_usage(
  p_user_id uuid,
  p_feature text,
  p_day     date
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count int;
begin
  insert into public.ai_usage (user_id, day, feature, count)
  values (p_user_id, p_day, p_feature, 1)
  on conflict (user_id, day, feature)
    do update set count = public.ai_usage.count + 1
  returning count into new_count;
  return new_count;
end;
$$;

revoke all on function public.increment_ai_usage(uuid, text, date) from public, anon, authenticated;

-- Housekeeping: the meter only ever needs the current day. Keep a short tail for
-- debugging and drop the rest. Call from a scheduled job (pg_cron) if available.
create or replace function public.prune_ai_usage() returns void
language sql
security definer
set search_path = public
as $$
  delete from public.ai_usage where day < current_date - interval '30 days';
$$;

-- ── exercise_guides : cross-user cache for generated exercise metadata ───────
-- Previously each user regenerated the same "barbell bench press" guide from
-- scratch, because the only cache was the per-user `exercises` row. Guides are
-- not user-specific, so cache them once globally, keyed on the slug. Populated
-- and read exclusively by the service role.
create table if not exists public.exercise_guides (
  slug         text primary key,
  name         text not null,
  muscle_group text,
  equipment    text,
  guide        jsonb,
  met          numeric,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.exercise_guides enable row level security;
-- No policy: service role only.
