-- Permit short, muted video backgrounds as well as existing storefront pictures.
-- Owner-specific Storage RLS policies and logo restrictions remain unchanged.
update storage.buckets
set file_size_limit = 20971520,
    allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'video/mp4', 'video/webm'
    ]::text[]
where id = 'storenest-brand-media';
