-- Subscriptions / billing state, owned by the accounts microservice.
-- One row per user; created (free/inactive) at signup, then kept in sync with
-- Stripe via webhooks. The data API reads this table to gate premium features.
-- Tiers themselves live in code (accounts/src/entitlements.ts), not here.

create table if not exists public.subscriptions (
  user_id                uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id     text unique,
  stripe_subscription_id text,
  plan                   text not null default 'free',     -- 'free' | 'pro'
  status                 text not null default 'inactive',  -- active|trialing|past_due|canceled|inactive
  current_period_end     timestamptz,
  updated_at             timestamptz not null default now()
);

create index if not exists subscriptions_customer_idx
  on public.subscriptions (stripe_customer_id);

-- Row Level Security: defense-in-depth (the services use the service-role key and
-- scope by user_id). Mirrors the owner_all policy pattern in schema.sql.
alter table public.subscriptions enable row level security;

drop policy if exists "owner_all" on public.subscriptions;
create policy "owner_all" on public.subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
