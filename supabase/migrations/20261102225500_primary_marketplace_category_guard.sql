-- Marketplace classification safeguard:
-- the business's primary category is authoritative for marketplace discovery.
-- A Home & Decor business must not appear in Food & Drinks merely because it
-- contains a catering section. Sections remain fully visible in its own storefront.
create or replace function public.browse_storenest_category(category_slug text)
returns table (
  id uuid, name text, slug text, category text, description text,
  location text, logo_url text, section_id uuid
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select b.id, b.name, b.slug, b.category, b.description, b.location, b.logo_url,
         matched_section.id as section_id
  from public.businesses b
  left join lateral (
    select c.id
    from public.business_categories c
    where c.business_id = b.id
      and c.marketplace_category = category_slug
      and exists (
        select 1 from public.business_items i
        where i.business_id = b.id and i.category_id = c.id and i.is_available = true
      )
    order by c.display_order, c.id
    limit 1
  ) matched_section on true
  where b.is_published = true
    and (
      (b.category = 'Food & Drink' and category_slug = 'food-drink')
      or (b.category in ('Home & Decor', 'Events & Entertainment')
          and category_slug = 'events-decor')
      or (b.category = 'Beauty & Wellness' and category_slug = 'beauty')
      or (b.category = 'Professional Services' and category_slug = 'local-services')
      or (b.category = 'Retail' and category_slug in
          ('electronics','fashion','home-living','groceries','other')
          and matched_section.id is not null)
      or (b.category = 'Other' and
          (matched_section.id is not null or category_slug = 'other'))
    )
  order by lower(b.name), b.id
  limit 80;
$function$;

revoke all on function public.browse_storenest_category(text) from public;
grant execute on function public.browse_storenest_category(text) to anon, authenticated;

-- Align old automatically classified sections with their business identity.
update public.business_categories c
set marketplace_category='events-decor'
from public.businesses b
where b.id=c.business_id
  and b.category in ('Home & Decor','Events & Entertainment')
  and c.marketplace_category='food-drink';
