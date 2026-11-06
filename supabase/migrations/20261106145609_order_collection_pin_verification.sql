-- Secure per-order collection PINs. Raw PINs are only returned to the
-- authenticated customer and can only be verified by the owning business.
create schema if not exists storenest_private;
revoke all on schema storenest_private from public, anon, authenticated;
grant usage on schema storenest_private to authenticated;

create table if not exists storenest_private.storefront_order_collection_pins (
  order_id uuid primary key references public.storefront_orders(id) on delete cascade,
  pin_value text not null check (pin_value ~ '^[0-9]{6}$'),
  failed_attempts integer not null default 0 check (failed_attempts between 0 and 5),
  locked_until timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table storenest_private.storefront_order_collection_pins enable row level security;
revoke all on storenest_private.storefront_order_collection_pins from public, anon, authenticated;

create or replace function storenest_private.create_storefront_order_collection_pin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_bytes bytea;
  v_random bigint;
  v_pin text;
begin
  v_bytes := extensions.gen_random_bytes(4);
  v_random :=
      pg_catalog.get_byte(v_bytes, 0)::bigint * 16777216
    + pg_catalog.get_byte(v_bytes, 1)::bigint * 65536
    + pg_catalog.get_byte(v_bytes, 2)::bigint * 256
    + pg_catalog.get_byte(v_bytes, 3)::bigint;
  v_pin := pg_catalog.lpad((100000 + (v_random % 900000)::integer)::text, 6, '0');

  insert into storenest_private.storefront_order_collection_pins (order_id, pin_value)
  values (new.id, v_pin);

  return new;
end;
$function$;
revoke all on function storenest_private.create_storefront_order_collection_pin() from public, anon, authenticated;

drop trigger if exists storefront_order_collection_pin_insert on public.storefront_orders;
create trigger storefront_order_collection_pin_insert
after insert on public.storefront_orders
for each row execute function storenest_private.create_storefront_order_collection_pin();

create or replace function storenest_private.get_storefront_order_collection_pin(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_pin text;
begin
  if auth.uid() is null then
    return null;
  end if;

  select pin.pin_value
    into v_pin
  from public.storefront_orders as order_row
  join storenest_private.storefront_order_collection_pins as pin
    on pin.order_id = order_row.id
  where order_row.id = p_order_id
    and order_row.customer_user_id = auth.uid()
    and order_row.status not in ('completed', 'cancelled')
    and pin.consumed_at is null;

  return v_pin;
end;
$function$;
revoke all on function storenest_private.get_storefront_order_collection_pin(uuid) from public, anon;
grant execute on function storenest_private.get_storefront_order_collection_pin(uuid) to authenticated;

create or replace function public.get_storefront_order_collection_pin(p_order_id uuid)
returns text
language sql
security invoker
set search_path = ''
as $function$
  select storenest_private.get_storefront_order_collection_pin(p_order_id);
$function$;
revoke all on function public.get_storefront_order_collection_pin(uuid) from public, anon;
grant execute on function public.get_storefront_order_collection_pin(uuid) to authenticated;

create or replace function storenest_private.verify_storefront_order_collection_pin(p_order_id uuid, p_pin text)
returns table(verified boolean, locked boolean, order_id uuid, status text, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_owner_id uuid;
  v_status text;
  v_updated_at timestamptz;
  v_pin text;
  v_failed_attempts integer;
  v_locked_until timestamptz;
  v_consumed_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Sign in as the business owner to verify this PIN.' using errcode = '42501';
  end if;

  select business.owner_id, order_row.status, order_row.updated_at
    into v_owner_id, v_status, v_updated_at
  from public.storefront_orders as order_row
  join public.businesses as business on business.id = order_row.business_id
  where order_row.id = p_order_id
  for update of order_row;

  if not found then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  if auth.uid() is distinct from v_owner_id then
    raise exception 'Only this store owner can verify the collection PIN.' using errcode = '42501';
  end if;

  if v_status <> 'ready' then
    raise exception 'The collection PIN can be used only when the order is ready.' using errcode = '22023';
  end if;

  select pin.pin_value, pin.failed_attempts, pin.locked_until, pin.consumed_at
    into v_pin, v_failed_attempts, v_locked_until, v_consumed_at
  from storenest_private.storefront_order_collection_pins as pin
  where pin.order_id = p_order_id
  for update;

  if not found then
    raise exception 'This order has no collection PIN.' using errcode = 'P0002';
  end if;

  if v_consumed_at is not null then
    return query select false, false, p_order_id, v_status, v_updated_at;
    return;
  end if;

  if v_locked_until is not null and v_locked_until > pg_catalog.now() then
    return query select false, true, p_order_id, v_status, v_updated_at;
    return;
  end if;

  if v_locked_until is not null and v_locked_until <= pg_catalog.now() then
    v_failed_attempts := 0;
  end if;

  if p_pin is not null and pg_catalog.btrim(p_pin) ~ '^[0-9]{6}$' and pg_catalog.btrim(p_pin) = v_pin then
    update public.storefront_orders as order_row
       set status = 'completed', updated_at = pg_catalog.now()
     where order_row.id = p_order_id
     returning order_row.updated_at into v_updated_at;

    update storenest_private.storefront_order_collection_pins as pin
       set consumed_at = pg_catalog.now(), failed_attempts = 0, locked_until = null
     where pin.order_id = p_order_id;

    return query select true, false, p_order_id, 'completed'::text, v_updated_at;
    return;
  end if;

  v_failed_attempts := coalesce(v_failed_attempts, 0) + 1;
  v_locked_until := case when v_failed_attempts >= 5 then pg_catalog.now() + interval '15 minutes' else null end;
  update storenest_private.storefront_order_collection_pins as pin
     set failed_attempts = least(v_failed_attempts, 5), locked_until = v_locked_until
   where pin.order_id = p_order_id;

  return query select false, v_failed_attempts >= 5, p_order_id, v_status, v_updated_at;
end;
$function$;
revoke all on function storenest_private.verify_storefront_order_collection_pin(uuid, text) from public, anon;
grant execute on function storenest_private.verify_storefront_order_collection_pin(uuid, text) to authenticated;

create or replace function public.verify_storefront_order_collection_pin(p_order_id uuid, p_pin text)
returns table(verified boolean, locked boolean, order_id uuid, status text, updated_at timestamptz)
language sql
security invoker
set search_path = ''
as $function$
  select * from storenest_private.verify_storefront_order_collection_pin(p_order_id, p_pin);
$function$;
revoke all on function public.verify_storefront_order_collection_pin(uuid, text) from public, anon;
grant execute on function public.verify_storefront_order_collection_pin(uuid, text) to authenticated;

create or replace function storenest_private.update_storefront_order_status(p_order_id uuid, p_next_status text)
returns table(order_id uuid, status text, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_owner_id uuid;
  v_current_status text;
  v_updated_at timestamptz;
begin
  select business.owner_id, order_row.status
    into v_owner_id, v_current_status
  from public.storefront_orders as order_row
  join public.businesses as business on business.id = order_row.business_id
  where order_row.id = p_order_id
  for update of order_row;

  if not found then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  if auth.uid() is null or auth.uid() is distinct from v_owner_id then
    raise exception 'Only the store owner can update this order.' using errcode = '42501';
  end if;

  if not (
    (v_current_status = 'new' and p_next_status = 'accepted') or
    (v_current_status = 'accepted' and p_next_status = 'preparing') or
    (v_current_status = 'preparing' and p_next_status = 'prepared') or
    (v_current_status = 'prepared' and p_next_status = 'ready')
  ) then
    raise exception 'This order cannot move from % to %.', v_current_status, p_next_status
      using errcode = '22023';
  end if;

  update public.storefront_orders as order_row
     set status = p_next_status, updated_at = pg_catalog.now()
   where order_row.id = p_order_id
   returning order_row.updated_at into v_updated_at;

  return query select p_order_id, p_next_status, v_updated_at;
end;
$function$;
revoke all on function storenest_private.update_storefront_order_status(uuid, text) from public, anon;
grant execute on function storenest_private.update_storefront_order_status(uuid, text) to authenticated;

create or replace function public.update_storefront_order_status(p_order_id uuid, p_next_status text)
returns table(order_id uuid, status text, updated_at timestamptz)
language sql
security invoker
set search_path = ''
as $function$
  select * from storenest_private.update_storefront_order_status(p_order_id, p_next_status);
$function$;
revoke all on function public.update_storefront_order_status(uuid, text) from public, anon;
grant execute on function public.update_storefront_order_status(uuid, text) to authenticated;

create or replace function public.get_storefront_order_progress(p_order_id uuid, p_tracking_token text)
returns table(status text, updated_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $function$
  select order_row.status, order_row.updated_at
  from public.storefront_orders as order_row
  where order_row.id = p_order_id
    and order_row.tracking_token = p_tracking_token
  limit 1;
$function$;
revoke all on function public.get_storefront_order_progress(uuid, text) from public, anon;
grant execute on function public.get_storefront_order_progress(uuid, text) to authenticated;
