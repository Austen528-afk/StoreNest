create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists private.platform_admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default pg_catalog.now()
);

alter table private.platform_admin_users enable row level security;
revoke all on table private.platform_admin_users from public, anon, authenticated;

create or replace function private.get_platform_admin_publisher_referrals()
returns table (
  publisher_name text,
  referral_code text,
  publisher_status text,
  business_account_count bigint,
  last_business_registered_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not exists (
    select 1
    from private.platform_admin_users as admin_user
    where admin_user.user_id = v_user_id
  ) then
    raise exception using errcode = '42501', message = 'Platform administrator access required.';
  end if;

  return query
  select
    publisher.display_name,
    publisher.referral_code,
    publisher.status,
    pg_catalog.count(owner_profile.user_id)::bigint,
    pg_catalog.max(owner_profile.created_at)
  from public.publisher_profiles as publisher
  left join public.business_owner_profiles as owner_profile
    on owner_profile.referred_by_publisher_id = publisher.id
  group by publisher.id, publisher.display_name, publisher.referral_code, publisher.status, publisher.created_at
  order by pg_catalog.count(owner_profile.user_id) desc, publisher.created_at asc;
end;
$function$;

revoke all on function private.get_platform_admin_publisher_referrals() from public, anon;
grant execute on function private.get_platform_admin_publisher_referrals() to authenticated;

create or replace function public.get_platform_admin_publisher_referrals()
returns table (
  publisher_name text,
  referral_code text,
  publisher_status text,
  business_account_count bigint,
  last_business_registered_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select * from private.get_platform_admin_publisher_referrals();
$function$;

revoke all on function public.get_platform_admin_publisher_referrals() from public, anon;
grant execute on function public.get_platform_admin_publisher_referrals() to authenticated;