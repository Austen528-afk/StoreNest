-- Product galleries accept short video clips as well as existing images.
-- Existing ownership path policies are unchanged.
update storage.buckets
set file_size_limit = 20971520,
    allowed_mime_types = array[
      'image/jpeg','image/png','image/webp','image/gif',
      'video/mp4','video/webm'
    ]::text[]
where id = 'storenest-product-media';
