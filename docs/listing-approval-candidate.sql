-- Candidate migration: DO NOT run on production before isolated schema/checkout tests.
-- Existing public listings retain their availability. All future listings require review.
begin;
alter table public.business_items add column approval_status text,
 add column approval_note text, add column reviewed_at timestamptz,
 add column reviewed_by uuid, add column legitimacy_passed boolean not null default false,
 add column safety_passed boolean not null default false;
update public.business_items set approval_status=case
 when coalesce(image_url,'') like 'r2://%' or coalesce(media_urls::text,'') like '%r2://%' then 'pending'
 else 'legacy' end;
update public.business_items set is_available=false where approval_status='pending';
alter table public.business_items alter column approval_status set default 'pending',
 alter column approval_status set not null,
 add constraint item_approval_status_check check(approval_status in ('legacy','pending','approved','rejected')),
 add constraint item_approval_availability_check check(not is_available or approval_status in ('legacy','approved')),
 add constraint item_approval_evaluation_check check(approval_status<>'approved' or (legitimacy_passed and safety_passed and reviewed_at is not null and reviewed_by is not null));

create function private.guard_item_approval() returns trigger language plpgsql security definer set search_path='' as $$
declare admin boolean := exists(select 1 from private.platform_admin_users where user_id=auth.uid());
begin
 if tg_op='INSERT' then
  new.approval_status:='pending'; new.is_available:=false;
  new.approval_note:=null; new.reviewed_at:=null; new.reviewed_by:=null;
  new.legitimacy_passed:=false; new.safety_passed:=false; new.updated_at:=pg_catalog.clock_timestamp();
  return new;
 end if;
 -- Material changes always invalidate review; only availability, order, views and review metadata are excluded.
 if (pg_catalog.to_jsonb(new)-array['is_available','display_order','view_count','updated_at','approval_status','approval_note','reviewed_at','reviewed_by','legitimacy_passed','safety_passed'])
 is distinct from (pg_catalog.to_jsonb(old)-array['is_available','display_order','view_count','updated_at','approval_status','approval_note','reviewed_at','reviewed_by','legitimacy_passed','safety_passed']) then
  new.approval_status:='pending'; new.approval_note:=null; new.reviewed_at:=null;
  new.reviewed_by:=null; new.legitimacy_passed:=false; new.safety_passed:=false;
  new.is_available:=false; new.updated_at:=pg_catalog.clock_timestamp();
 elsif not admin then
  if row(new.approval_status,new.approval_note,new.reviewed_at,new.reviewed_by,new.legitimacy_passed,new.safety_passed)
   is distinct from row(old.approval_status,old.approval_note,old.reviewed_at,old.reviewed_by,old.legitimacy_passed,old.safety_passed) then
   raise exception using errcode='42501',message='Only HQ can review listings.';
  end if;
  if new.is_available and old.approval_status not in ('legacy','approved') then
   raise exception using errcode='42501',message='Listing approval required.';
  end if;
 end if;
 return new;
end $$;
revoke all on function private.guard_item_approval() from public,anon,authenticated;
create trigger guard_item_approval before insert or update on public.business_items for each row execute function private.guard_item_approval();

create function private.hq_listing_queue() returns setof public.business_items language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from private.platform_admin_users where user_id=auth.uid()) then raise exception using errcode='42501',message='Platform administrator access required.'; end if;
 return query select i.* from public.business_items i where i.approval_status in ('pending','rejected') order by i.updated_at desc limit 100;
end $$;
create function public.hq_listing_queue() returns setof public.business_items language sql stable security invoker set search_path='' as $$ select * from private.hq_listing_queue() $$;
revoke all on function private.hq_listing_queue(),public.hq_listing_queue() from public,anon;
grant execute on function private.hq_listing_queue(),public.hq_listing_queue() to authenticated;

