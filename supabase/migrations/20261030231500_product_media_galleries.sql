-- StoreNest product media gallery; keep legacy image_url as the first/cover image.
alter table public.business_items
  add column if not exists media_urls jsonb not null default '[]'::jsonb;

update public.business_items
set media_urls = jsonb_build_array(image_url)
where image_url is not null
  and btrim(image_url) <> ''
  and (media_urls is null or media_urls = '[]'::jsonb);

alter table public.business_items
  drop constraint if exists business_items_media_urls_valid;

alter table public.business_items
  add constraint business_items_media_urls_valid
  check (
    jsonb_typeof(media_urls) = 'array'
    and jsonb_array_length(media_urls) <= 12
    and not jsonb_path_exists(media_urls, '$[*] ? (@.type() != "string")')
  );

comment on column public.business_items.media_urls is 'Ordered public photo and GIF URLs (first image is the primary catalogue image).';
