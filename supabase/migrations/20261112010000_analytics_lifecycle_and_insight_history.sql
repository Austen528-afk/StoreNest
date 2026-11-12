-- Record future lifecycle transitions and immutable Smart Insight evidence.
-- Existing orders/bookings are deliberately not backfilled: their transition
-- timestamps were never recorded and must not be inferred from updated_at.

create table if not exists public.business_analytics_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  entity_type text not null check (entity_type in ('order', 'booking')),
  entity_id uuid not null,
  from_status text,
  to_status text not null,
  changed_at timestamptz not null default clock_timestamp(),
  actor_id uuid null references auth.users(id) on delete set null
);

create index if not exists business_analytics_lifecycle_business_time_idx
  on public.business_analytics_lifecycle_events (business_id, changed_at desc);
create index if not exists business_analytics_lifecycle_entity_time_idx
  on public.business_analytics_lifecycle_events (business_id, entity_type, entity_id, changed_at);

alter table public.business_analytics_lifecycle_events enable row level security;
revoke all on public.business_analytics_lifecycle_events from anon, authenticated;
grant select on public.business_analytics_lifecycle_events to authenticated;

drop policy if exists "Owners read their business lifecycle events"
  on public.business_analytics_lifecycle_events;
create policy "Owners read their business lifecycle events"
  on public.business_analytics_lifecycle_events
  for select to authenticated
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_analytics_lifecycle_events.business_id
        and b.owner_id = (select auth.uid())
    )
  );

-- One global start marker lets Analytics distinguish real zero transitions
-- after tracking began from older periods that have no transition history.
create table if not exists public.business_analytics_tracking_config (
  id smallint primary key default 1 check (id = 1),
  lifecycle_tracking_started_at timestamptz not null default clock_timestamp()
);
insert into public.business_analytics_tracking_config (id)
values (1)
on conflict (id) do nothing;

alter table public.business_analytics_tracking_config enable row level security;
revoke all on public.business_analytics_tracking_config from anon, authenticated;
grant select on public.business_analytics_tracking_config to authenticated;
drop policy if exists "Authenticated owners read analytics tracking start"
  on public.business_analytics_tracking_config;
create policy "Authenticated owners read analytics tracking start"
  on public.business_analytics_tracking_config
  for select to authenticated
  using (exists (select 1 from public.businesses b where b.owner_id = (select auth.uid())));

-- This trigger function can only append data derived from the row being
-- inserted/updated. It has no caller-supplied business or status parameters.
create schema if not exists storenest_private;
create or replace function storenest_private.record_analytics_lifecycle_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    insert into public.business_analytics_lifecycle_events
      (business_id, entity_type, entity_id, from_status, to_status, changed_at, actor_id)
    values
      (new.business_id, tg_argv[0], new.id, null, new.status, pg_catalog.clock_timestamp(), auth.uid());
  elsif old.status is distinct from new.status then
    insert into public.business_analytics_lifecycle_events
      (business_id, entity_type, entity_id, from_status, to_status, changed_at, actor_id)
    values
      (new.business_id, tg_argv[0], new.id, old.status, new.status, pg_catalog.clock_timestamp(), auth.uid());
  end if;
  return new;
end;
$function$;
revoke all on function storenest_private.record_analytics_lifecycle_transition() from public, anon, authenticated;

drop trigger if exists storefront_orders_analytics_lifecycle
  on public.storefront_orders;
create trigger storefront_orders_analytics_lifecycle
  after insert or update of status on public.storefront_orders
  for each row execute function storenest_private.record_analytics_lifecycle_transition('order');

drop trigger if exists service_booking_requests_analytics_lifecycle
  on public.service_booking_requests;
create trigger service_booking_requests_analytics_lifecycle
  after insert or update of status on public.service_booking_requests
  for each row execute function storenest_private.record_analytics_lifecycle_transition('booking');

comment on table public.business_analytics_lifecycle_events is
  'Owner-only, database-recorded future order and booking status transitions. No historical events are inferred.';

