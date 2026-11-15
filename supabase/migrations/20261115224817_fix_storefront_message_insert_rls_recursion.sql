-- Remove the self-referential storefront_messages lookup from its INSERT policy.
-- The BEFORE INSERT identity trigger already enforces the single initial
-- message for pending requests, as well as role and block validation.
drop policy if exists "Participants can send messages in accepted or initial request"
  on public.storefront_messages;

create policy "Participants can send messages in accepted or initial request"
on public.storefront_messages
for insert
to authenticated
with check (
  sender_id = (select auth.uid())
  and exists (
    select 1
    from public.storefront_conversations as c
    where c.id = storefront_messages.conversation_id
      and (c.participant_a_id = (select auth.uid()) or c.participant_b_id = (select auth.uid()))
      and (
        c.request_status = 'accepted'
        or (
          c.request_status = 'pending'
          and c.requester_user_id = (select auth.uid())
        )
      )
      and not exists (
        select 1
        from public.message_user_blocks as block
        where (
          block.blocker_user_id = (select auth.uid())
          and block.blocked_user_id = any(array[c.participant_a_id, c.participant_b_id])
        )
        or (
          block.blocked_user_id = (select auth.uid())
          and block.blocker_user_id = any(array[c.participant_a_id, c.participant_b_id])
        )
      )
  )
);
