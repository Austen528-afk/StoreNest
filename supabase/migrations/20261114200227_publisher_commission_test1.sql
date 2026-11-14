-- Test 1: Pay on Collection commission tracking.
-- Test rows are isolated and explicitly non-payable. Live referred cash orders
-- are recorded only after collection is PIN-verified and cash receipt is confirmed.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists private.publisher_commission_test_transactions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  test_key text not null unique,
  publisher_id uuid not null references public.publisher_profiles(id) on delete restrict,
  publisher_name_snapshot text not null,
  business_owner_user_id uuid not null references public.business_owner_profiles(user_id) on delete restrict,
  business_id uuid references public.businesses(id) on delete set null,
  business_name_snapshot text not null,
  order_amount numeric(12,2) not null check (order_amount = 100.00),
  platform_fee_rate numeric(5,4) not null check (platform_fee_rate = 0.0500),
  publisher_commission_rate numeric(5,4) not null check (publisher_commission_rate = 0.1500),
  payment_method text not null check (payment_method = 'pay_on_collection'),
  order_status text not null default 'new'
    check (order_status in ('new','accepted','preparing','prepared','ready','completed','cancelled')),
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid','paid')),
  placed_at timestamptz not null default pg_catalog.now(),
  accepted_at timestamptz,
  preparing_at timestamptz,
  prepared_at timestamptz,
  ready_at timestamptz,
  collected_at timestamptz,
  payment_confirmed_at timestamptz,
  stage_history jsonb not null default '[]'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  is_test boolean not null default true check (is_test),
  created_at timestamptz not null default pg_catalog.now(),
  constraint publisher_commission_test_payment_after_collection
    check (payment_status <> 'paid' or (order_status = 'completed' and collected_at is not null and payment_confirmed_at is not null))
);

create table if not exists private.platform_fee_obligations (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  source_order_id uuid unique references public.storefront_orders(id) on delete restrict,
  source_test_transaction_id uuid unique
    references private.publisher_commission_test_transactions(id) on delete restrict,
  business_owner_user_id uuid not null references public.business_owner_profiles(user_id) on delete restrict,
  business_id uuid references public.businesses(id) on delete set null,
  publisher_id uuid references public.publisher_profiles(id) on delete restrict,
  business_name_snapshot text not null,
  order_amount numeric(12,2) not null check (order_amount >= 0),
  platform_fee_rate numeric(5,4) not null check (platform_fee_rate >= 0 and platform_fee_rate <= 1),
  platform_fee_amount numeric(12,2) not null check (platform_fee_amount >= 0),
  amount_collected numeric(12,2) not null default 0 check (amount_collected >= 0 and amount_collected <= platform_fee_amount),
  fee_status text not null default 'outstanding' check (fee_status in ('outstanding','collected')),
  is_test boolean not null default false,
  created_at timestamptz not null default pg_catalog.now(),
  constraint platform_fee_obligation_one_source check ((source_order_id is null) <> (source_test_transaction_id is null)),
  constraint platform_fee_obligation_test_source check (
    (is_test and source_order_id is null and source_test_transaction_id is not null)
    or (not is_test and source_order_id is not null and source_test_transaction_id is null)
  ),
  constraint platform_fee_obligation_collected_state check (
    (fee_status = 'outstanding' and amount_collected < platform_fee_amount)
    or (fee_status = 'collected' and amount_collected = platform_fee_amount)
  )
);

