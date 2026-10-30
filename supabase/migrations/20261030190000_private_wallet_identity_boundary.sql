-- Privacy boundary for wallet identity.
-- Raw wallet-bearing records are server-only. The application now reads messages
-- through /api/messages, which returns a sanitized DTO (author_name/is_mine)
-- and signs media URLs on the server.

-- Profiles contain the wallet primary key and therefore must never be publicly selectable.
drop policy if exists profiles_select on app.profiles;
revoke select on app.profiles from anon, authenticated;
revoke all on app.profiles from anon, authenticated;
-- Rewrite the legacy auto-generated nickname that exposed the last four wallet
-- characters. User-chosen nicknames are left untouched.
update app.profiles
set nickname = 'User_' || upper(substr(md5(address), 1, 4)),
    updated_at = now()
where nickname = 'User_' || upper(right(address, 4));

-- Messages contain user_address, event_key, system_payload and private media paths.
-- Revoke direct access and remove the raw table from Postgres Changes. Realtime
-- clients must not receive the complete row payload.
revoke all on app.messages from anon, authenticated;
do $$
declare
  publication_is_all_tables boolean;
begin
  select puballtables into publication_is_all_tables
  from pg_publication where pubname = 'supabase_realtime';
  if publication_is_all_tables then
    raise exception 'supabase_realtime is configured FOR ALL TABLES. Change it to an explicit table list and exclude app.messages before applying this privacy migration.';
  end if;
  alter publication supabase_realtime drop table app.messages;
exception
  when undefined_object then null;
end $$;

-- These tables also contain wallet addresses belonging to other users.
-- They are currently read through trusted server logic only; do not expose rows
-- to browser clients until a dedicated sanitized API is introduced.
revoke all on app.reactions from anon, authenticated;
revoke all on app.pins from anon, authenticated;
revoke all on app.moderation from anon, authenticated;
revoke all on app.facade_submissions from anon, authenticated;
revoke all on app.task_drafts from anon, authenticated;
revoke all on app.invite_codes from anon, authenticated;
revoke all on app.bot_settings from anon, authenticated;

-- Remove wallet addresses embedded in legacy system event identifiers/payloads.
-- Keep uniqueness while making the replacement deterministic.
update app.messages
set event_key = regexp_replace(
  event_key,
  '(0x[0-9a-f]{40})',
  'wallet:' || md5(event_key),
  'gi'
)
where kind = 'system'
  and event_key ~* '0x[0-9a-f]{40}';

update app.messages
set system_payload = system_payload - 'user_address'
where kind = 'system'
  and system_payload is not null
  and system_payload ? 'user_address';

-- System message text is also returned to clients. Redact wallet-looking
-- addresses there as well; sanitizing only event_key and JSON payload is not
-- sufficient if an older system message embedded an address in content.
update app.messages
set content = regexp_replace(content, '0x[0-9a-f]{40}', '[redacted]', 'gi')
where kind = 'system'
  and content ~* '0x[0-9a-f]{40}';

-- Redact wallet-looking values/keys recursively in legacy system payload JSON.
create or replace function app.redact_wallet_json(value jsonb)
returns jsonb
language plpgsql
immutable
strict
as $$
declare
  result jsonb;
