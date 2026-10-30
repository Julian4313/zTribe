-- zTribe app schema。字段以 launchpad-scaffold/docs/tech/tech-数据库结构.md 为准。
-- 不建 message_tips、dm_*，不建 chain.*。
--
-- 跑完后在 Supabase Dashboard → Project Settings → Data API → Exposed schemas 加上 app。
-- Authentication → Hooks → Customize Access Token 指向 app.custom_access_token_hook。
-- 不启用这个 hook 时，JWT sub 仍是用户 UUID，部落房间的 RLS 读策略对不上钱包地址。
-- World General / Announcements（access = open）不依赖该 hook。

create schema if not exists app;

grant usage on schema app to anon, authenticated, service_role;

create or replace function app.jwt_wallet()
returns text
language sql
stable
as $$
  select lower(
    case
      when coalesce(auth.jwt()->>'sub', '') ~ '^0x[0-9a-f]{40}$'
        then auth.jwt()->>'sub'
      when coalesce(auth.jwt()->>'address', '') ~ '^0x[0-9a-f]{40}$'
        then auth.jwt()->>'address'
      else null
    end
  );
$$;

revoke all on function app.jwt_wallet() from public;
grant execute on function app.jwt_wallet() to anon, authenticated, service_role;

-- 从 auth.identities 把钱包地址写进 JWT 的 address 声明。不改 sub。
create or replace function app.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb := event->'claims';
  wallet text;
begin
  select lower(
    coalesce(
      i.identity_data->>'address',
      case
        when i.provider_id ~* '^0x[0-9a-f]{40}$' then i.provider_id
        else null
      end
    )
  )
  into wallet
  from auth.identities i
  where i.user_id = (event->>'user_id')::uuid
    and i.provider = 'web3'
  order by i.updated_at desc nulls last
  limit 1;

  if wallet is not null and wallet ~ '^0x[0-9a-f]{40}$' then
    claims := jsonb_set(claims, '{address}', to_jsonb(wallet), true);
  end if;

  return jsonb_set(event, '{claims}', claims, true);
end;
$$;

revoke all on function app.custom_access_token_hook(jsonb) from public;

do $$
begin
  grant usage on schema app to supabase_auth_admin;
  grant execute on function app.custom_access_token_hook(jsonb) to supabase_auth_admin;
exception
  when undefined_object then null;
end $$;

