-- StoreNest storefront builder and public discovery, 2026-10-30
alter table public.businesses
  add column if not exists storefront_config jsonb not null default '{}'::jsonb;

create table if not exists public.business_storefront_drafts (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint storefront_draft_is_object check (jsonb_typeof(config) = 'object')
);

alter table public.business_storefront_drafts enable row level security;

create policy "Business owner can manage their own storefront draft"
on public.business_storefront_drafts for all to authenticated
using (
  owner_id = (select auth.uid())
  and exists (
    select 1 from public.businesses b
    where b.id = business_id and b.owner_id = (select auth.uid())
  )
)
with check (
  owner_id = (select auth.uid())
  and exists (
    select 1 from public.businesses b
    where b.id = business_id and b.owner_id = (select auth.uid())
  )
);

grant select,insert,update,delete on public.business_storefront_drafts to authenticated;
revoke all on public.business_storefront_drafts from anon;

-- Published listings must be discoverable regardless of whether a visitor is signed in.
drop policy if exists "Public read published businesses" on public.businesses;
create policy "Public read published businesses" on public.businesses
for select to anon, authenticated using (is_published = true);

drop policy if exists "Public read categories of published businesses" on public.business_categories;
create policy "Public read categories of published businesses" on public.business_categories
for select to anon, authenticated
using (exists (select 1 from public.businesses b where b.id = business_id and b.is_published = true));

drop policy if exists "Public read available items of published businesses" on public.business_items;
create policy "Public read available items of published businesses" on public.business_items
for select to anon, authenticated
using (is_available = true and exists (
  select 1 from public.businesses b where b.id = business_id and b.is_published = true
));

-- Security INVOKER (not DEFINER): existing RLS still governs which businesses/items appear.
create or replace function public.search_storenest_businesses(search_term text)
returns table (
  id uuid, name text, slug text, category text, description text, location text, logo_url text
)
language sql stable security invoker
set search_path = ''
as $$
  with needle as (
    select left(btrim(coalesce(search_term, '')), 80) as query
  )
  select b.id, b.name, b.slug, b.category, b.description, b.location, b.logo_url
  from public.businesses b cross join needle n
  where b.is_published = true
    and length(n.query) >= 1
    and (
      b.name ilike '%' || n.query || '%'
      or b.slug ilike '%' || n.query || '%'
      or b.category ilike '%' || n.query || '%'
      or b.location ilike '%' || n.query || '%'
      or exists (
        select 1 from public.business_items i
        where i.business_id = b.id and i.is_available = true
          and (i.name ilike '%' || n.query || '%'
            or i.description ilike '%' || n.query || '%')
      )
    )
  order by
    case when lower(b.name) = lower(n.query) then 0 else 1 end,
    lower(b.name)
  limit 40;
$$;

revoke all on function public.search_storenest_businesses(text) from public;
grant execute on function public.search_storenest_businesses(text) to anon, authenticated;
