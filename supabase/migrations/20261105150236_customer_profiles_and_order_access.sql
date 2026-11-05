-- Customer profiles are verified through Supabase email or phone OTP.
create table if not exists public.customer_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  profile_name text not null check (char_length(btrim(profile_name)) between 2 and 100),
  place text not null check (char_length(btrim(place)) between 2 and 120),
  exact_address text check (exact_address is null or char_length(btrim(exact_address)) <= 280),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customer_profiles enable row level security;

drop policy if exists "Customers can read their own profile" on public.customer_profiles;
create policy "Customers can read their own profile"
  on public.customer_profiles for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Customers can create their own profile" on public.customer_profiles;
create policy "Customers can create their own profile"
  on public.customer_profiles for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Customers can update their own profile" on public.customer_profiles;
create policy "Customers can update their own profile"
  on public.customer_profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on table public.customer_profiles from anon;
grant select, insert, update on table public.customer_profiles to authenticated;

alter table public.storefront_orders
  add column if not exists customer_user_id uuid references auth.users(id) on delete set null,
  add column if not exists customer_place text,
  add column if not exists customer_exact_address text,
  add column if not exists customer_business_name text;

create index if not exists storefront_orders_customer_user_created_idx
  on public.storefront_orders (customer_user_id, created_at desc)
  where customer_user_id is not null;

create or replace function public.attach_storefront_order_customer_profile()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_profile record;
  v_business_name text;
begin
  if auth.uid() is null then
    raise exception 'Sign in or create a customer profile before placing an order.';
  end if;

  select cp.profile_name, cp.place, cp.exact_address
    into v_profile
    from public.customer_profiles cp
    where cp.user_id = auth.uid();

  if not found then
    raise exception 'Create a customer profile before placing an order.';
  end if;

  select b.name
    into v_business_name
    from public.businesses b
    where b.id = new.business_id
      and b.is_published = true;

  if v_business_name is null then
    raise exception 'This store is unavailable for ordering.';
  end if;

  new.customer_user_id := auth.uid();
  new.customer_name := v_profile.profile_name;
  new.customer_place := v_profile.place;
  new.customer_exact_address := v_profile.exact_address;
  new.customer_business_name := v_business_name;
  return new;
end;
$function$;

drop trigger if exists storefront_orders_customer_profile_insert on public.storefront_orders;
create trigger storefront_orders_customer_profile_insert
  before insert on public.storefront_orders
  for each row execute function public.attach_storefront_order_customer_profile();

drop policy if exists "Customers can submit orders to published stores" on public.storefront_orders;
drop policy if exists "Verified customers with profiles can submit orders" on public.storefront_orders;
create policy "Verified customers with profiles can submit orders"
  on public.storefront_orders for insert to authenticated
  with check (
    customer_user_id = (select auth.uid())
    and exists (
      select 1 from public.customer_profiles cp
      where cp.user_id = (select auth.uid())
    )
    and status = 'new'
    and payment_status = case
      when payment_method = 'card' then 'pending'
      else 'unpaid'
    end
    and exists (
      select 1 from public.businesses b
      where b.id = storefront_orders.business_id
        and b.is_published = true
    )
  );

drop policy if exists "Customers can read their own storefront orders" on public.storefront_orders;
create policy "Customers can read their own storefront orders"
  on public.storefront_orders for select to authenticated
  using (customer_user_id = (select auth.uid()));

revoke insert on table public.storefront_orders from anon;
grant select, insert on table public.storefront_orders to authenticated;
