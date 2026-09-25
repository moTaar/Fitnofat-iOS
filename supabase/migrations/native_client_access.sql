-- ── Direct client access (the iOS app) ──────────────────────────────────────
-- The iOS app reads and writes the user's own rows straight through Supabase
-- (anon key + the user's JWT) instead of routing every CRUD call through the
-- data API. That turns the owner RLS policies from defense-in-depth into the
-- actual access control, so this migration closes the two places where "the
-- owner may do anything to their row" was only safe because no client ever had
-- a direct connection:
--
--   1. subscriptions — owner_all let a user UPDATE their own plan to 'pro'.
--      The row is written by the accounts service (service role) from Stripe
--      webhooks; the owner may only read it.
--   2. The health invariants the API used to enforce in its routes now run in
--      the database, so they hold no matter which client did the write:
--        • any user edit to a do & don't rule sets `user_edited` (the AI then
--          leaves that rule alone — see upsertAiRules in the server),
--        • a user-created rule or issue is always source 'user',
--        • an issue's status change stamps/clears `resolved_at` and lands on
--          its timeline as a `status_change` event.
--
-- Service-role writes (the data API and accounts service) are untouched: every
-- trigger below only acts when the request's role is `authenticated`.
--
-- Named without the `add_` prefix so it sorts after every existing migration.

-- ── 1. subscriptions: read-only for the owner ────────────────────────────────
drop policy if exists "owner_all" on public.subscriptions;
drop policy if exists "owner_read" on public.subscriptions;
create policy "owner_read" on public.subscriptions
  for select using (user_id = auth.uid());

-- ── helper: is this write coming from an end-user session? ───────────────────
create or replace function public.is_end_user() returns boolean
language sql stable
as $$
  select coalesce(auth.role(), '') = 'authenticated';
$$;

-- ── 2a. health_rules: a user edit is permanent against later AI turns ────────
create or replace function public.health_rules_user_write() returns trigger
language plpgsql
as $$
begin
  if public.is_end_user() then
    new.user_edited := true;
    new.updated_at := now();
    if tg_op = 'INSERT' then
      new.source := 'user';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists health_rules_user_write on public.health_rules;
create trigger health_rules_user_write
  before insert or update on public.health_rules
  for each row execute function public.health_rules_user_write();

-- ── 2b. health_issues: user-created source, resolved_at follows status ──────
create or replace function public.health_issues_user_write() returns trigger
language plpgsql
as $$
begin
  if public.is_end_user() then
    new.updated_at := now();
    if tg_op = 'INSERT' then
      new.source := 'user';
    elsif new.status is distinct from old.status then
      -- Resolving stamps the date; reopening clears it, so "resolved on" can't
      -- linger on an issue that is open again.
      new.resolved_at := case when new.status = 'resolved' then now() else null end;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists health_issues_user_write on public.health_issues;
create trigger health_issues_user_write
  before insert or update on public.health_issues
  for each row execute function public.health_issues_user_write();

-- A status change is part of the issue's story — record it on the timeline.
-- (The data API writes this event itself on its own PATCH route, which runs as
-- the service role, so the trigger skips that path rather than doubling it.)
create or replace function public.health_issues_status_event() returns trigger
language plpgsql
as $$
begin
  if public.is_end_user() and new.status is distinct from old.status then
    insert into public.health_issue_events (user_id, issue_id, kind, body)
    values (new.user_id, new.id, 'status_change', 'Status changed to ' || new.status);
  end if;
  return new;
end;
$$;

drop trigger if exists health_issues_status_event on public.health_issues;
create trigger health_issues_status_event
  after update on public.health_issues
  for each row execute function public.health_issues_status_event();
