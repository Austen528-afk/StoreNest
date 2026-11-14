-- Record Publisher attribution on new Business Owner accounts.
-- Existing accounts remain unassigned; referrals are captured only at first profile creation.
alter table public.business_owner_profiles
  add column if not exists referred_by_publisher_id uuid
  references public.publisher_profiles(id) on delete set null;

create index if not exists business_owner_profiles_referrer_idx
  on public.business_owner_profiles (referred_by_publisher_id)
  where referred_by_publisher_id is not null;

alter table public.publisher_profiles
  alter column terms_version set default 'publisher-account-v2';

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.lookup_publisher_id_by_referral_code(p_referral_code text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select p.id
  from public.publisher_profiles as p
  where p.status = 'active'
    and p.referral_code = pg_catalog.upper(pg_catalog.btrim(COALESCE(p_referral_code, '')))
  limit 1;
$function$;

revoke all on function private.lookup_publisher_id_by_referral_code(text) from public, anon;
grant execute on function private.lookup_publisher_id_by_referral_code(text) to authenticated;

create or replace function private.register_business_owner_profile(
  p_full_name text,
  p_referral_code text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_full_name text := pg_catalog.btrim(COALESCE(p_full_name, ''));
  v_referrer_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;

  if pg_catalog.char_length(v_full_name) < 2 or pg_catalog.char_length(v_full_name) > 100 then
    raise exception using errcode = '22023', message = 'Full name must be between 2 and 100 characters.';
  end if;

  if exists (
    select 1
    from public.business_owner_profiles as profile
    where profile.user_id = v_user_id
  ) then
    update public.business_owner_profiles
      set full_name = v_full_name,
          updated_at = pg_catalog.now()
      where user_id = v_user_id;
    return;
  end if;

  if NULLIF(pg_catalog.btrim(COALESCE(p_referral_code, '')), '') is not null then
    v_referrer_id := private.lookup_publisher_id_by_referral_code(p_referral_code);
    if v_referrer_id is null then
      raise exception using errcode = '22023', message = 'Publisher referral link is invalid or inactive.';
    end if;
  end if;

  insert into public.business_owner_profiles (user_id, full_name, referred_by_publisher_id)
  values (v_user_id, v_full_name, v_referrer_id);
end;
$function$;

revoke all on function private.register_business_owner_profile(text, text) from public, anon;
grant execute on function private.register_business_owner_profile(text, text) to authenticated;

create or replace function public.register_business_owner_profile(
  p_full_name text,
  p_referral_code text default null
)
returns void
language sql
security invoker
set search_path = ''
as $function$
  select private.register_business_owner_profile(p_full_name, p_referral_code);
$function$;

revoke all on function public.register_business_owner_profile(text, text) from public, anon, authenticated;
grant execute on function public.register_business_owner_profile(text, text) to authenticated;

create or replace function private.get_my_referred_business_accounts()
returns table (
  business_owner_name text,
  registered_at timestamptz,
  store_names text[],
  store_count bigint,
  published_store_count bigint
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    owner_profile.full_name,
    owner_profile.created_at,
    COALESCE(
      pg_catalog.array_agg(NULLIF(pg_catalog.btrim(business.name), '') order by business.created_at)
        filter (where business.id is not null and pg_catalog.btrim(COALESCE(business.name, '')) <> ''),
      array[]::text[]
    ),
    pg_catalog.count(business.id)::bigint,
    pg_catalog.count(business.id) filter (where business.is_published)::bigint
  from public.publisher_profiles as publisher
  join public.business_owner_profiles as owner_profile
    on owner_profile.referred_by_publisher_id = publisher.id
  left join public.businesses as business
    on business.owner_id = owner_profile.user_id
  where publisher.user_id = auth.uid()
    and publisher.status = 'active'
  group by owner_profile.user_id, owner_profile.full_name, owner_profile.created_at
  order by owner_profile.created_at desc;
$function$;

revoke all on function private.get_my_referred_business_accounts() from public, anon;
grant execute on function private.get_my_referred_business_accounts() to authenticated;

create or replace function public.get_my_referred_business_accounts()
returns table (
  business_owner_name text,
  registered_at timestamptz,
  store_names text[],
  store_count bigint,
  published_store_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select * from private.get_my_referred_business_accounts();
$function$;

revoke all on function public.get_my_referred_business_accounts() from public, anon, authenticated;
grant execute on function public.get_my_referred_business_accounts() to authenticated;

create or replace function private.guard_business_owner_referral_update()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.referred_by_publisher_id is distinct from old.referred_by_publisher_id
     and pg_catalog.pg_trigger_depth() = 1 then
    raise exception 'Publisher referral attribution cannot be changed after Business Owner account registration.';
  end if;
  return new;
end;
$function$;

revoke all on function private.guard_business_owner_referral_update() from public, anon, authenticated;

drop trigger if exists guard_business_owner_referral_update on public.business_owner_profiles;
create trigger guard_business_owner_referral_update
  before update of referred_by_publisher_id on public.business_owner_profiles
  for each row
  execute function private.guard_business_owner_referral_update();

revoke insert, update on table public.business_owner_profiles from authenticated;
grant select on table public.business_owner_profiles to authenticated;
