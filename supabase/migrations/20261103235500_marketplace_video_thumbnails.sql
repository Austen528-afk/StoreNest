-- Marketplace previews use the first media item, which can now be a short video.
create or replace function public.latest_storenest_category_items(
 category_slug text, max_per_business integer default 5)
returns table(business_id uuid,item_id uuid,category_id uuid,name text,
 price numeric,image_url text,updated_at timestamptz)
language sql stable security invoker set search_path=''
as $function$
 with eligible_businesses as (
   select listed.id from public.browse_storenest_category(category_slug) listed
 ),ranked_items as (
   select item.business_id,item.id as item_id,item.category_id,item.name,item.price,
     coalesce(nullif(item.media_urls->>0,''),item.image_url) as image_url,
     item.updated_at,
     row_number() over(partition by item.business_id order by
       item.updated_at desc nulls last,item.created_at desc,item.id) as rank_in_business
   from public.business_items item
   join eligible_businesses eligible on eligible.id=item.business_id
   left join public.business_categories section on section.id=item.category_id
       and section.business_id=item.business_id
   where item.is_available=true and
     (item.category_id is null or section.marketplace_category=category_slug)
 )
 select r.business_id,r.item_id,r.category_id,r.name,r.price,r.image_url,r.updated_at
 from ranked_items r where r.rank_in_business<=least(greatest(coalesce(max_per_business,5),1),8)
 order by r.business_id,r.rank_in_business;
$function$;
revoke all on function public.latest_storenest_category_items(text,integer) from public;
grant execute on function public.latest_storenest_category_items(text,integer) to anon,authenticated;