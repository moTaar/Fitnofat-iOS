-- ── Exercise demo videos (YouTube) ───────────────────────────────────────────
-- Replaces the stick-figure demo with real video. Three pieces of state:
--
--   exercise_guides.videos       — cached YouTube search results, keyed by slug
--   exercise_guides.video_picks  — {videoId: count} tally of what users chose
--   exercises.video_id           — this user's chosen demo for this movement
--
-- Caching is not an optimisation here, it is the feature's load-bearing wall.
-- A YouTube Data API `search.list` call costs 100 quota units against a default
-- allocation of 10,000/day — roughly 100 searches per day for the ENTIRE user
-- base. Searching per sheet-open would exhaust that before lunch. A search
-- result describes the movement, not the athlete ("barbell bench press" is the
-- same lift for everybody), so it caches globally exactly like `guide` does,
-- and the steady-state cost drops to one search per distinct exercise name
-- ever seen.

alter table public.exercise_guides
  add column if not exists videos             jsonb,
  add column if not exists videos_updated_at  timestamptz,
  -- {videoId: pickCount}. Users picking a demo is the only real quality signal
  -- we get, so it feeds back into result ordering for everyone after them.
  add column if not exists video_picks        jsonb not null default '{}'::jsonb;

-- The user's chosen demo. Null = never picked; the client then shows the
-- community favourite (highest video_picks) or the top search result.
alter table public.exercises
  add column if not exists video_id text;

-- ── youtube_budget : global, per-day meter for search.list calls ─────────────
-- `ai_usage` can't back this: that meter is per-user, and the constraint here is
-- a single global allocation shared by everybody. Per-user rate limiting alone
-- doesn't protect it — 50 users each politely making 3 searches still burns the
-- whole day's quota. Service-role only, same as ai_usage.
create table if not exists public.youtube_budget (
  day   date not null primary key,
  count int  not null default 0
);

alter table public.youtube_budget enable row level security;
-- No policy: only the service role (which bypasses RLS) touches this table.

-- Atomic increment returning the count *after* the bump, so two concurrent
-- requests can't both read the same pre-increment value and slip past the cap.
create or replace function public.increment_youtube_budget(p_day date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count int;
begin
  insert into public.youtube_budget (day, count)
  values (p_day, 1)
  on conflict (day)
    do update set count = public.youtube_budget.count + 1
  returning count into new_count;
  return new_count;
end;
$$;

revoke all on function public.increment_youtube_budget(date) from public, anon, authenticated;

-- Housekeeping: only the current day is ever read. Keep a short tail for
-- debugging quota exhaustion and drop the rest.
create or replace function public.prune_youtube_budget() returns void
language sql
security definer
set search_path = public
as $$
  delete from public.youtube_budget where day < current_date - interval '30 days';
$$;

revoke all on function public.prune_youtube_budget() from public, anon, authenticated;