create table if not exists app.profiles (
  address text primary key check (address ~ '^0x[0-9a-f]{40}$' and address = lower(address)),
  nickname text,
  avatar_url text,
  bio text,
  socials jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app.facades (
  token_address text primary key check (token_address ~ '^0x[0-9a-f]{40}$' and token_address = lower(token_address)),
  banner_url text,
  slogan text,
  socials jsonb,
  frozen boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists app.rooms (
  id text primary key,
  kind text not null check (kind in ('tribe', 'world')),
  token_address text,
  title text not null,
  access text not null check (access in ('token_gated', 'open', 'apply')),
  post_policy text not null check (post_policy in ('member', 'signed_in', 'platform_admin', 'apply')),
  required_tokens numeric,
  created_at timestamptz not null default now(),
  check (
    (
      kind = 'tribe'
      and token_address = id
      and access = 'token_gated'
      and post_policy = 'member'
      and id ~ '^0x[0-9a-f]{40}$'
    )
    or (
      kind = 'world'
      and token_address is null
      and id ~ '^world:[a-z0-9-]+$'
    )
  )
);

create table if not exists app.messages (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  room_id text not null references app.rooms (id),
  user_address text check (user_address is null or (user_address ~ '^0x[0-9a-f]{40}$' and user_address = lower(user_address))),
  kind text not null check (kind in ('text', 'post', 'voice', 'image', 'video', 'system', 'proposal_card', 'task_card')),
  source text not null default 'app' check (source in ('app', 'chain')),
  event_key text,
  system_code text check (
    system_code is null
    or system_code in (
      'join',
      'mute',
      'facade_approved',
      'proposal_ended',
      'proposal_executable',
      'proposal_executed',
      'big_buy',
      'milestone',
      'daily_price',
      'daily_treasury',
      'daily_member'
    )
  ),
  system_payload jsonb,
  content text not null,
  media_url text,
  media_meta jsonb,
  reply_to uuid references app.messages (id),
  forward_from jsonb,
  ref_id text,
  translation jsonb,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  check (event_key is null or length(event_key) > 0),
  check (
    (
      kind = 'system'
      and user_address is null
      and system_code is not null
      and event_key is not null
      and media_url is null
    )
    or (
      kind <> 'system'
      and user_address is not null
      and system_code is null
      and event_key is null
      and (
        (kind in ('voice', 'image', 'video') and media_url is not null)
        or (kind in ('text', 'post', 'proposal_card', 'task_card') and media_url is null)
      )
    )
  )
);

create unique index if not exists messages_source_event_key_idx
  on app.messages (source, event_key)
  where event_key is not null;

create index if not exists messages_room_seq_idx
  on app.messages (room_id, seq);

create table if not exists app.reactions (
  message_id uuid not null references app.messages (id),
  room_id text not null references app.rooms (id),
  user_address text not null check (user_address ~ '^0x[0-9a-f]{40}$' and user_address = lower(user_address)),
  emoji text not null check (length(emoji) > 0),
  created_at timestamptz not null default now(),
  primary key (message_id, user_address, emoji)
);

create table if not exists app.pins (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references app.rooms (id),
  message_id uuid not null references app.messages (id),
  label text not null,
  title text not null,
  ref_id text,
  pinned_by text not null check (pinned_by ~ '^0x[0-9a-f]{40}$' and pinned_by = lower(pinned_by)),
  created_at timestamptz not null default now()
);

create table if not exists app.room_access (
  room_id text not null references app.rooms (id),
  user_address text not null check (user_address ~ '^0x[0-9a-f]{40}$' and user_address = lower(user_address)),
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (room_id, user_address),
  check (expires_at > granted_at)
);

create table if not exists app.moderation (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('room', 'global')),
  room_id text references app.rooms (id),
  target_address text check (target_address is null or (target_address ~ '^0x[0-9a-f]{40}$' and target_address = lower(target_address))),
  type text not null check (type in ('mute', 'freeze', 'chief_blacklist')),
  by_address text not null check (by_address ~ '^0x[0-9a-f]{40}$' and by_address = lower(by_address)),
  until timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (scope = 'room' and room_id is not null)
    or (scope = 'global' and room_id is null)
  ),
  check (
    (type = 'freeze' and target_address is null and scope = 'room')
    or (type in ('mute', 'chief_blacklist') and target_address is not null)
  )
);