begin
  case jsonb_typeof(value)
    when 'object' then
      select coalesce(jsonb_object_agg(
        regexp_replace(key, '0x[0-9a-f]{40}', 'wallet:' || md5(key), 'gi'),
        app.redact_wallet_json(val)
      ), '{}'::jsonb)
      into result
      from jsonb_each(value) as item(key, val);
      return result;
    when 'array' then
      select coalesce(jsonb_agg(app.redact_wallet_json(item)), '[]'::jsonb)
      into result
      from jsonb_array_elements(value) as elements(item);
      return result;
    when 'string' then
      return to_jsonb(regexp_replace(value #>> '{}', '0x[0-9a-f]{40}', '[redacted]', 'gi'));
    else
      return value;
  end case;
end;
$$;
update app.messages
set system_payload = app.redact_wallet_json(system_payload)
where kind = 'system' and system_payload is not null;
drop function app.redact_wallet_json(jsonb);

-- Move message authorship to opaque UUIDs. Wallet addresses remain only in the
-- server-only identity map, not in the messages relation or its API shape.
create table if not exists app.wallet_identities (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null unique
    check (wallet_address ~ '^0x[0-9a-f]{40}$' and wallet_address = lower(wallet_address)),
  created_at timestamptz not null default now()
);
alter table app.wallet_identities enable row level security;
revoke all on app.wallet_identities from anon, authenticated;
grant all on app.wallet_identities to service_role;

insert into app.wallet_identities (wallet_address)
select distinct address
from (
  select lower(address) as address from app.profiles
  union
  select lower(user_address) as address from app.messages where user_address is not null
) wallet_addresses
where address ~ '^0x[0-9a-f]{40}$'
on conflict (wallet_address) do nothing;

alter table app.messages add column if not exists author_id uuid;
update app.messages m
set author_id = wi.id
from app.wallet_identities wi
where m.user_address = wi.wallet_address
  and m.user_address is not null
  and m.author_id is null;

alter table app.messages
  add constraint messages_author_identity_fk
  foreign key (author_id) references app.wallet_identities(id);
alter table app.messages
  add constraint messages_author_identity_check
  check (
    (kind = 'system' and author_id is null)
    or (kind <> 'system' and author_id is not null)
  );

-- Recreate the original message-shape invariant without the removed wallet column.
alter table app.messages
  add constraint messages_kind_shape_check
  check (
    (
      kind = 'system'
      and author_id is null
      and system_code is not null
      and event_key is not null
      and media_url is null
    )
    or (
      kind <> 'system'
      and author_id is not null
      and system_code is null
      and event_key is null
      and (
        (kind in ('voice', 'image', 'video') and media_url is not null)
        or (kind in ('text', 'post', 'proposal_card', 'task_card') and media_url is null)
      )
    )
  );

-- The old column is no longer required by message reads, writes, or policies.
alter table app.messages drop column user_address;

-- Ensure service role retains the only table-level access after the migration.
revoke all on app.wallet_identities from anon, authenticated;
revoke all on app.messages from anon, authenticated;

-- Browser clients must not list private chat objects: legacy object names may
-- contain the former wallet-address path segment. The server signs individual
-- objects after authorizing the room, so direct SELECT policies are unnecessary.
drop policy if exists "chat images readable by room members" on storage.objects;
drop policy if exists "chat voice readable by room members" on storage.objects;

-- Realtime-safe event stream: only opaque message ID, room ID and sequence are
-- published. The browser uses this event to fetch the sanitized DTO via API.
create table if not exists app.message_events (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null,
  room_id text not null references app.rooms(id),
  seq bigint not null,
  created_at timestamptz not null default now()
);
create index if not exists message_events_room_seq_idx
  on app.message_events (room_id, seq);
alter table app.message_events enable row level security;
drop policy if exists message_events_select_room on app.message_events;
create policy message_events_select_room on app.message_events
  for select to authenticated
  using (app.can_read_room(room_id));
revoke all on app.message_events from anon;
revoke all on app.message_events from authenticated;
grant select on app.message_events to authenticated;

create or replace function app.publish_safe_message_event()
returns trigger
language plpgsql
security definer
set search_path = app, pg_temp
as $$
begin
  insert into app.message_events (message_id, room_id, seq)
  values (new.id, new.room_id, new.seq);
  return new;
end;
$$;
revoke all on function app.publish_safe_message_event() from public, anon, authenticated;
drop trigger if exists messages_publish_safe_event on app.messages;
create trigger messages_publish_safe_event
after insert on app.messages
for each row execute function app.publish_safe_message_event();

do $$
begin
  alter publication supabase_realtime add table app.message_events;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
