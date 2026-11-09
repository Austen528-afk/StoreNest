-- Keep customer display names current anywhere StoreNest stores a name snapshot.
-- SECURITY DEFINER is limited to rows keyed by the profile's own auth user id.
create or replace function public.sync_customer_profile_name_to_records()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'UPDATE' and new.profile_name is not distinct from old.profile_name then
    return new;
  end if;

  update public.storefront_conversations as c
  set customer_label = new.profile_name
  where c.customer_id = new.user_id
    and c.customer_label is distinct from new.profile_name;

  update public.storefront_orders as o
  set customer_name = new.profile_name
  where o.customer_user_id = new.user_id
    and o.customer_name is distinct from new.profile_name;

  update public.service_booking_requests as r
  set customer_name = new.profile_name
  where r.customer_user_id = new.user_id
    and r.customer_name is distinct from new.profile_name;

  return new;
end;
$function$;

revoke all on function public.sync_customer_profile_name_to_records() from public, anon, authenticated;

drop trigger if exists customer_profiles_sync_name_on_insert on public.customer_profiles;
create trigger customer_profiles_sync_name_on_insert
after insert on public.customer_profiles
for each row execute function public.sync_customer_profile_name_to_records();

drop trigger if exists customer_profiles_sync_name_on_update on public.customer_profiles;
create trigger customer_profiles_sync_name_on_update
after update of profile_name on public.customer_profiles
for each row execute function public.sync_customer_profile_name_to_records();