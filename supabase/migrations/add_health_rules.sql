-- ── health_rules : the athlete's personal do & don't list ────────────────────
-- "Eat less acidic food after 20:00", "walk 20 min daily", "no NSAIDs".
--
-- Distinct from health_issues: an issue is a problem being worked on and
-- eventually closed, a rule is a standing instruction that holds until it is
-- changed. A single issue usually produces several rules, which is why
-- `issue_id` is a nullable link rather than a parent.
--
-- Like health_issues, `key` is unique per user so the AI updates the rule it
-- already wrote instead of appending a near-duplicate every conversation.

create table if not exists public.health_rules (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  issue_id     uuid references public.health_issues (id) on delete set null,
  key          text not null,
  domain       text not null default 'lifestyle', -- nutrition|physical|medical|lifestyle
  -- What to do about `subject`. "avoid" is the strongest: the thing is off the
  -- table, not merely reduced.
  direction    text not null default 'less',      -- start|more|less|avoid|keep
  subject      text not null,                     -- "Acidic food within 3h of bed"
  detail       text,                              -- how much, when, what instead
  reason       text,                              -- why — shown so a rule is never mysterious
  status       text not null default 'active',    -- active|paused|archived
  source       text not null default 'ai',        -- ai|user
  confidence   text,                              -- low|medium|high
  -- Set the moment the user edits a rule. The AI may refresh an untouched rule
  -- it wrote, but never overwrites wording the user has taken ownership of.
  user_edited  boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, key)
);
create index if not exists health_rules_user_idx
  on public.health_rules (user_id, status, domain);

alter table public.health_rules enable row level security;

drop policy if exists "owner_all" on public.health_rules;
create policy "owner_all" on public.health_rules
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