create table if not exists private.publisher_commissions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  platform_fee_obligation_id uuid not null unique
    references private.platform_fee_obligations(id) on delete restrict,
  source_order_id uuid unique references public.storefront_orders(id) on delete restrict,
  source_test_transaction_id uuid unique
    references private.publisher_commission_test_transactions(id) on delete restrict,
  publisher_id uuid not null references public.publisher_profiles(id) on delete restrict,
  business_owner_user_id uuid not null references public.business_owner_profiles(user_id) on delete restrict,
  business_id uuid references public.businesses(id) on delete set null,
  business_name_snapshot text not null,
  payment_method text not null check (payment_method in ('pay_on_collection','card')),
  commission_rate numeric(5,4) not null check (commission_rate >= 0 and commission_rate <= 1),
  commission_amount numeric(12,2) not null check (commission_amount >= 0),
  status text not null default 'pending' check (status in ('pending','earned')),
  is_test boolean not null default false,
  created_at timestamptz not null default pg_catalog.now(),
  earned_at timestamptz,
  constraint publisher_commission_one_source check ((source_order_id is null) <> (source_test_transaction_id is null)),
  constraint publisher_commission_test_source check (
    (is_test and source_order_id is null and source_test_transaction_id is not null)
    or (not is_test and source_order_id is not null and source_test_transaction_id is null)
  ),
  constraint publisher_commission_earned_state check (
    (status = 'pending' and earned_at is null)
    or (status = 'earned' and earned_at is not null)
  )
);

alter table private.publisher_commission_test_transactions enable row level security;
alter table private.platform_fee_obligations enable row level security;
alter table private.publisher_commissions enable row level security;

create or replace function private.guard_publisher_commission_earned()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_fee_status text;
  v_fee_amount numeric(12,2);
  v_collected_amount numeric(12,2);
begin
  if new.status = 'earned' then
    select fee.fee_status, fee.platform_fee_amount, fee.amount_collected
      into v_fee_status, v_fee_amount, v_collected_amount
    from private.platform_fee_obligations as fee
    where fee.id = new.platform_fee_obligation_id
    for update;

    if not found
       or v_fee_status is distinct from 'collected'
       or v_collected_amount < v_fee_amount then
      raise exception 'A Publisher commission cannot be earned before its StoreNest fee has been recovered.'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$;
revoke all on function private.guard_publisher_commission_earned() from public, anon, authenticated;
drop trigger if exists publisher_commission_requires_fee_recovery on private.publisher_commissions;
create trigger publisher_commission_requires_fee_recovery
  before insert or update of status, platform_fee_obligation_id
  on private.publisher_commissions
  for each row execute function private.guard_publisher_commission_earned();

revoke all on table private.publisher_commission_test_transactions,
  private.platform_fee_obligations, private.publisher_commissions
  from public, anon, authenticated;

