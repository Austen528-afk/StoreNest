alter table public.business_items
  add column if not exists decor_color_sets jsonb not null default '[]'::jsonb
  check (jsonb_typeof(decor_color_sets) = 'array');

comment on column public.business_items.decor_color_sets is
  'Décor-specific colour themes for a service; each set stores its name, optional description, and references to URLs in media_urls.';
