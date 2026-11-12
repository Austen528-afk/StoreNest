-- Let the owning business record cash received at collection without entering an amount.
-- The order's saved total remains the amount of record; card orders are not eligible.
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

  select business.owner_id, order_row.status, order_row.payment_method,
         order_row.payment_status, order_row.updated_at
    into v_owner_id, v_status, v_payment_method, v_payment_status, v_updated_at
  from public.storefront_orders as order_row
  join public.businesses as business on business.id = order_row.business_id
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

  if v_status not in ('ready', 'completed') then
    raise exception 'Cash can be confirmed when the order is ready for collection.' using errcode = '22023';
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
