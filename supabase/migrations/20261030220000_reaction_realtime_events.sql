-- Publish a privacy-safe room event whenever a reaction is added or removed.
-- Clients subscribe only to message_events, never to reactions (which stores wallet addresses).
create or replace function app.publish_safe_reaction_event()
returns trigger
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  target_message_id uuid;
  target_room_id text;
  target_seq bigint;
begin
  if tg_op = 'DELETE' then
    target_message_id := old.message_id;
    target_room_id := old.room_id;
  else
    target_message_id := new.message_id;
    target_room_id := new.room_id;
  end if;

  select seq
    into target_seq
    from app.messages
    where id = target_message_id
      and room_id = target_room_id;

  if target_seq is not null then
    insert into app.message_events (message_id, room_id, seq)
    values (target_message_id, target_room_id, target_seq);
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function app.publish_safe_reaction_event() from public, anon, authenticated;
drop trigger if exists reactions_publish_safe_event on app.reactions;
create trigger reactions_publish_safe_event
after insert or delete on app.reactions
for each row execute function app.publish_safe_reaction_event();