create function private.hq_review_listing(p_item uuid,p_version timestamptz,p_approve boolean,p_legitimate boolean,p_safe boolean,p_note text) returns text language plpgsql security definer set search_path='' as $$
declare item public.business_items%rowtype;
begin
 if not exists(select 1 from private.platform_admin_users where user_id=auth.uid()) then raise exception using errcode='42501',message='Platform administrator access required.'; end if;
 if p_approve is null or p_legitimate is null or p_safe is null or p_version is null then raise exception 'Missing review inputs'; end if;
 if p_approve and not(p_legitimate and p_safe) then raise exception 'Both checks must pass'; end if;
 if not p_approve and coalesce(pg_catalog.length(pg_catalog.btrim(p_note)),0)=0 then raise exception 'Rejection reason required'; end if;
 if pg_catalog.length(coalesce(p_note,''))>2000 then raise exception 'Review note too long'; end if;
 select * into item from public.business_items where id=p_item for update;
 if not found or item.updated_at is distinct from p_version or item.approval_status<>'pending' then raise exception 'Listing changed or is not pending; reload'; end if;
 update public.business_items set approval_status=case when p_approve then 'approved' else 'rejected' end,
 legitimacy_passed=p_legitimate,safety_passed=p_safe,approval_note=p_note,reviewed_by=auth.uid(),reviewed_at=pg_catalog.clock_timestamp(),
 -- Approval is separate from availability: do not release automatically.
 is_available=false,updated_at=pg_catalog.clock_timestamp() where id=p_item;
 return case when p_approve then 'approved' else 'rejected' end;
end $$;
create function public.hq_review_listing(p_item uuid,p_version timestamptz,p_approve boolean,p_legitimate boolean,p_safe boolean,p_note text) returns text language sql security invoker set search_path='' as $$ select private.hq_review_listing(p_item,p_version,p_approve,p_legitimate,p_safe,p_note) $$;
revoke all on function private.hq_review_listing(uuid,timestamptz,boolean,boolean,boolean,text),public.hq_review_listing(uuid,timestamptz,boolean,boolean,boolean,text) from public,anon;
grant execute on function private.hq_review_listing(uuid,timestamptz,boolean,boolean,boolean,text),public.hq_review_listing(uuid,timestamptz,boolean,boolean,boolean,text) to authenticated;

-- Exact reference membership and owner/business namespace, not arbitrary object access.
create function private.item_has_r2_ref(i public.business_items,p_ref text) returns boolean language sql stable security invoker set search_path='' as $$
 select coalesce(i.image_url=p_ref,false) or exists(
 select 1 from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(i.media_urls)='array' then i.media_urls else '[]'::jsonb end) e
 where (case when pg_catalog.jsonb_typeof(e)='string' then e#>>'{}' else e->>'url' end)=p_ref
 or exists(select 1 from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(e->'variants')='array' then e->'variants' else '[]'::jsonb end) v where v->>'url'=p_ref))
$$;
revoke all on function private.item_has_r2_ref(public.business_items,text) from public,anon,authenticated;
create schema catalogue_delivery;
revoke all on schema catalogue_delivery from public;
grant usage on schema catalogue_delivery to anon,authenticated;
create function catalogue_delivery.resolve_catalogue_image(p_item uuid,p_ref text,p_review boolean) returns text language plpgsql stable security definer set search_path='' as $$
declare result text;
begin
 if p_review is null then return null; end if;
 if p_review and not exists(select 1 from private.platform_admin_users where user_id=auth.uid()) then raise exception using errcode='42501',message='Platform administrator access required.'; end if;
 select p_ref into result from public.business_items i join public.businesses b on b.id=i.business_id
 where i.id=p_item and (p_review or (i.approval_status='approved' and i.is_available and b.is_published))
 and p_ref ~ '^r2://storenest-media/r2-catalog-private/[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}\.(png|jpg|webp|gif)$'
 and p_ref like 'r2://storenest-media/r2-catalog-private/'||b.owner_id::text||'/'||b.id::text||'/%'
 and private.item_has_r2_ref(i,p_ref);
 return result;
end $$;
create function public.resolve_catalogue_image(p_item uuid,p_ref text,p_review boolean default false) returns text language sql stable security invoker set search_path='' as $$ select catalogue_delivery.resolve_catalogue_image(p_item,p_ref,p_review) $$;
-- Existing private schema is not exposed through the API; allow wrapper invocation.
revoke all on function catalogue_delivery.resolve_catalogue_image(uuid,text,boolean),public.resolve_catalogue_image(uuid,text,boolean) from public;
grant execute on function catalogue_delivery.resolve_catalogue_image(uuid,text,boolean),public.resolve_catalogue_image(uuid,text,boolean) to anon,authenticated;
commit;
