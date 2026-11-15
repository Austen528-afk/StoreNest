-- Extend the existing StoreNest customer/business messages to every supported one-to-one role pairing.
-- Existing rows and message history are retained; old customer-business conversations remain accepted.

alter table public.storefront_conversations
  add column participant_a_id uuid references auth.users(id) on delete cascade,
  add column participant_b_id uuid references auth.users(id) on delete cascade,
  add column participant_a_role text,
  add column participant_b_role text,
  add column participant_a_business_id uuid references public.businesses(id) on delete set null,
  add column participant_b_business_id uuid references public.businesses(id) on delete set null,
  add column requester_user_id uuid references auth.users(id) on delete set null,
  add column request_status text not null default 'accepted';

alter table public.storefront_conversations
  alter column business_id drop not null,
  alter column customer_id drop not null;

update public.storefront_conversations as c
set participant_a_id = least(c.customer_id, b.owner_id),
    participant_b_id = greatest(c.customer_id, b.owner_id),
    participant_a_role = case when c.customer_id < b.owner_id then 'customer' else 'business_owner' end,
    participant_b_role = case when c.customer_id < b.owner_id then 'business_owner' else 'customer' end,
    participant_a_business_id = case when c.customer_id < b.owner_id then null else c.business_id end,
    participant_b_business_id = case when c.customer_id < b.owner_id then c.business_id else null end,
    request_status = 'accepted'
from public.businesses as b
where b.id = c.business_id;

alter table public.storefront_conversations
  alter column participant_a_id set not null,
  alter column participant_b_id set not null,
  alter column participant_a_role set not null,
  alter column participant_b_role set not null;

alter table public.storefront_conversations
  add constraint storefront_conversations_distinct_participants_check
    check (participant_a_id <> participant_b_id),
  add constraint storefront_conversations_participant_roles_check
    check (
      participant_a_role in ('customer', 'business_owner', 'publisher', 'hq')
      and participant_b_role in ('customer', 'business_owner', 'publisher', 'hq')
    ),
  add constraint storefront_conversations_request_state_check
    check (
      request_status in ('pending', 'accepted', 'declined')
      and (request_status <> 'pending' or requester_user_id in (participant_a_id, participant_b_id))
    );

create unique index storefront_conversations_pair_without_business_key
  on public.storefront_conversations (least(participant_a_id, participant_b_id), greatest(participant_a_id, participant_b_id))
  where business_id is null;
create unique index storefront_conversations_pair_business_key
  on public.storefront_conversations (least(participant_a_id, participant_b_id), greatest(participant_a_id, participant_b_id), business_id)
  where business_id is not null;
create index storefront_conversations_participant_a_updated_idx
  on public.storefront_conversations (participant_a_id, updated_at desc);
create index storefront_conversations_participant_b_updated_idx
  on public.storefront_conversations (participant_b_id, updated_at desc);

alter table public.storefront_messages
  add column sender_role text,
  add column sender_business_id uuid references public.businesses(id) on delete set null,
  add column sender_display_name text;

update public.storefront_messages as m
set sender_role = case
      when m.sender_id = c.participant_a_id then c.participant_a_role
      else c.participant_b_role
    end,
    sender_business_id = case
      when m.sender_id = c.participant_a_id then c.participant_a_business_id
      else c.participant_b_business_id
    end,
    sender_display_name = case
      when m.sender_id = c.participant_a_id then
        case c.participant_a_role
          when 'customer' then coalesce(nullif(cp.profile_name, ''), 'Customer')
          when 'business_owner' then coalesce(nullif(ba.name, ''), nullif(bp.full_name, ''), 'Business Owner')
          when 'publisher' then coalesce(nullif(pa.display_name, ''), 'Publisher')
          else 'StoreNest HQ'
        end
      else
        case c.participant_b_role
          when 'customer' then coalesce(nullif(cp.profile_name, ''), 'Customer')
          when 'business_owner' then coalesce(nullif(bb.name, ''), nullif(bp.full_name, ''), 'Business Owner')
          when 'publisher' then coalesce(nullif(pb.display_name, ''), 'Publisher')
          else 'StoreNest HQ'
        end
    end