create or replace function private.record_storefront_order_publisher_commission(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_business_id uuid;
  v_business_owner_user_id uuid;
  v_publisher_id uuid;
  v_business_name text;
  v_order_amount numeric(12,2);
  v_payment_method text;
  v_payment_status text;
  v_order_status text;
  v_fee_rate numeric(5,4) := 0.0500;
  v_commission_rate numeric(5,4) := 0.1500;
  v_fee_amount numeric(12,2);
  v_commission_amount numeric(12,2);
  v_fee_obligation_id uuid;
begin
  select order_row.business_id,
         business_row.owner_id,
         owner_profile.referred_by_publisher_id,
         business_row.name,
         order_row.subtotal,
         order_row.payment_method,
         order_row.payment_status,
         order_row.status
    into v_business_id,
         v_business_owner_user_id,
         v_publisher_id,
         v_business_name,
         v_order_amount,
         v_payment_method,
         v_payment_status,
         v_order_status
  from public.storefront_orders as order_row
  join public.businesses as business_row on business_row.id = order_row.business_id
  left join public.business_owner_profiles as owner_profile
    on owner_profile.user_id = business_row.owner_id
  where order_row.id = p_order_id
  for update of order_row;

  if not found then
    raise exception 'Order not found while recording the Publisher commission.' using errcode = 'P0002';
  end if;

  if v_payment_method is distinct from 'pay_on_collection'
     or v_payment_status is distinct from 'paid'
     or v_order_status is distinct from 'completed'
     or v_publisher_id is null then
    return;
  end if;

  if v_order_amount is null or v_order_amount <= 0 then
    return;
  end if;

  v_order_amount := pg_catalog.round(v_order_amount, 2);
  v_fee_amount := pg_catalog.round(v_order_amount * v_fee_rate, 2);
  if v_fee_amount <= 0 then
    return;
  end if;
  v_commission_amount := pg_catalog.round(v_fee_amount * v_commission_rate, 2);
  v_business_name := COALESCE(NULLIF(pg_catalog.btrim(v_business_name), ''), 'Referred business');

  insert into private.platform_fee_obligations (
    source_order_id, source_test_transaction_id, business_owner_user_id, business_id,
    publisher_id, business_name_snapshot, order_amount, platform_fee_rate,
    platform_fee_amount, amount_collected, fee_status, is_test
  )
  values (
    p_order_id, null, v_business_owner_user_id, v_business_id, v_publisher_id,
    v_business_name, v_order_amount, v_fee_rate, v_fee_amount, 0, 'outstanding', false
  )
  on conflict do nothing;

  select fee.id into v_fee_obligation_id
  from private.platform_fee_obligations as fee
  where fee.source_order_id = p_order_id;

  insert into private.publisher_commissions (
    platform_fee_obligation_id, source_order_id, source_test_transaction_id,
    publisher_id, business_owner_user_id, business_id, business_name_snapshot,
    payment_method, commission_rate, commission_amount, status, is_test
  )
  values (
    v_fee_obligation_id, p_order_id, null, v_publisher_id,
    v_business_owner_user_id, v_business_id, v_business_name, 'pay_on_collection',
    v_commission_rate, v_commission_amount, 'pending', false
  )
  on conflict do nothing;
end;
$function$;
revoke all on function private.record_storefront_order_publisher_commission(uuid) from public, anon, authenticated;

create or replace function private.record_test_publisher_commission(p_test_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_test private.publisher_commission_test_transactions%rowtype;
  v_fee_obligation_id uuid;
  v_fee_amount numeric(12,2);
  v_commission_amount numeric(12,2);
begin
  select * into v_test
  from private.publisher_commission_test_transactions as test_row
  where test_row.id = p_test_transaction_id
  for update;

  if not found then
    raise exception 'Test transaction not found.' using errcode = 'P0002';
  end if;

  if v_test.is_test is distinct from true
     or v_test.payment_method is distinct from 'pay_on_collection'
     or v_test.order_status is distinct from 'completed'
     or v_test.payment_status is distinct from 'paid'
     or v_test.collected_at is null
     or v_test.payment_confirmed_at is null then
    raise exception 'A test commission can be recorded only after collection and cash confirmation.' using errcode = '22023';
  end if;

  v_fee_amount := pg_catalog.round(v_test.order_amount * v_test.platform_fee_rate, 2);
  v_commission_amount := pg_catalog.round(v_fee_amount * v_test.publisher_commission_rate, 2);

  insert into private.platform_fee_obligations (
    source_order_id, source_test_transaction_id, business_owner_user_id, business_id,
    publisher_id, business_name_snapshot, order_amount, platform_fee_rate,
    platform_fee_amount, amount_collected, fee_status, is_test
  )
  values (
    null, v_test.id, v_test.business_owner_user_id, v_test.business_id,
    v_test.publisher_id, v_test.business_name_snapshot, v_test.order_amount,
    v_test.platform_fee_rate, v_fee_amount, 0, 'outstanding', true
  )
  on conflict do nothing;

  select fee.id into v_fee_obligation_id
  from private.platform_fee_obligations as fee
  where fee.source_test_transaction_id = v_test.id;

  insert into private.publisher_commissions (
    platform_fee_obligation_id, source_order_id, source_test_transaction_id,
    publisher_id, business_owner_user_id, business_id, business_name_snapshot,
    payment_method, commission_rate, commission_amount, status, is_test
  )
  values (
    v_fee_obligation_id, null, v_test.id, v_test.publisher_id,
    v_test.business_owner_user_id, v_test.business_id, v_test.business_name_snapshot,
    v_test.payment_method, v_test.publisher_commission_rate, v_commission_amount,
    'pending', true
  )
  on conflict do nothing;
end;
$function$;
revoke all on function private.record_test_publisher_commission(uuid) from public, anon, authenticated;

create or replace function private.get_my_publisher_commission_summary()
returns table (
  total_earned numeric,
  pending_commissions numeric,
  total_commissions numeric,
  referred_businesses bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_publisher_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to view Publisher commission information.' using errcode = '42501';
  end if;

  select publisher.id into v_publisher_id
  from public.publisher_profiles as publisher
  where publisher.user_id = auth.uid();

  if v_publisher_id is null then
    raise exception 'Publisher profile not found.' using errcode = '42501';
  end if;

  return query
  select
    COALESCE(pg_catalog.sum(commission.commission_amount) filter (where commission.status = 'earned'), 0)::numeric,
    COALESCE(pg_catalog.sum(commission.commission_amount) filter (where commission.status = 'pending'), 0)::numeric,
    COALESCE(pg_catalog.sum(commission.commission_amount), 0)::numeric,
    (
      select pg_catalog.count(*)::bigint
      from public.business_owner_profiles as owner_profile
      where owner_profile.referred_by_publisher_id = v_publisher_id
    )
  from private.publisher_commissions as commission
  where commission.publisher_id = v_publisher_id;
end;
$function$;
revoke all on function private.get_my_publisher_commission_summary() from public, anon;
grant execute on function private.get_my_publisher_commission_summary() to authenticated;

create or replace function public.get_my_publisher_commission_summary()
returns table (
  total_earned numeric,
  pending_commissions numeric,
  total_commissions numeric,
  referred_businesses bigint
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select * from private.get_my_publisher_commission_summary();
$function$;
revoke all on function public.get_my_publisher_commission_summary() from public, anon, authenticated;
grant execute on function public.get_my_publisher_commission_summary() to authenticated;

create or replace function private.get_my_publisher_commission_records()
returns table (
  business_name text,
  commission_amount numeric,
  payment_type text,
  status text,
  is_test boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_publisher_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to view Publisher commission information.' using errcode = '42501';
  end if;

  select publisher.id into v_publisher_id
  from public.publisher_profiles as publisher
  where publisher.user_id = auth.uid();

  if v_publisher_id is null then
    raise exception 'Publisher profile not found.' using errcode = '42501';
  end if;

  return query
  select commission.business_name_snapshot,
         commission.commission_amount,
         commission.payment_method,
         commission.status,
         commission.is_test,
         commission.created_at
  from private.publisher_commissions as commission
  where commission.publisher_id = v_publisher_id
  order by commission.created_at desc, commission.id desc;
end;
$function$;
revoke all on function private.get_my_publisher_commission_records() from public, anon;
grant execute on function private.get_my_publisher_commission_records() to authenticated;

create or replace function public.get_my_publisher_commission_records()
returns table (
  business_name text,
  commission_amount numeric,
  payment_type text,
  status text,
  is_test boolean,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select * from private.get_my_publisher_commission_records();
$function$;
revoke all on function public.get_my_publisher_commission_records() from public, anon, authenticated;
grant execute on function public.get_my_publisher_commission_records() to authenticated;

create or replace function private.get_platform_admin_publisher_commission_report()
returns table (
  publisher_name text,
  business_name text,
  sales_generated numeric,
  platform_fees_collected numeric,
  outstanding_platform_fees numeric,
  publisher_commission_earned numeric,
  publisher_commission_pending numeric,
  is_test boolean
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
  select publisher.display_name,
         fee.business_name_snapshot,
         COALESCE(pg_catalog.sum(fee.order_amount), 0)::numeric,
         COALESCE(pg_catalog.sum(fee.amount_collected), 0)::numeric,
         COALESCE(pg_catalog.sum(
           case when fee.fee_status = 'outstanding'
             then fee.platform_fee_amount - fee.amount_collected
             else 0 end
         ), 0)::numeric,
         COALESCE(pg_catalog.sum(commission.commission_amount) filter (where commission.status = 'earned'), 0)::numeric,
         COALESCE(pg_catalog.sum(commission.commission_amount) filter (where commission.status = 'pending'), 0)::numeric,
         fee.is_test
  from private.platform_fee_obligations as fee
  join public.publisher_profiles as publisher on publisher.id = fee.publisher_id
  left join private.publisher_commissions as commission
    on commission.platform_fee_obligation_id = fee.id
  where fee.publisher_id is not null
  group by publisher.id, publisher.display_name, fee.business_name_snapshot, fee.is_test
  order by publisher.display_name, fee.business_name_snapshot, fee.is_test;
end;
$function$;
revoke all on function private.get_platform_admin_publisher_commission_report() from public, anon;
grant execute on function private.get_platform_admin_publisher_commission_report() to authenticated;

create or replace function public.get_platform_admin_publisher_commission_report()
returns table (
  publisher_name text,
  business_name text,
  sales_generated numeric,
  platform_fees_collected numeric,
  outstanding_platform_fees numeric,
  publisher_commission_earned numeric,
  publisher_commission_pending numeric,
  is_test boolean
)
language sql
security invoker
set search_path = ''
as $function$
  select * from private.get_platform_admin_publisher_commission_report();
$function$;
revoke all on function public.get_platform_admin_publisher_commission_report() from public, anon, authenticated;
grant execute on function public.get_platform_admin_publisher_commission_report() to authenticated;

create or replace function private.run_publisher_commission_test_1()
returns table (
  test_transaction_id uuid,
  publisher_name text,
  business_name text,
  sales_generated numeric,
  fees_collected numeric,
  outstanding_fees numeric,
  commission_earned numeric,
  commission_pending numeric,
  fee_record_count bigint,
  commission_record_count bigint
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_publisher_id uuid;
  v_publisher_name text;
  v_owner_user_id uuid;
  v_owner_name text;
  v_business_id uuid;
  v_business_name text;
  v_match_count bigint;
  v_now timestamptz := pg_catalog.now();
  v_test private.publisher_commission_test_transactions%rowtype;
  v_fee_amount numeric(12,2);
  v_fees_collected numeric(12,2);
  v_commission_amount numeric(12,2);
  v_commission_status text;
  v_fee_record_count bigint;
  v_commission_record_count bigint;
begin
  if v_user_id is null or not exists (
    select 1 from private.platform_admin_users as admin_user where admin_user.user_id = v_user_id
  ) then
    raise exception using errcode = '42501', message = 'Platform administrator access required.';
  end if;

  select pg_catalog.count(*) into v_match_count
  from public.publisher_profiles as publisher
  where pg_catalog.upper(pg_catalog.btrim(publisher.display_name)) = 'LEON'
    and publisher.status = 'active';

  if v_match_count <> 1 then
    raise exception 'Test 1 requires exactly one active Publisher account named LEON; found %.', v_match_count using errcode = '22023';
  end if;

  select publisher.id, publisher.display_name
    into v_publisher_id, v_publisher_name
  from public.publisher_profiles as publisher
  where pg_catalog.upper(pg_catalog.btrim(publisher.display_name)) = 'LEON'
    and publisher.status = 'active';

  select pg_catalog.count(*) into v_match_count
  from public.business_owner_profiles as owner_profile
  where owner_profile.referred_by_publisher_id = v_publisher_id
    and pg_catalog.lower(pg_catalog.btrim(owner_profile.full_name)) like 'dino%';

  if v_match_count <> 1 then
    raise exception 'Test 1 requires exactly one existing LEON referral whose Business Owner name starts with Dino; found %.', v_match_count using errcode = '22023';
  end if;

  select owner_profile.user_id, owner_profile.full_name
    into v_owner_user_id, v_owner_name
  from public.business_owner_profiles as owner_profile
  where owner_profile.referred_by_publisher_id = v_publisher_id
    and pg_catalog.lower(pg_catalog.btrim(owner_profile.full_name)) like 'dino%';

  select business_row.id, business_row.name
    into v_business_id, v_business_name
  from public.businesses as business_row
  where business_row.owner_id = v_owner_user_id;

  if not found or NULLIF(pg_catalog.btrim(v_business_name), '') is null then
    v_business_name := COALESCE(NULLIF(pg_catalog.btrim(v_owner_name), ''), 'Dino') || ' business account';
  end if;

  insert into private.publisher_commission_test_transactions (
    test_key, publisher_id, publisher_name_snapshot, business_owner_user_id,
    business_id, business_name_snapshot, order_amount, platform_fee_rate,
    publisher_commission_rate, payment_method, order_status, payment_status,
    stage_history, created_by, is_test
  )
  values (
    'publisher-test-1-pay-on-collection-leon-dino-v1',
    v_publisher_id, v_publisher_name, v_owner_user_id, v_business_id,
    v_business_name, 100.00, 0.0500, 0.1500, 'pay_on_collection',
    'new', 'unpaid',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('status', 'placed', 'at', v_now)),
    v_user_id, true
  )
  on conflict (test_key) do nothing;

  select * into v_test
  from private.publisher_commission_test_transactions as test_row
  where test_row.test_key = 'publisher-test-1-pay-on-collection-leon-dino-v1'
  for update;

  if not found then
    raise exception 'The isolated Test 1 transaction could not be created.' using errcode = 'P0001';
  end if;

  if v_test.publisher_id is distinct from v_publisher_id
     or v_test.business_owner_user_id is distinct from v_owner_user_id then
    raise exception 'The saved Test 1 record no longer matches the existing LEON → Dino referral.' using errcode = '22023';
  end if;

  if v_test.order_status = 'cancelled' then
    raise exception 'The saved Test 1 transaction was cancelled and cannot be confirmed.' using errcode = '22023';
  end if;

  update private.publisher_commission_test_transactions
  set order_status = 'accepted',
      accepted_at = COALESCE(accepted_at, v_now),
      stage_history = stage_history || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('status', 'accepted', 'at', v_now))
  where id = v_test.id and order_status = 'new';

  update private.publisher_commission_test_transactions
  set order_status = 'preparing',
      preparing_at = COALESCE(preparing_at, v_now),
      stage_history = stage_history || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('status', 'preparing', 'at', v_now))
  where id = v_test.id and order_status = 'accepted';

  update private.publisher_commission_test_transactions
  set order_status = 'prepared',
      prepared_at = COALESCE(prepared_at, v_now),
      stage_history = stage_history || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('status', 'prepared', 'at', v_now))
  where id = v_test.id and order_status = 'preparing';

  update private.publisher_commission_test_transactions
  set order_status = 'ready',
      ready_at = COALESCE(ready_at, v_now),
      stage_history = stage_history || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('status', 'ready_for_collection', 'at', v_now))
  where id = v_test.id and order_status = 'prepared';

  update private.publisher_commission_test_transactions
  set order_status = 'completed',
      collected_at = COALESCE(collected_at, v_now),
      stage_history = stage_history || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('status', 'collected', 'at', v_now))
  where id = v_test.id and order_status = 'ready';

  select * into v_test
  from private.publisher_commission_test_transactions as test_row
  where test_row.id = v_test.id
  for update;

  if v_test.order_status is distinct from 'completed' or v_test.collected_at is null then
    raise exception 'The test transaction must complete collection before payment confirmation.' using errcode = '22023';
  end if;

  if v_test.payment_status = 'unpaid' then
    update private.publisher_commission_test_transactions
    set payment_status = 'paid',
        payment_confirmed_at = COALESCE(payment_confirmed_at, v_now),
        stage_history = stage_history || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('status', 'cash_payment_confirmed', 'at', v_now))
    where id = v_test.id;
  end if;

  perform private.record_test_publisher_commission(v_test.id);
  perform private.record_test_publisher_commission(v_test.id);

  select fee.platform_fee_amount, fee.amount_collected
    into v_fee_amount, v_fees_collected
  from private.platform_fee_obligations as fee
  where fee.source_test_transaction_id = v_test.id;

  select commission.commission_amount, commission.status
    into v_commission_amount, v_commission_status
  from private.publisher_commissions as commission
  where commission.source_test_transaction_id = v_test.id;

  select pg_catalog.count(*) into v_fee_record_count
  from private.platform_fee_obligations as fee
  where fee.source_test_transaction_id = v_test.id;

  select pg_catalog.count(*) into v_commission_record_count
  from private.publisher_commissions as commission
  where commission.source_test_transaction_id = v_test.id;

  return query
  select v_test.id,
         v_test.publisher_name_snapshot,
         v_test.business_name_snapshot,
         v_test.order_amount,
         COALESCE(v_fees_collected, 0)::numeric,
         COALESCE(v_fee_amount - v_fees_collected, 0)::numeric,
         case when v_commission_status = 'earned' then COALESCE(v_commission_amount, 0) else 0 end::numeric,
         case when v_commission_status = 'pending' then COALESCE(v_commission_amount, 0) else 0 end::numeric,
         v_fee_record_count,
         v_commission_record_count;
end;
$function$;
revoke all on function private.run_publisher_commission_test_1() from public, anon;
grant execute on function private.run_publisher_commission_test_1() to authenticated;

create or replace function public.run_publisher_commission_test_1()
returns table (
  test_transaction_id uuid,
  publisher_name text,
  business_name text,
  sales_generated numeric,
  fees_collected numeric,
  outstanding_fees numeric,
  commission_earned numeric,
  commission_pending numeric,
  fee_record_count bigint,
  commission_record_count bigint
)
language sql
security invoker
set search_path = ''
as $function$
  select * from private.run_publisher_commission_test_1();
$function$;
revoke all on function public.run_publisher_commission_test_1() from public, anon, authenticated;
grant execute on function public.run_publisher_commission_test_1() to authenticated;

create or replace function storenest_private.confirm_storefront_order_cash_payment(p_order_id uuid)
returns table(confirmed boolean, order_id uuid, payment_status text, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_owner_id uuid;
  v_status text;
  v_payment_method text;
  v_payment_status text;
  v_updated_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Sign in as the business owner to confirm cash received.' using errcode = '42501';
  end if;

  select business_row.owner_id, order_row.status, order_row.payment_method,
         order_row.payment_status, order_row.updated_at
    into v_owner_id, v_status, v_payment_method, v_payment_status, v_updated_at
  from public.storefront_orders as order_row
  join public.businesses as business_row on business_row.id = order_row.business_id
  where order_row.id = p_order_id
  for update of order_row;

  if not found then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  if auth.uid() is distinct from v_owner_id then
    raise exception 'Only this store owner can confirm cash received.' using errcode = '42501';
  end if;

  if v_payment_method is distinct from 'pay_on_collection' then
    raise exception 'Cash receipt confirmation is only available for Pay on collection orders.' using errcode = '22023';
  end if;

  if v_status is distinct from 'completed' then
    raise exception 'The collection PIN must be verified before cash payment is confirmed.' using errcode = '22023';
  end if;

  if v_payment_status = 'paid' then
    return query select true, p_order_id, 'paid'::text, v_updated_at;
    return;
  end if;

  if v_payment_status is distinct from 'unpaid' then
    raise exception 'Only an unpaid cash order can be marked paid.' using errcode = '22023';
  end if;

  update public.storefront_orders as order_row
     set payment_status = 'paid', updated_at = pg_catalog.now()
   where order_row.id = p_order_id
   returning order_row.updated_at into v_updated_at;

  perform private.record_storefront_order_publisher_commission(p_order_id);

  return query select true, p_order_id, 'paid'::text, v_updated_at;
end;
$function$;
revoke all on function storenest_private.confirm_storefront_order_cash_payment(uuid) from public, anon;
grant execute on function storenest_private.confirm_storefront_order_cash_payment(uuid) to authenticated;

create or replace function public.confirm_storefront_order_cash_payment(p_order_id uuid)
returns table(confirmed boolean, order_id uuid, payment_status text, updated_at timestamptz)
language sql
security invoker
set search_path = ''
as $function$
  select * from storenest_private.confirm_storefront_order_cash_payment(p_order_id);
$function$;
revoke all on function public.confirm_storefront_order_cash_payment(uuid) from public, anon;
grant execute on function public.confirm_storefront_order_cash_payment(uuid) to authenticated;
