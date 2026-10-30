create extension if not exists pgcrypto;

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null default '',
  slug text not null unique,
  category text not null default '',
  description text not null default '',
  logo_url text,
  location text not null default '',
  phone text not null default '',
  email text not null default '',
  website text not null default '',
  operating_hours jsonb not null default '{}'::jsonb,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint businesses_name_length check (char_length(name) <= 120),
  constraint businesses_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create table if not exists public.business_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (business_id, name),
  constraint business_categories_name_length check (char_length(btrim(name)) between 1 and 60)
);

create table if not exists public.business_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  category_id uuid references public.business_categories(id) on delete set null,
  item_type text not null default 'product' check (item_type in ('product','service')),
  name text not null,
  description text not null default '',
  price numeric(12,2) not null default 0 check (price >= 0),
  image_url text,
  is_available boolean not null default true,
  display_order integer not null default 0,
  view_count bigint not null default 0 check (view_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_items_name_length check (char_length(btrim(name)) between 1 and 120)
);

create index if not exists business_items_business_order_idx on public.business_items (business_id, display_order, created_at);
create index if not exists business_items_category_idx on public.business_items (category_id);
create index if not exists businesses_published_slug_idx on public.businesses (slug) where is_published;

alter table public.businesses enable row level security;
alter table public.business_categories enable row level security;
alter table public.business_items enable row level security;

drop policy if exists "Business owners read their own business" on public.businesses;
create policy "Business owners read their own business" on public.businesses for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists "Business owners create their own business" on public.businesses;
create policy "Business owners create their own business" on public.businesses for insert to authenticated with check (owner_id = (select auth.uid()));
drop policy if exists "Business owners update their own business" on public.businesses;
create policy "Business owners update their own business" on public.businesses for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists "Business owners delete their own business" on public.businesses;
create policy "Business owners delete their own business" on public.businesses for delete to authenticated using (owner_id = (select auth.uid()));
drop policy if exists "Public read published businesses" on public.businesses;
create policy "Public read published businesses" on public.businesses for select to anon using (is_published);

drop policy if exists "Owners manage their categories" on public.business_categories;
create policy "Owners manage their categories" on public.business_categories for all to authenticated
using (exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = (select auth.uid())))
with check (exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = (select auth.uid())));
drop policy if exists "Public read categories of published businesses" on public.business_categories;
create policy "Public read categories of published businesses" on public.business_categories for select to anon
using (exists (select 1 from public.businesses b where b.id = business_id and b.is_published));

drop policy if exists "Owners manage their items" on public.business_items;
create policy "Owners manage their items" on public.business_items for all to authenticated
using (exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = (select auth.uid())))
with check (exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = (select auth.uid())));
drop policy if exists "Public read available items of published businesses" on public.business_items;
create policy "Public read available items of published businesses" on public.business_items for select to anon
using (is_available and exists (select 1 from public.businesses b where b.id = business_id and b.is_published));

grant select, insert, update, delete on public.businesses, public.business_categories, public.business_items to authenticated;
grant select on public.businesses, public.business_categories, public.business_items to anon;