from public.storefront_conversations as c
left join public.businesses as ba on ba.id = c.participant_a_business_id
left join public.businesses as bb on bb.id = c.participant_b_business_id
left join public.customer_profiles as cp on cp.user_id = m.sender_id
left join public.business_owner_profiles as bp on bp.user_id = m.sender_id
left join public.publisher_profiles as pa on pa.user_id = m.sender_id
left join public.publisher_profiles as pb on pb.user_id = m.sender_id
where c.id = m.conversation_id;

alter table public.storefront_messages
  alter column sender_role set not null,
  alter column sender_display_name set not null,
  add constraint storefront_messages_sender_role_check
    check (sender_role in ('customer', 'business_owner', 'publisher', 'hq'));

create table public.message_user_blocks (
  blocker_user_id uuid not null references auth.users(id) on delete cascade,
  blocked_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_user_id, blocked_user_id),
  constraint message_user_blocks_distinct_users_check check (blocker_user_id <> blocked_user_id)
);
alter table public.message_user_blocks enable row level security;
revoke all on public.message_user_blocks from public, anon, authenticated;
grant select, insert on public.message_user_blocks to authenticated;
create policy "Users can read blocks involving their own account"
on public.message_user_blocks for select to authenticated
using (blocker_user_id = (select auth.uid()) or blocked_user_id = (select auth.uid()));
create policy "Users can block another account"
on public.message_user_blocks for insert to authenticated
with check (blocker_user_id = (select auth.uid()));

