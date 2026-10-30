-- StoreNest secure storefront logo and cover image uploads.
-- Folder convention: auth-user-uuid/business-uuid/logo-or-cover/random-uuid.ext
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('storenest-brand-media','storenest-brand-media',true,8388608,ARRAY['image/jpeg','image/png','image/webp','image/gif']::text[])
on conflict (id) do update set
 public=excluded.public,
 file_size_limit=excluded.file_size_limit,
 allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "StoreNest owners upload brand media" on storage.objects;
create policy "StoreNest owners upload brand media"
on storage.objects for insert to authenticated
with check (
 bucket_id = 'storenest-brand-media'
 and (storage.foldername(storage.objects.name))[1] = (select auth.uid())::text
 and (storage.foldername(storage.objects.name))[3] in ('logo','cover')
 and exists (
   select 1 from public.businesses b
   where b.id::text = (storage.foldername(storage.objects.name))[2]
     and b.owner_id = (select auth.uid())
 )
);

drop policy if exists "StoreNest owners view their brand media objects" on storage.objects;
create policy "StoreNest owners view their brand media objects"
on storage.objects for select to authenticated
using (
 bucket_id = 'storenest-brand-media'
 and (storage.foldername(storage.objects.name))[1] = (select auth.uid())::text
 and (storage.foldername(storage.objects.name))[3] in ('logo','cover')
 and exists (
   select 1 from public.businesses b
   where b.id::text = (storage.foldername(storage.objects.name))[2]
     and b.owner_id = (select auth.uid())
 )
);

drop policy if exists "StoreNest owners delete their brand media objects" on storage.objects;
create policy "StoreNest owners delete their brand media objects"
on storage.objects for delete to authenticated
using (
 bucket_id = 'storenest-brand-media'
 and (storage.foldername(storage.objects.name))[1] = (select auth.uid())::text
 and (storage.foldername(storage.objects.name))[3] in ('logo','cover')
 and exists (
   select 1 from public.businesses b
   where b.id::text = (storage.foldername(storage.objects.name))[2]
     and b.owner_id = (select auth.uid())
 )
);
