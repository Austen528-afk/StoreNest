-- Marketplace discovery is separate from each owner's freely named storefront sections.
-- A single business can appear in several general discovery categories through its offerings.
alter table public.business_categories
  add column if not exists marketplace_category text not null default 'other';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'business_categories_marketplace_category_check'
      and conrelid = 'public.business_categories'::regclass
  ) then
    alter table public.business_categories
      add constraint business_categories_marketplace_category_check
      check (marketplace_category in (
        'food-drink','events-decor','electronics','fashion','beauty',
        'home-living','groceries','local-services','other'
      ));
  end if;
end $$;

comment on column public.business_categories.marketplace_category is
'General StoreNest marketplace discovery classification; independent of freely named business section and its display_style.';

-- Initial mapping for existing section data; owners can change classifications later.
update public.business_categories c
set marketplace_category =
  case
    when lower(c.name) ~ '(kota|meal|food|cater|kitchen|drink|juice|ice.?cream|snack|plate|dessert|bakery)' then 'food-drink'
    when lower(c.name) ~ '(event|d[eé]cor|balloon|wedding|birthday|cocktail|party|tent|rental|function)' then 'events-decor'
    when lower(c.name) ~ '(phone|iphone|electronic|device|gadget|computer|accessor)' then 'electronics'
    when lower(c.name) ~ '(fashion|clothing|shirt|shoe|dress|jewell|boutique)' then 'fashion'
    when lower(c.name) ~ '(beauty|hair|nail|makeup|barber|salon)' then 'beauty'
    when lower(c.name) ~ '(furniture|interior|curtain|homeware)' then 'home-living'
    when lower(c.name) ~ '(grocery|grocer|spaza|essential)' then 'groceries'
    when lower(c.name) ~ '(repair|cleaning|plumb|tutor|service)' and b.category <> 'Home & Decor' then 'local-services'
    when b.category = 'Food & Drink' then 'food-drink'
    when b.category in ('Home & Decor','Events & Entertainment') then 'events-decor'
    when b.category = 'Beauty & Wellness' then 'beauty'
    when b.category = 'Professional Services' then 'local-services'
    else 'other'
  end
from public.businesses b
where b.id=c.business_id and c.marketplace_category='other';

create index if not exists business_categories_marketplace_lookup_idx
  on public.business_categories(marketplace_category,business_id);

create or replace function public.browse_storenest_category(category_slug text)
returns table (
  id uuid, name text, slug text, category text, description text,
  location text, logo_url text, section_id uuid
)
language sql
stable
security invoker
set search_path to ''
as $function$
  with matches as (
    select b.id, b.name, b.slug, b.category, b.description, b.location,
           b.logo_url, c.id as section_id, 0 as priority
    from public.businesses b
    join public.business_categories c on c.business_id=b.id
    where b.is_published = true
      and c.marketplace_category = category_slug
      and exists (
        select 1 from public.business_items i
        where i.business_id=b.id and i.category_id=c.id and i.is_available=true
      )
    union all
    select b.id, b.name, b.slug, b.category, b.description, b.location,
           b.logo_url, null::uuid as section_id, 1 as priority
    from public.businesses b
    where b.is_published = true
      and not exists (
        select 1 from public.business_categories c where c.business_id=b.id
      )
      and (case
        when b.category = 'Food & Drink' then 'food-drink'
        when b.category in ('Home & Decor','Events & Entertainment') then 'events-decor'
        when b.category = 'Beauty & Wellness' then 'beauty'
        when b.category = 'Professional Services' then 'local-services'
        else 'other'
      end) = category_slug
  ), chosen as (
    select distinct on (m.id)
      m.id, m.name, m.slug, m.category, m.description, m.location,
      m.logo_url, m.section_id
    from matches m
    order by m.id,m.priority,m.section_id
  )
  select c.id,c.name,c.slug,c.category,c.description,c.location,c.logo_url,c.section_id
  from chosen c
  order by lower(c.name),c.id
  limit 80;
$function$;

revoke all on function public.browse_storenest_category(text) from public;
grant execute on function public.browse_storenest_category(text) to anon, authenticated;