create or replace function private.storenest_message_role_is_valid(
  p_user_id uuid,
  p_role text,
  p_business_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select case p_role
    when 'customer' then exists (
      select 1 from public.customer_profiles as p where p.user_id = p_user_id
    )
    when 'business_owner' then exists (
      select 1 from public.business_owner_profiles as p where p.user_id = p_user_id
    ) and (
      p_business_id is null or exists (
        select 1 from public.businesses as b where b.id = p_business_id and b.owner_id = p_user_id
      )
    )
    when 'publisher' then exists (
      select 1 from public.publisher_profiles as p
      where p.user_id = p_user_id and p.status = 'active'
    )
    when 'hq' then exists (
      select 1 from private.platform_admin_users as a where a.user_id = p_user_id
    )
    else false
  end;
$function$;
revoke all on function private.storenest_message_role_is_valid(uuid, text, uuid) from public, anon, authenticated;

create or replace function private.storenest_message_display_name(
  p_user_id uuid,
  p_role text,
  p_business_id uuid default null
)
returns text
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select case p_role
    when 'customer' then coalesce(
      (select nullif(pg_catalog.btrim(p.profile_name), '') from public.customer_profiles as p where p.user_id = p_user_id),
      'Customer'
    )
    when 'business_owner' then coalesce(
      (select nullif(pg_catalog.btrim(b.name), '') from public.businesses as b where b.id = p_business_id and b.owner_id = p_user_id),
      (select nullif(pg_catalog.btrim(p.full_name), '') from public.business_owner_profiles as p where p.user_id = p_user_id),
      'Business Owner'
    )
    when 'publisher' then coalesce(
      (select nullif(pg_catalog.btrim(p.display_name), '') from public.publisher_profiles as p where p.user_id = p_user_id),
      'Publisher'
    )
    when 'hq' then 'StoreNest HQ'
    else 'StoreNest account'
  end;
$function$;
revoke all on function private.storenest_message_display_name(uuid, text, uuid) from public, anon, authenticated;

create or replace function private.set_storefront_message_identity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_conversation public.storefront_conversations%rowtype;
begin
  select * into v_conversation
  from public.storefront_conversations as c
  where c.id = new.conversation_id;

  if not found then
    raise exception using errcode = '42501', message = 'Conversation is unavailable.';
  end if;

  if new.sender_id = v_conversation.participant_a_id then
    new.sender_role := v_conversation.participant_a_role;
    new.sender_business_id := v_conversation.participant_a_business_id;
  elsif new.sender_id = v_conversation.participant_b_id then
    new.sender_role := v_conversation.participant_b_role;
    new.sender_business_id := v_conversation.participant_b_business_id;
  else
    raise exception using errcode = '42501', message = 'Only conversation participants can send messages.';
  end if;

  if v_conversation.request_status = 'declined'
     or not private.storenest_message_role_is_valid(new.sender_id, new.sender_role, new.sender_business_id) then
    raise exception using errcode = '42501', message = 'This account cannot send a message in this conversation.';
  end if;

  if v_conversation.request_status = 'pending' then
    if new.sender_id <> v_conversation.requester_user_id
      or exists (select 1 from public.storefront_messages as prior where prior.conversation_id = new.conversation_id) then
      raise exception using errcode = '42501', message = 'Wait for the recipient to accept this message request.';
    end if;
  end if;

  if exists (
    select 1 from public.message_user_blocks as block
    where (block.blocker_user_id = new.sender_id and block.blocked_user_id in (v_conversation.participant_a_id, v_conversation.participant_b_id))
       or (block.blocked_user_id = new.sender_id and block.blocker_user_id in (v_conversation.participant_a_id, v_conversation.participant_b_id))
  ) then
    raise exception using errcode = '42501', message = 'Messaging is blocked between these accounts.';
  end if;

  new.sender_display_name := private.storenest_message_display_name(new.sender_id, new.sender_role, new.sender_business_id);
  return new;
end;
$function$;
revoke all on function private.set_storefront_message_identity() from public, anon, authenticated;

drop trigger if exists storefront_message_sets_identity on public.storefront_messages;
create trigger storefront_message_sets_identity
before insert on public.storefront_messages
for each row execute function private.set_storefront_message_identity();

drop policy if exists "Participants can read storefront conversations" on public.storefront_conversations;
drop policy if exists "Customers can start published business conversations" on public.storefront_conversations;
drop policy if exists "Participants can read storefront messages" on public.storefront_messages;
drop policy if exists "Participants can send storefront messages" on public.storefront_messages;
drop policy if exists "Recipients can mark storefront messages as read" on public.storefront_messages;

revoke all on public.storefront_conversations from public, anon, authenticated;
revoke all on public.storefront_messages from public, anon, authenticated;
grant select on public.storefront_conversations to authenticated;
grant select on public.storefront_messages to authenticated;
grant insert (conversation_id, sender_id, body) on public.storefront_messages to authenticated;
grant update (read_at) on public.storefront_messages to authenticated;

create policy "Conversation participants can read one-to-one conversations"
on public.storefront_conversations for select to authenticated
using (
  participant_a_id = (select auth.uid())
  or participant_b_id = (select auth.uid())
);

create policy "Conversation participants can read messages"
on public.storefront_messages for select to authenticated
using (
  exists (
    select 1 from public.storefront_conversations as c
    where c.id = storefront_messages.conversation_id
      and (c.participant_a_id = (select auth.uid()) or c.participant_b_id = (select auth.uid()))
  )
);

create policy "Participants can send messages in accepted or initial request"
on public.storefront_messages for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and exists (
    select 1 from public.storefront_conversations as c
    where c.id = storefront_messages.conversation_id
      and (c.participant_a_id = (select auth.uid()) or c.participant_b_id = (select auth.uid()))
      and (
        c.request_status = 'accepted'
        or (
          c.request_status = 'pending'
          and c.requester_user_id = (select auth.uid())
          and not exists (
            select 1 from public.storefront_messages as prior
            where prior.conversation_id = c.id
          )
        )
      )
      and not exists (
        select 1 from public.message_user_blocks as block
        where (block.blocker_user_id = (select auth.uid()) and block.blocked_user_id in (c.participant_a_id, c.participant_b_id))
           or (block.blocked_user_id = (select auth.uid()) and block.blocker_user_id in (c.participant_a_id, c.participant_b_id))
      )
  )
);

