-- Owner-defined storefront sections, extending existing catalogue categories.
-- Preserve existing category identifiers and item links.
alter table public.business_categories
 add column if not exists display_style text not null default 'auto',
 add column if not exists display_order integer not null default 0,
 add column if not exists description text not null default '';
alter table public.business_categories drop constraint if exists business_categories_display_style_check;
alter table public.business_categories add constraint business_categories_display_style_check
 check (display_style in ('auto','menu','showcase','catalogue','portfolio'));
alter table public.business_categories drop constraint if exists business_categories_description_length;
alter table public.business_categories add constraint business_categories_description_length
 check (char_length(description) <= 280);
create index if not exists business_categories_business_order_idx on public.business_categories (business_id, display_order, created_at);
comment on table public.business_categories is 'Owner-created storefront sections; categories are flexible labels with individual presentation styles.';
