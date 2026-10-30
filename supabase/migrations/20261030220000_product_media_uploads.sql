-- StoreNest: public product/service media, uploads restricted to verified business owners.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('storenest-product-media','storenest-product-media',true,10485760,ARRAY['image/jpeg','image/png','image/webp','image/gif']::text[])
on conflict (id) do update set
  public=excluded.public,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

-- Path format: owner-uuid/business-uuid/random-uuid.ext
-- Only the authenticated business owner can write under their own business path.
drop policy if exists "StoreNest owners upload product media" on storage.objects;
create policy "StoreNest owners upload product media"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'storenest-product-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.businesses b
    where b.id::text = (storage.foldername(name))[2]
      and b.owner_id = (select auth.uid())
  )
);

drop policy if exists "StoreNest owners view their media objects" on storage.objects;
create policy "StoreNest owners view their media objects"
on storage.objects for select to authenticated
using (
  bucket_id = 'storenest-product-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.businesses b
    where b.id::text = (storage.foldername(name))[2]
      and b.owner_id = (select auth.uid())
  )
);

drop policy if exists "StoreNest owners remove product media" on storage.objects;
create policy "StoreNest owners remove product media"
on storage.objects for delete to authenticated
using (
  bucket_id = 'storenest-product-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.businesses b
    where b.id::text = (storage.foldername(name))[2]
      and b.owner_id = (select auth.uid())
  )
);