create policy "Recipients can mark incoming messages as read"
on public.storefront_messages for update to authenticated
using (
  sender_id <> (select auth.uid())
  and read_at is null
  and exists (
    select 1 from public.storefront_conversations as c
    where c.id = storefront_messages.conversation_id
      and (c.participant_a_id = (select auth.uid()) or c.participant_b_id = (select auth.uid()))
  )
)
with check (
  sender_id <> (select auth.uid())
  and read_at is not null
  and exists (
    select 1 from public.storefront_conversations as c
    where c.id = storefront_messages.conversation_id
      and (c.participant_a_id = (select auth.uid()) or c.participant_b_id = (select auth.uid()))
  )
);

create or replace function public.start_storefront_conversation(
  p_recipient_user_id uuid,
  p_sender_role text,
  p_recipient_role text,
  p_sender_business_id uuid default null,
  p_recipient_business_id uuid default null,
  p_initial_message text default null
)
returns table (conversation_id uuid, request_status text, created boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_sender uuid := auth.uid();
  v_recipient uuid := p_recipient_user_id;
  v_context_business_id uuid;
  v_customer_id uuid;
  v_customer_label text := 'Customer';
  v_a_id uuid;
  v_b_id uuid;
  v_a_role text;
  v_b_role text;
  v_a_business_id uuid;
  v_b_business_id uuid;
  v_conversation_id uuid;
  v_status text;
  v_is_new boolean := false;
  v_match record;
begin
  if v_sender is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;
  if p_initial_message is null or pg_catalog.char_length(pg_catalog.btrim(p_initial_message)) not between 1 and 2000 then
    raise exception using errcode = '22023', message = 'A message must contain between 1 and 2,000 characters.';
  end if;

  if p_recipient_role = 'hq' and v_recipient is null then
    select a.user_id into v_recipient
    from private.platform_admin_users as a
    order by a.granted_at asc, a.user_id asc
    limit 1;
  end if;

  if v_recipient is null or v_recipient = v_sender then
    raise exception using errcode = '22023', message = 'Choose another StoreNest account.';
  end if;
  if p_sender_role not in ('customer', 'business_owner', 'publisher', 'hq')
    or p_recipient_role not in ('customer', 'business_owner', 'publisher', 'hq') then
    raise exception using errcode = '22023', message = 'Choose a registered StoreNest role.';
  end if;
  if p_sender_role = p_recipient_role then
    raise exception using errcode = '22023', message = 'This release supports conversations between two different roles.';
  end if;
  if not private.storenest_message_role_is_valid(v_sender, p_sender_role, p_sender_business_id) then
    raise exception using errcode = '42501', message = 'Your selected StoreNest identity is unavailable.';
  end if;
  if not private.storenest_message_role_is_valid(v_recipient, p_recipient_role, p_recipient_business_id) then
    raise exception using errcode = '42501', message = 'The selected recipient identity is unavailable.';
  end if;

  if p_sender_role = 'business_owner' and p_sender_business_id is null
     or p_recipient_role = 'business_owner' and p_recipient_business_id is null then
    raise exception using errcode = '22023', message = 'Select a registered business identity for this conversation.';
  end if;
  if p_sender_role <> 'business_owner' and p_sender_business_id is not null
     or p_recipient_role <> 'business_owner' and p_recipient_business_id is not null then
    raise exception using errcode = '22023', message = 'A business identity can only be used by its owner.';
  end if;

  v_context_business_id := coalesce(p_sender_business_id, p_recipient_business_id);

  if p_sender_role = 'customer' and p_recipient_role = 'business_owner'
     or p_sender_role = 'business_owner' and p_recipient_role = 'customer' then
    if p_sender_role = 'customer' and not exists (
      select 1 from public.businesses as b
      where b.id = p_recipient_business_id and b.owner_id = v_recipient and b.is_published
    ) then
      raise exception using errcode = '42501', message = 'Customers can only contact the owner of a published StoreNest business.';
    end if;
    if p_sender_role = 'business_owner' and not exists (
      select 1 from public.storefront_orders as o
      where o.business_id = p_sender_business_id and o.customer_user_id = v_recipient
      union all
      select 1 from public.storefront_conversations as prior
      where prior.business_id = p_sender_business_id
        and (prior.participant_a_id = v_recipient or prior.participant_b_id = v_recipient)
    ) then
      raise exception using errcode = '42501', message = 'A business can only start a customer conversation from its existing order or conversation record.';
    end if;
  elsif p_sender_role = 'business_owner' and p_recipient_role = 'publisher'
     or p_sender_role = 'publisher' and p_recipient_role = 'business_owner' then
    if not exists (
      select 1
      from public.business_owner_profiles as owner_profile
      join public.publisher_profiles as publisher on publisher.id = owner_profile.referred_by_publisher_id
      where owner_profile.user_id = case when p_sender_role = 'business_owner' then v_sender else v_recipient end
        and publisher.user_id = case when p_sender_role = 'publisher' then v_sender else v_recipient end
    ) then
      raise exception using errcode = '42501', message = 'Publisher and Business Owner conversations require an existing referral relationship.';
    end if;
  elsif p_sender_role = 'customer' and p_recipient_role = 'publisher'
     or p_sender_role = 'publisher' and p_recipient_role = 'customer' then
    null;
  elsif p_sender_role = 'hq' or p_recipient_role = 'hq' then
    null;
  else
    raise exception using errcode = '22023', message = 'This StoreNest role pairing is not available.';
  end if;

  if p_sender_role = 'customer' then v_customer_id := v_sender;
  elsif p_recipient_role = 'customer' then v_customer_id := v_recipient;
  end if;
  if v_customer_id is not null then
    select coalesce(nullif(pg_catalog.btrim(p.profile_name), ''), 'Customer')
      into v_customer_label
    from public.customer_profiles as p where p.user_id = v_customer_id;
  end if;

  if v_sender < v_recipient then
    v_a_id := v_sender; v_b_id := v_recipient;
    v_a_role := p_sender_role; v_b_role := p_recipient_role;
    v_a_business_id := p_sender_business_id; v_b_business_id := p_recipient_business_id;
  else
    v_a_id := v_recipient; v_b_id := v_sender;
    v_a_role := p_recipient_role; v_b_role := p_sender_role;
    v_a_business_id := p_recipient_business_id; v_b_business_id := p_sender_business_id;
  end if;

  if exists (
    select 1 from public.message_user_blocks as block
    where (block.blocker_user_id = v_sender and block.blocked_user_id = v_recipient)
       or (block.blocked_user_id = v_sender and block.blocker_user_id = v_recipient)
  ) then
    raise exception using errcode = '42501', message = 'Messaging is blocked between these accounts.';
  end if;

  insert into public.storefront_conversations (
    business_id, customer_id, customer_label, participant_a_id, participant_b_id,
    participant_a_role, participant_b_role, participant_a_business_id, participant_b_business_id,
    requester_user_id, request_status
  )
  values (
    v_context_business_id, v_customer_id, v_customer_label, v_a_id, v_b_id,
    v_a_role, v_b_role, v_a_business_id, v_b_business_id, v_sender, 'pending'
  )
  on conflict do nothing
  returning id into v_conversation_id;

  if v_conversation_id is not null then
    v_is_new := true;
    v_status := 'pending';
  else
    select c.id, c.request_status, c.participant_a_role, c.participant_b_role
      into v_match
    from public.storefront_conversations as c
    where c.participant_a_id = v_a_id and c.participant_b_id = v_b_id
      and c.business_id is not distinct from v_context_business_id
    for update;
    if v_match.id is null then
      raise exception using errcode = '40001', message = 'The conversation is being created. Please try again.';
    end if;
    v_conversation_id := v_match.id;
    v_status := v_match.request_status;

    if v_status = 'declined' then
      raise exception using errcode = '42501', message = 'This message request was declined.';
    elsif v_status = 'pending' and exists (
      select 1 from public.storefront_conversations as c
      where c.id = v_conversation_id and c.requester_user_id <> v_sender
    ) then
      return query select v_conversation_id, v_status, false;
      return;
    elsif v_status = 'pending' then
      raise exception using errcode = '42501', message = 'Your message request is awaiting a response.';
    end if;

    update public.storefront_conversations as c
    set participant_a_role = v_a_role,
        participant_b_role = v_b_role,
        participant_a_business_id = v_a_business_id,
        participant_b_business_id = v_b_business_id
    where c.id = v_conversation_id;

    insert into public.storefront_messages (conversation_id, sender_id, body)
    values (v_conversation_id, v_sender, p_initial_message);
  end if;

  if v_is_new then
    insert into public.storefront_messages (conversation_id, sender_id, body)
    values (v_conversation_id, v_sender, p_initial_message);
  end if;

  return query select v_conversation_id, v_status, v_is_new;
end;
$function$;
revoke all on function public.start_storefront_conversation(uuid, text, text, uuid, uuid, text) from public, anon;
grant execute on function public.start_storefront_conversation(uuid, text, text, uuid, uuid, text) to authenticated;

create or replace function public.update_storefront_message_request(
  p_conversation_id uuid,
  p_action text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_user uuid := auth.uid();
  v_conversation public.storefront_conversations%rowtype;
  v_other uuid;
begin
  if v_user is null then raise exception using errcode = '28000', message = 'Authentication required.'; end if;
  if p_action not in ('accept', 'decline', 'block') then
    raise exception using errcode = '22023', message = 'Choose accept, decline, or block.';
  end if;
  select * into v_conversation from public.storefront_conversations as c
  where c.id = p_conversation_id for update;
  if not found or (v_conversation.participant_a_id <> v_user and v_conversation.participant_b_id <> v_user) then
    raise exception using errcode = '42501', message = 'Conversation is unavailable.';
  end if;
  v_other := case when v_conversation.participant_a_id = v_user then v_conversation.participant_b_id else v_conversation.participant_a_id end;

  if p_action = 'block' then
    insert into public.message_user_blocks (blocker_user_id, blocked_user_id)
    values (v_user, v_other) on conflict do nothing;
    return;
  end if;

  if v_conversation.request_status <> 'pending' or v_conversation.requester_user_id = v_user then
    raise exception using errcode = '42501', message = 'Only the recipient can answer a pending message request.';
  end if;

  update public.storefront_conversations
  set request_status = case when p_action = 'accept' then 'accepted' else 'declined' end
  where id = p_conversation_id;
end;
$function$;
revoke all on function public.update_storefront_message_request(uuid, text) from public, anon;
grant execute on function public.update_storefront_message_request(uuid, text) to authenticated;

create or replace function public.get_my_message_inbox()
returns table (
  conversation_id uuid,
  business_id uuid,
  partner_user_id uuid,
  partner_role text,
  partner_display_name text,
  created_at timestamptz,
  updated_at timestamptz,
  last_message_at timestamptz,
  last_message_preview text,
  last_message_sender_id uuid,
  requester_user_id uuid,
  request_status text,
  unread_count bigint,
  request_for_me boolean,
  blocked_by_me boolean,
  blocked_by_partner boolean
)
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select
    c.id,
    c.business_id,
    case when c.participant_a_id = auth.uid() then c.participant_b_id else c.participant_a_id end,
    case when c.participant_a_id = auth.uid() then c.participant_b_role else c.participant_a_role end,
    private.storenest_message_display_name(
      case when c.participant_a_id = auth.uid() then c.participant_b_id else c.participant_a_id end,
      case when c.participant_a_id = auth.uid() then c.participant_b_role else c.participant_a_role end,
      case when c.participant_a_id = auth.uid() then c.participant_b_business_id else c.participant_a_business_id end
    ),
    c.created_at, c.updated_at, c.last_message_at, c.last_message_preview, c.last_message_sender_id,
    c.requester_user_id, c.request_status,
    (select count(*) from public.storefront_messages as m where m.conversation_id = c.id and m.sender_id <> auth.uid() and m.read_at is null),
    c.request_status = 'pending' and c.requester_user_id <> auth.uid(),
    exists (select 1 from public.message_user_blocks as b where b.blocker_user_id = auth.uid() and b.blocked_user_id = case when c.participant_a_id = auth.uid() then c.participant_b_id else c.participant_a_id end),
    exists (select 1 from public.message_user_blocks as b where b.blocked_user_id = auth.uid() and b.blocker_user_id = case when c.participant_a_id = auth.uid() then c.participant_b_id else c.participant_a_id end)
  from public.storefront_conversations as c
  where auth.uid() is not null
    and (c.participant_a_id = auth.uid() or c.participant_b_id = auth.uid())
    and c.last_message_at is not null
  order by c.updated_at desc nulls last, c.created_at desc;
$function$;
revoke all on function public.get_my_message_inbox() from public, anon;
grant execute on function public.get_my_message_inbox() to authenticated;

create or replace function public.get_my_message_contacts()
returns table (
  contact_user_id uuid,
  contact_role text,
  contact_display_name text,
  business_id uuid,
  business_name text
)
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select owner_profile.user_id, 'business_owner'::text, coalesce(nullif(pg_catalog.btrim(business.name), ''), owner_profile.full_name, 'Business Owner'),
         business.id, nullif(pg_catalog.btrim(business.name), '')
  from public.publisher_profiles as publisher
  join public.business_owner_profiles as owner_profile on owner_profile.referred_by_publisher_id = publisher.id
  left join public.businesses as business on business.owner_id = owner_profile.user_id
  where publisher.user_id = auth.uid() and publisher.status = 'active'
  union all
  select publisher.user_id, 'publisher'::text, publisher.display_name, business.id, nullif(pg_catalog.btrim(business.name), '')
  from public.business_owner_profiles as owner_profile
  join public.publisher_profiles as publisher on publisher.id = owner_profile.referred_by_publisher_id and publisher.status = 'active'
  left join public.businesses as business on business.owner_id = owner_profile.user_id
  where owner_profile.user_id = auth.uid()
  order by 3, 5 nulls first;
$function$;
revoke all on function public.get_my_message_contacts() from public, anon;
grant execute on function public.get_my_message_contacts() to authenticated;

create or replace function public.get_public_publisher_message_contact(p_referral_code text)
returns table (contact_user_id uuid, contact_display_name text)
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select p.user_id, p.display_name
  from public.publisher_profiles as p
  where p.status = 'active'
    and p.referral_code = pg_catalog.upper(pg_catalog.btrim(coalesce(p_referral_code, '')))
  limit 1;
$function$;
revoke all on function public.get_public_publisher_message_contact(text) from public, anon;
grant execute on function public.get_public_publisher_message_contact(text) to authenticated;

create or replace function public.get_platform_admin_message_contacts(
  p_search text,
  p_role text default null
)
returns table (
  contact_user_id uuid,
  contact_role text,
  contact_display_name text,
  business_id uuid,
  business_name text
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  v_search text := pg_catalog.btrim(coalesce(p_search, ''));
begin
  if not exists (select 1 from private.platform_admin_users as a where a.user_id = auth.uid()) then
    raise exception using errcode = '42501', message = 'Platform administrator access required.';
  end if;
  if pg_catalog.char_length(v_search) < 2 then
    return;
  end if;
  return query
  select p.user_id, 'customer'::text, p.profile_name, null::uuid, null::text
  from public.customer_profiles as p
  where (p_role is null or p_role = 'customer') and p.profile_name ilike '%' || v_search || '%'
  union all
  select owner_profile.user_id, 'business_owner'::text,
         coalesce(nullif(pg_catalog.btrim(b.name), ''), owner_profile.full_name, 'Business Owner'), b.id, nullif(pg_catalog.btrim(b.name), '')
  from public.business_owner_profiles as owner_profile
  left join public.businesses as b on b.owner_id = owner_profile.user_id
  where (p_role is null or p_role = 'business_owner')
    and (owner_profile.full_name ilike '%' || v_search || '%' or b.name ilike '%' || v_search || '%')
  union all
  select p.user_id, 'publisher'::text, p.display_name, null::uuid, null::text
  from public.publisher_profiles as p
  where (p_role is null or p_role = 'publisher') and p.status = 'active' and p.display_name ilike '%' || v_search || '%'
  order by 3
  limit 30;
end;
$function$;
revoke all on function public.get_platform_admin_message_contacts(text, text) from public, anon;
grant execute on function public.get_platform_admin_message_contacts(text, text) to authenticated;

do $publication$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_user_blocks'
  ) then
    alter publication supabase_realtime add table public.message_user_blocks;
  end if;
end;
$publication$;
