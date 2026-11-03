-- Service enquiries are not shopping-cart orders or payments.
-- Customers can request a date/quote; only the relevant owner may read/respond.
create table if not exists public.service_booking_requests (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.businesses(id) on delete cascade,
 item_id uuid not null references public.business_items(id) on delete cascade,
 customer_name text not null check (char_length(btrim(customer_name)) between 2 and 100),
 contact_phone text check (contact_phone is null or char_length(btrim(contact_phone)) between 7 and 40),
 contact_email text check (contact_email is null or char_length(btrim(contact_email)) between 5 and 160),
 event_date date not null,
 event_location text not null check (char_length(btrim(event_location)) between 2 and 180),
 guest_count integer check (guest_count is null or guest_count between 1 and 100000),
 notes text not null default '' check (char_length(notes) <= 1500),
 status text not null default 'pending' check (status in ('pending','accepted','declined','completed')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint service_booking_requests_contact_required check (
   nullif(btrim(coalesce(contact_phone,'')),'') is not null or
   nullif(btrim(coalesce(contact_email,'')),'') is not null
 )
);
create index if not exists service_booking_requests_by_business
 on public.service_booking_requests(business_id, created_at desc);

alter table public.service_booking_requests enable row level security;

create policy "Public can request a published available service"
on public.service_booking_requests for insert to anon, authenticated
with check (
 status='pending' and event_date>=current_date
 and exists (
  select 1 from public.businesses b
  join public.business_items i on i.business_id=b.id
  where b.id=business_id and i.id=item_id
    and b.is_published=true and i.item_type='service' and i.is_available=true
 )
);

create policy "Owners can read their business booking requests"
on public.service_booking_requests for select to authenticated
using (
 exists (select 1 from public.businesses b
         where b.id=business_id and b.owner_id=(select auth.uid()))
);

create policy "Owners can update their business booking request statuses"
on public.service_booking_requests for update to authenticated
using (
 exists (select 1 from public.businesses b
         where b.id=business_id and b.owner_id=(select auth.uid()))
)
with check (
 exists (select 1 from public.businesses b
         where b.id=business_id and b.owner_id=(select auth.uid()))
);

revoke all on public.service_booking_requests from anon, authenticated;
grant insert(business_id,item_id,customer_name,contact_phone,contact_email,event_date,event_location,guest_count,notes)
 on public.service_booking_requests to anon, authenticated;
grant select on public.service_booking_requests to authenticated;
grant update(status,updated_at) on public.service_booking_requests to authenticated;

comment on table public.service_booking_requests is
 'Private service booking enquiries; no charge or reservation is confirmed at submission.';

-- Jostina's decor and catering are time-based services, not products.
update public.business_items
set item_type='service', updated_at=now()
where business_id='c3605619-e7ca-40e9-a8d7-2f30f519db5c'
and id in (
 'c3d36d39-9bb2-47de-b117-0cc2d59bced5',
 'e5cf4e3f-f495-42f3-bfeb-18070ed6f673'
);
update public.business_categories
set name=case when lower(btrim(name))='service' then 'Décor'
              when lower(btrim(name))='catering' then 'Catering'
              else name end
where business_id='c3605619-e7ca-40e9-a8d7-2f30f519db5c'
and lower(btrim(name)) in ('service','catering');
