-- Default culinary style for AI nutrition meal suggestions.
-- 'standard' | 'french' | 'italian' | 'korean' | 'mediterranean' | 'mexican' | 'japanese'
alter table public.profiles
  add column if not exists cuisine text not null default 'standard';
