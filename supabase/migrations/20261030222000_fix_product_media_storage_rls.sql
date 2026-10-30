-- Correct storage RLS column shadowing: inside the businesses subquery,
-- unqualified name resolved to businesses.name instead of storage.objects.name.
-- Always qualify the storage object path to compare business folder ownership.
drop policy if exists "StoreNest owners upload product media" on storage.objects;
create policy "StoreNest owners upload product media" on storage.objects
for insert to authenticated
with check (
 bucket_id = 'storenest-product-media'
 and (storage.foldername(storage.objects.name))[1] = (select auth.uid())::text
 and exists (
  select 1 from public.businesses as business
  where business.id::text = (storage.foldername(storage.objects.name))[2]
   and business.owner_id = (select auth.uid())
 )
);
drop policy if exists "StoreNest owners view their media objects" on storage.objects;
create policy "StoreNest owners view their media objects" on storage.objects
for select to authenticated
using (
 bucket_id = 'storenest-product-media'
 and (storage.foldername(storage.objects.name))[1] = (select auth.uid())::text
 and exists (
  select 1 from public.businesses as business
  where business.id::text = (storage.foldername(storage.objects.name))[2]
   and business.owner_id = (select auth.uid())
 )
);
drop policy if exists "StoreNest owners remove product media" on storage.objects;
create policy "StoreNest owners remove product media" on storage.objects
for delete to authenticated
using (
 bucket_id = 'storenest-product-media'
 and (storage.foldername(storage.objects.name))[1] = (select auth.uid())::text
 and exists (
  select 1 from public.businesses as business
  where business.id::text = (storage.foldername(storage.objects.name))[2]
   and business.owner_id = (select auth.uid())
 )
);