create table if not exists app.facade_submissions (
  id uuid primary key default gen_random_uuid(),
  token_address text not null check (token_address ~ '^0x[0-9a-f]{40}$' and token_address = lower(token_address)),
  banner_url text,
  slogan text,
  socials jsonb,
  submitted_by text not null check (submitted_by ~ '^0x[0-9a-f]{40}$' and submitted_by = lower(submitted_by)),
  status text not null check (status in ('pending', 'approved', 'rejected')),
  reviewed_by text check (reviewed_by is null or (reviewed_by ~ '^0x[0-9a-f]{40}$' and reviewed_by = lower(reviewed_by))),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists app.admins (
  address text primary key check (address ~ '^0x[0-9a-f]{40}$' and address = lower(address)),
  role text not null check (role in ('reviewer', 'platform_admin')),
  created_at timestamptz not null default now()
);

create table if not exists app.bot_settings (
  token_address text primary key check (token_address ~ '^0x[0-9a-f]{40}$' and token_address = lower(token_address)),
  big_buy_enabled boolean not null default false,
  big_buy_threshold_usd numeric,
  milestones jsonb not null default '{}'::jsonb,
  daily jsonb not null default '{"price":false,"treasury":false,"member":false}'::jsonb,
  updated_by text check (updated_by is null or (updated_by ~ '^0x[0-9a-f]{40}$' and updated_by = lower(updated_by))),
  updated_at timestamptz not null default now()
);

create table if not exists app.task_drafts (
  id uuid primary key default gen_random_uuid(),
  token_address text not null check (token_address ~ '^0x[0-9a-f]{40}$' and token_address = lower(token_address)),
  author_address text not null check (author_address ~ '^0x[0-9a-f]{40}$' and author_address = lower(author_address)),
  proposal_id text,
  payload jsonb not null,
  status text not null check (status in ('draft', 'pending_vote', 'locked', 'rejected', 'landed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app.invite_codes (
  code text primary key,
  inviter_address text not null unique check (inviter_address ~ '^0x[0-9a-f]{40}$' and inviter_address = lower(inviter_address)),
  created_at timestamptz not null default now()
);

create or replace function app.can_read_room(target_room text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from app.rooms r
    where r.id = target_room
      and (
        r.access = 'open'
        or exists (
          select 1
          from app.room_access a
          where a.room_id = r.id
            and a.user_address = app.jwt_wallet()
            and a.expires_at > now()
        )
      )
  );
$$;

revoke all on function app.can_read_room(text) from public;
grant execute on function app.can_read_room(text) to anon, authenticated, service_role;

insert into app.rooms (id, kind, token_address, title, access, post_policy)
values
  ('world:announcements', 'world', null, 'Announcements', 'open', 'platform_admin'),
  ('world:general', 'world', null, 'General', 'open', 'signed_in'),
  ('world:core', 'world', null, 'Core', 'apply', 'apply')
on conflict (id) do nothing;

alter table app.profiles enable row level security;
alter table app.facades enable row level security;
alter table app.rooms enable row level security;
alter table app.messages enable row level security;
alter table app.reactions enable row level security;
alter table app.pins enable row level security;
alter table app.room_access enable row level security;
alter table app.moderation enable row level security;
alter table app.facade_submissions enable row level security;
alter table app.admins enable row level security;
alter table app.bot_settings enable row level security;
alter table app.task_drafts enable row level security;
alter table app.invite_codes enable row level security;

drop policy if exists profiles_select on app.profiles;
create policy profiles_select on app.profiles
  for select to anon, authenticated
  using (true);

drop policy if exists profiles_update_self on app.profiles;
create policy profiles_update_self on app.profiles
  for update to authenticated
  using (address = app.jwt_wallet())
  with check (address = app.jwt_wallet());

drop policy if exists facades_select on app.facades;
create policy facades_select on app.facades
  for select to anon, authenticated
  using (true);

drop policy if exists rooms_select on app.rooms;
create policy rooms_select on app.rooms
  for select to anon, authenticated
  using (true);

drop policy if exists messages_select on app.messages;
create policy messages_select on app.messages
  for select to anon, authenticated
  using (deleted_at is null and app.can_read_room(room_id));

drop policy if exists reactions_select on app.reactions;
create policy reactions_select on app.reactions
  for select to anon, authenticated
  using (app.can_read_room(room_id));

drop policy if exists pins_select on app.pins;
create policy pins_select on app.pins
  for select to anon, authenticated
  using (app.can_read_room(room_id));

drop policy if exists room_access_select_self on app.room_access;
create policy room_access_select_self on app.room_access
  for select to authenticated
  using (user_address = app.jwt_wallet());

drop policy if exists moderation_select on app.moderation;
create policy moderation_select on app.moderation
  for select to authenticated
  using (
    (
      scope = 'room'
      and room_id is not null
      and app.can_read_room(room_id)
    )
    or (
      scope = 'global'
      and target_address = app.jwt_wallet()
    )
  );

drop policy if exists facade_submissions_select on app.facade_submissions;
create policy facade_submissions_select on app.facade_submissions
  for select to authenticated
  using (
    submitted_by = app.jwt_wallet()
    or (
      status = 'approved'
      and not exists (
        select 1
        from app.facades f
        where f.token_address = facade_submissions.token_address
          and f.frozen
      )
    )
  );

drop policy if exists bot_settings_select on app.bot_settings;
create policy bot_settings_select on app.bot_settings
  for select to anon, authenticated
  using (true);

drop policy if exists task_drafts_select_author on app.task_drafts;
create policy task_drafts_select_author on app.task_drafts
  for select to authenticated
  using (author_address = app.jwt_wallet());

drop policy if exists invite_codes_select on app.invite_codes;
create policy invite_codes_select on app.invite_codes
  for select to anon, authenticated
  using (true);

grant select on app.profiles to anon, authenticated;
grant update (nickname, avatar_url, bio, socials, updated_at) on app.profiles to authenticated;
grant select on app.facades, app.rooms, app.messages, app.reactions, app.pins, app.bot_settings, app.invite_codes to anon, authenticated;
grant select on app.room_access, app.moderation, app.facade_submissions, app.task_drafts to authenticated;
grant all on all tables in schema app to service_role;
grant usage, select on all sequences in schema app to service_role;

revoke all on app.admins from anon, authenticated;

do $$
begin
  alter publication supabase_realtime add table app.messages;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  insert into storage.buckets (id, name, public)
  values
    ('meta', 'meta', true),
    ('facade', 'facade', false),
    ('chat', 'chat', false),
    ('profile', 'profile', true)
  on conflict (id) do nothing;
exception
  when undefined_table then null;
end $$;
