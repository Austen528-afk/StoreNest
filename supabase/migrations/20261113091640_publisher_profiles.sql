-- One StoreNest auth user may hold multiple platform roles. Publisher profile rows
-- use the existing auth user ID and keep personal contact data in existing profiles.
create table if not exists public.publisher_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text not null
    check (char_length(btrim(display_name)) between 2 and 80),
  status text not null default 'active'
    check (status in ('active', 'suspended')),
  referral_code text not null unique
    default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  referred_by_publisher_id uuid
    references public.publisher_profiles(id) on delete set null,
  terms_accepted_at timestamptz not null default now(),
  terms_version text not null default 'publisher-account-v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists publisher_profiles_referrer_idx
  on public.publisher_profiles (referred_by_publisher_id)
  where referred_by_publisher_id is not null;

alter table public.publisher_profiles enable row level security;

drop policy if exists "Publishers can read their own profile" on public.publisher_profiles;
create policy "Publishers can read their own profile"
  on public.publisher_profiles
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Publishers can create their own profile" on public.publisher_profiles;
create policy "Publishers can create their own profile"
  on public.publisher_profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Publishers can update their own profile" on public.publisher_profiles;
create policy "Publishers can update their own profile"
  on public.publisher_profiles
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.publisher_profiles from anon, authenticated;
grant select on table public.publisher_profiles to authenticated;
grant insert (user_id, display_name) on table public.publisher_profiles to authenticated;
grant update (display_name, updated_at) on table public.publisher_profiles to authenticated;
