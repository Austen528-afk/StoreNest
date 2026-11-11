-- Keep the analytics time-range scan and the product-item foreign key covered.
drop index if exists public.storefront_analytics_events_business_session_idx;

create index if not exists storefront_analytics_events_item_idx
  on public.storefront_analytics_events (item_id);
