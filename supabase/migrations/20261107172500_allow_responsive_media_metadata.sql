alter table public.business_items
  drop constraint if exists business_items_media_urls_valid,
  add constraint business_items_media_urls_valid
  check (
    jsonb_typeof(media_urls) = 'array'
    and jsonb_array_length(media_urls) <= 12
    and not jsonb_path_exists(
      media_urls,
      '$[*] ? (@.type() != "string" && (@.type() != "object" || !exists(@.url) || @.url.type() != "string"))'
    )
  );
