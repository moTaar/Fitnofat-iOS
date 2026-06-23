alter table public.profiles
  add column if not exists category text not null default 'mixed';
