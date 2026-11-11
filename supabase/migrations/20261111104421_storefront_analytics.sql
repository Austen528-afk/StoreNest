-- StoreNest first-party, privacy-minimal storefront analytics.
-- Session ids are random, tab-scoped identifiers; no customer identity or message content is stored.

alter table public.storefront_orders
  add column if not exists analytics_session_id uuid;

grant insert (analytics_session_id) on public.storefront_orders to authenticated;
grant select (analytics_session_id) on public.storefront_orders to authenticated;

create table if not exists public.storefront_analytics_events (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  event_type text not null check (event_type in ('store_visit', 'product_view', 'cart_add', 'checkout_start')),
  session_id uuid not null,
  item_id uuid null references public.business_items(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  constraint storefront_analytics_event_item_shape check (
    (event_type in ('product_view', 'cart_add') and item_id is not null)
    or (event_type in ('store_visit', 'checkout_start') and item_id is null)
  )
);

comment on table public.storefront_analytics_events is
  'First-party StoreNest storefront events. Uses rotating pseudonymous browser session ids and stores no customer identity.';

create index if not exists storefront_analytics_events_business_time_idx
  on public.storefront_analytics_events (business_id, occurred_at desc);

create index if not exists storefront_analytics_events_business_session_idx
  on public.storefront_analytics_events (business_id, session_id, event_type);

alter table public.storefront_analytics_events enable row level security;

revoke all on public.storefront_analytics_events from anon, authenticated;
grant insert (id, business_id, event_type, session_id, item_id)
  on public.storefront_analytics_events to anon, authenticated;
grant select on public.storefront_analytics_events to authenticated;

drop policy if exists "Published storefronts can record analytics events"
  on public.storefront_analytics_events;
create policy "Published storefronts can record analytics events"
  on public.storefront_analytics_events
  for insert to anon, authenticated
  with check (
    occurred_at >= now() - interval '2 minutes'
    and occurred_at <= now() + interval '1 minute'
    and exists (
      select 1 from public.businesses b
      where b.id = storefront_analytics_events.business_id
        and b.is_published = true
    )
    and (
      (event_type in ('store_visit', 'checkout_start') and item_id is null)
      or (
        event_type in ('product_view', 'cart_add')
        and item_id is not null
        and exists (
          select 1 from public.business_items i
          where i.id = storefront_analytics_events.item_id
            and i.business_id = storefront_analytics_events.business_id
            and i.is_available = true
        )
      )
    )
  );

drop policy if exists "Owners can read their business analytics events"
  on public.storefront_analytics_events;
create policy "Owners can read their business analytics events"
  on public.storefront_analytics_events
  for select to authenticated
  using (
    exists (
      select 1 from public.businesses b
      where b.id = storefront_analytics_events.business_id
        and b.owner_id = (select auth.uid())
    )
  );

create table if not exists public.business_analytics_insight_states (
  business_id uuid not null references public.businesses(id) on delete cascade,
  insight_key text not null check (char_length(insight_key) between 1 and 180),
  status text not null default 'new'
    check (status in ('new', 'viewed', 'action_taken', 'dismissed')),
  updated_at timestamptz not null default now(),
  acted_at timestamptz null,
  primary key (business_id, insight_key)
);

comment on table public.business_analytics_insight_states is
  'Owner-only status for explainable StoreNest Analytics insights; insight evidence is computed from business records.';

alter table public.business_analytics_insight_states enable row level security;
revoke all on public.business_analytics_insight_states from anon, authenticated;
grant select, insert, update on public.business_analytics_insight_states to authenticated;

drop policy if exists "Owners can read analytics insight states"
  on public.business_analytics_insight_states;
create policy "Owners can read analytics insight states"
  on public.business_analytics_insight_states
  for select to authenticated
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_analytics_insight_states.business_id
        and b.owner_id = (select auth.uid())
    )
  );

drop policy if exists "Owners can create analytics insight states"
  on public.business_analytics_insight_states;
create policy "Owners can create analytics insight states"
  on public.business_analytics_insight_states
  for insert to authenticated
  with check (
    exists (
      select 1 from public.businesses b
      where b.id = business_analytics_insight_states.business_id
        and b.owner_id = (select auth.uid())
    )
  );

drop policy if exists "Owners can update analytics insight states"
  on public.business_analytics_insight_states;
create policy "Owners can update analytics insight states"
  on public.business_analytics_insight_states
  for update to authenticated
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_analytics_insight_states.business_id
        and b.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.businesses b
      where b.id = business_analytics_insight_states.business_id
        and b.owner_id = (select auth.uid())
    )
  );
