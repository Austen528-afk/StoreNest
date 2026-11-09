create table public.storefront_conversations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid not null references auth.users(id) on delete cascade,
  customer_label text not null default 'Customer'
    check (char_length(btrim(customer_label)) between 2 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  last_message_at timestamptz,
  last_message_preview text,
  last_message_sender_id uuid references auth.users(id) on delete set null,
  constraint storefront_conversations_business_customer_key unique (business_id, customer_id)
);

create index storefront_conversations_business_updated_idx
  on public.storefront_conversations (business_id, updated_at desc);
create index storefront_conversations_customer_updated_idx
  on public.storefront_conversations (customer_id, updated_at desc);

create table public.storefront_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.storefront_conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index storefront_messages_conversation_created_idx
  on public.storefront_messages (conversation_id, created_at);
create index storefront_messages_unread_idx
  on public.storefront_messages (conversation_id, read_at)
  where read_at is null;

alter table public.storefront_conversations enable row level security;
alter table public.storefront_messages enable row level security;

revoke all on public.storefront_conversations from anon, authenticated;
revoke all on public.storefront_messages from anon, authenticated;
grant select on public.storefront_conversations to authenticated;
grant insert (business_id, customer_id, customer_label)
  on public.storefront_conversations to authenticated;
grant select on public.storefront_messages to authenticated;
grant insert (conversation_id, sender_id, body)
  on public.storefront_messages to authenticated;
grant update (read_at) on public.storefront_messages to authenticated;

create policy "Participants can read storefront conversations"
on public.storefront_conversations for select to authenticated
using (
  customer_id = (select auth.uid())
  or exists (
    select 1 from public.businesses as b
    where b.id = storefront_conversations.business_id
      and b.owner_id = (select auth.uid())
  )
);

create policy "Customers can start published business conversations"
on public.storefront_conversations for insert to authenticated
with check (
  customer_id = (select auth.uid())
  and exists (
    select 1 from public.businesses as b
    where b.id = storefront_conversations.business_id
      and b.is_published = true
      and b.owner_id <> (select auth.uid())
  )
);

create policy "Participants can read storefront messages"
on public.storefront_messages for select to authenticated
using (
  exists (
    select 1 from public.storefront_conversations as c
    where c.id = storefront_messages.conversation_id
  )
);

create policy "Participants can send storefront messages"
on public.storefront_messages for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and exists (
    select 1 from public.storefront_conversations as c
    where c.id = storefront_messages.conversation_id
  )
);

create policy "Recipients can mark storefront messages as read"
on public.storefront_messages for update to authenticated
using (
  sender_id <> (select auth.uid())
  and exists (
    select 1 from public.storefront_conversations as c
    where c.id = storefront_messages.conversation_id
  )
)
with check (
  sender_id <> (select auth.uid())
  and exists (
    select 1 from public.storefront_conversations as c
    where c.id = storefront_messages.conversation_id
  )
);

create or replace function public.touch_storefront_conversation_after_message()
returns trigger language plpgsql security definer
set search_path = pg_catalog
as $function$
begin
  update public.storefront_conversations
  set updated_at = new.created_at,
      last_message_at = new.created_at,
      last_message_preview = pg_catalog.left(new.body, 180),
      last_message_sender_id = new.sender_id
  where id = new.conversation_id;
  return new;
end;
$function$;
revoke all on function public.touch_storefront_conversation_after_message() from public, anon, authenticated;

create trigger storefront_message_updates_conversation
after insert on public.storefront_messages
for each row execute function public.touch_storefront_conversation_after_message();

do $migration$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='storefront_conversations') then
    alter publication supabase_realtime add table public.storefront_conversations;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='storefront_messages') then
    alter publication supabase_realtime add table public.storefront_messages;
  end if;
end;
$migration$;