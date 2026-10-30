-- Speed up the targeted moderation lookups used by message authorization.
-- The partial predicates keep revoked records out of these indexes.
create index if not exists moderation_active_room_lookup_idx
  on app.moderation (room_id, type, target_address, until)
  where scope = 'room' and revoked_at is null;

create index if not exists moderation_active_global_mute_lookup_idx
  on app.moderation (target_address, until)
  where scope = 'global' and type = 'mute' and revoked_at is null;
