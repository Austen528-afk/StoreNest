-- Expose Business Owner account and storefront details only to verified platform administrators.
-- The HQ server calls this RPC with the administrator's authenticated Supabase user token.
create or replace function private.get_platform_admin_business_accounts()
returns table (
  owner_user_id uuid,
  owner_name text,
  account_email text,
  account_phone text,
  account_created_at timestamptz,
  registered_at timestamptz,
  referred_by_publisher_id uuid,
  referred_by_publisher_name text,
  storefronts jsonb
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
    owner_profile.user_id,
    owner_profile.full_name::text,
    user_account.email::text,
    nullif(user_account.phone, '')::text,
    user_account.created_at,
    owner_profile.created_at,
    owner_profile.referred_by_publisher_id,
    publisher.display_name::text,
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', business.id,
            'name', business.name,
            'category', business.category,
            'description', business.description,
            'location', business.location,
            'phone', business.phone,
            'email', business.email,
            'website', business.website,
            'operatingHours', business.operating_hours,
            'isPublished', business.is_published,
            'createdAt', business.created_at
          )
          order by business.created_at desc
        )
        from public.businesses as business
        where business.owner_id = owner_profile.user_id
      ),
      '[]'::jsonb
    )
  from public.business_owner_profiles as owner_profile
  join auth.users as user_account
    on user_account.id = owner_profile.user_id
  left join public.publisher_profiles as publisher
    on publisher.id = owner_profile.referred_by_publisher_id
  order by owner_profile.created_at desc;
end;
$function$;

revoke all on function private.get_platform_admin_business_accounts() from public, anon;
grant execute on function private.get_platform_admin_business_accounts() to authenticated;

create or replace function public.get_platform_admin_business_accounts()
returns table (
  owner_user_id uuid,
  owner_name text,
  account_email text,
  account_phone text,
  account_created_at timestamptz,
  registered_at timestamptz,
  referred_by_publisher_id uuid,
  referred_by_publisher_name text,
  storefronts jsonb
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select * from private.get_platform_admin_business_accounts();
$function$;

revoke all on function public.get_platform_admin_business_accounts() from public, anon, authenticated;
grant execute on function public.get_platform_admin_business_accounts() to authenticated;

comment on function public.get_platform_admin_business_accounts() is
  'Returns Business Owner account and storefront contact details only to verified platform administrators.';
