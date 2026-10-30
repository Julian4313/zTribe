-- Denormalized reply metadata keeps the chat timeline cheap to render.
-- The partial index makes both thread pagination and latest-reply lookup efficient.
alter table app.messages
  add column if not exists reply_count integer not null default 0,
  add column if not exists latest_reply_id uuid,
  add column if not exists latest_reply_at timestamptz;

alter table app.messages
  drop constraint if exists messages_reply_count_nonnegative;
alter table app.messages
  add constraint messages_reply_count_nonnegative check (reply_count >= 0);

create index if not exists messages_reply_thread_seq_idx
  on app.messages (room_id, reply_to, seq desc)
  where reply_to is not null and deleted_at is null;

-- Backfill metadata for existing messages without scanning the room at read time.
with reply_stats as (
  select
    reply_to as parent_id,
    count(*)::integer as total,
    (array_agg(id order by seq desc))[1] as latest_id,
    (array_agg(created_at order by seq desc))[1] as latest_at
  from app.messages
  where reply_to is not null and deleted_at is null
  group by reply_to
)
update app.messages parent
set
  reply_count = coalesce(stats.total, 0),
  latest_reply_id = stats.latest_id,
  latest_reply_at = stats.latest_at
from (
  select
    parent_row.id,
    coalesce(reply_stats.total, 0) as total,
    reply_stats.latest_id,
    reply_stats.latest_at
  from app.messages parent_row
  left join reply_stats on reply_stats.parent_id = parent_row.id
) stats
where parent.id = stats.id;

create or replace function app.maintain_message_reply_metadata()
returns trigger
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  latest_id uuid;
  latest_at timestamptz;
begin
  -- INSERT: add one reply to its parent.
  if tg_op = 'INSERT' then
    if new.reply_to is not null and new.deleted_at is null then
      update app.messages
        set reply_count = reply_count + 1
        where id = new.reply_to;

      select child.id, child.created_at
        into latest_id, latest_at
        from app.messages child
        where child.reply_to = new.reply_to
          and child.deleted_at is null
        order by child.seq desc
        limit 1;

      update app.messages
        set latest_reply_id = latest_id,
            latest_reply_at = latest_at
        where id = new.reply_to;
    end if;
    return new;
  end if;

  -- DELETE: remove one reply from its parent.
  if tg_op = 'DELETE' then
    if old.reply_to is not null and old.deleted_at is null then
      update app.messages
        set reply_count = greatest(reply_count - 1, 0)
        where id = old.reply_to;

      select child.id, child.created_at
        into latest_id, latest_at
        from app.messages child
        where child.reply_to = old.reply_to
          and child.deleted_at is null
        order by child.seq desc
        limit 1;

      update app.messages
        set latest_reply_id = latest_id,
            latest_reply_at = latest_at
        where id = old.reply_to;
    end if;
    return old;
  end if;

  -- UPDATE: account for restoring/soft-deleting a reply or moving it to another parent.
  if old.reply_to is not null
     and old.deleted_at is null
     and (new.reply_to is distinct from old.reply_to or new.deleted_at is not null) then
    update app.messages
      set reply_count = greatest(reply_count - 1, 0)
      where id = old.reply_to;

    select child.id, child.created_at
      into latest_id, latest_at
      from app.messages child
      where child.reply_to = old.reply_to
        and child.deleted_at is null
      order by child.seq desc
      limit 1;

    update app.messages
      set latest_reply_id = latest_id,
          latest_reply_at = latest_at
      where id = old.reply_to;
  end if;

  if new.reply_to is not null
     and new.deleted_at is null
     and (new.reply_to is distinct from old.reply_to or old.deleted_at is not null) then
    update app.messages
      set reply_count = reply_count + 1
      where id = new.reply_to;

    select child.id, child.created_at
      into latest_id, latest_at
      from app.messages child
      where child.reply_to = new.reply_to
        and child.deleted_at is null
      order by child.seq desc
      limit 1;

    update app.messages
      set latest_reply_id = latest_id,
          latest_reply_at = latest_at
      where id = new.reply_to;
  end if;

  return new;
end;
$$;

drop trigger if exists messages_reply_metadata_trigger on app.messages;
create trigger messages_reply_metadata_trigger
after insert or delete or update of reply_to, deleted_at on app.messages
for each row execute function app.maintain_message_reply_metadata();

revoke all on function app.maintain_message_reply_metadata() from public, anon, authenticated;