create table if not exists public.business_analytics_insight_history (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  observation_key text not null check (char_length(observation_key) between 1 and 320),
  insight_key text not null check (char_length(insight_key) between 1 and 180),
  insight_type text not null check (char_length(insight_type) between 1 and 80),
  title text not null check (char_length(title) between 1 and 240),
  explanation text not null default '',
  priority text not null check (priority in ('high', 'medium', 'low')),
  status text not null default 'new'
    check (status in ('new', 'viewed', 'action_taken', 'dismissed', 'resolved')),
  evidence_snapshot jsonb not null default '[]'::jsonb,
  interpretation text not null default '',
  recommendation text not null default '',
  observation_start date not null,
  observation_end date not null,
  detected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  acted_at timestamptz null,
  action_note text null check (action_note is null or char_length(action_note) <= 1000),
  follow_up_snapshot jsonb null,
  metric text null check (metric is null or char_length(metric) <= 80),
  -- Preserve the identifier in historical evidence even if an item is deleted.
  -- A foreign-key action would mutate this immutable insight snapshot.
  item_id uuid null,
  is_service boolean not null default false,
  unique (business_id, observation_key),
  check (observation_end >= observation_start)
);

create index if not exists business_analytics_insight_history_recent_idx
  on public.business_analytics_insight_history (business_id, detected_at desc);
create index if not exists business_analytics_insight_history_status_idx
  on public.business_analytics_insight_history (business_id, status, detected_at desc);

alter table public.business_analytics_insight_history enable row level security;
revoke all on public.business_analytics_insight_history from anon, authenticated;
grant select, insert on public.business_analytics_insight_history to authenticated;
grant update (status, updated_at, acted_at, action_note, follow_up_snapshot)
  on public.business_analytics_insight_history to authenticated;

create or replace function storenest_private.keep_analytics_insight_evidence_immutable()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if row(new.business_id, new.observation_key, new.insight_key, new.insight_type,
         new.title, new.explanation, new.priority, new.evidence_snapshot,
         new.interpretation, new.recommendation, new.observation_start,
         new.observation_end, new.detected_at, new.metric, new.item_id, new.is_service)
     is distinct from
     row(old.business_id, old.observation_key, old.insight_key, old.insight_type,
         old.title, old.explanation, old.priority, old.evidence_snapshot,
         old.interpretation, old.recommendation, old.observation_start,
         old.observation_end, old.detected_at, old.metric, old.item_id, old.is_service) then
    raise exception 'Analytics insight evidence is immutable';
  end if;
  return new;
end;
$function$;
revoke all on function storenest_private.keep_analytics_insight_evidence_immutable() from public, anon, authenticated;

drop trigger if exists business_analytics_insight_evidence_immutable
  on public.business_analytics_insight_history;
create trigger business_analytics_insight_evidence_immutable
  before update on public.business_analytics_insight_history
  for each row execute function storenest_private.keep_analytics_insight_evidence_immutable();

drop policy if exists "Owners read their business insight history"
  on public.business_analytics_insight_history;
create policy "Owners read their business insight history"
  on public.business_analytics_insight_history
  for select to authenticated
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_analytics_insight_history.business_id
        and b.owner_id = (select auth.uid())
    )
  );

drop policy if exists "Owners create their business insight history"
  on public.business_analytics_insight_history;
create policy "Owners create their business insight history"
  on public.business_analytics_insight_history
  for insert to authenticated
  with check (
    exists (
      select 1 from public.businesses b
      where b.id = business_analytics_insight_history.business_id
        and b.owner_id = (select auth.uid())
    )
  );

drop policy if exists "Owners update their business insight history"
  on public.business_analytics_insight_history;
create policy "Owners update their business insight history"
  on public.business_analytics_insight_history
  for update to authenticated
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_analytics_insight_history.business_id
        and b.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.businesses b
      where b.id = business_analytics_insight_history.business_id
        and b.owner_id = (select auth.uid())
    )
  );

comment on table public.business_analytics_insight_history is
  'Owner-only immutable evidence snapshots and action/follow-up states for generated StoreNest Smart Insights.';
comment on column public.business_analytics_insight_history.item_id is
  'Historical catalogue item identifier captured with the insight; intentionally not a foreign key so evidence remains immutable.';
