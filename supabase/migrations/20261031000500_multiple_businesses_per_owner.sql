-- One StoreNest owner account may manage multiple separate businesses.
-- Keep global storefront slugs unique and all ownership RLS policies in place.
alter table public.businesses drop constraint if exists businesses_owner_id_key;
create index if not exists businesses_owner_id_idx on public.businesses(owner_id);
comment on column public.businesses.owner_id is 'The owner account; multiple businesses can belong to the same user.';
