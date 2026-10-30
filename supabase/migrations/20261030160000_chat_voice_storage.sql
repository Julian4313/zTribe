-- Private voice-message storage. Uploads happen server-side after wallet and room-post authorization.
-- Reads are allowed only to users who can read the room containing the voice message.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-voice',
  'chat-voice',
  false,
  10485760,
  array['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/wav', 'audio/x-wav']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "chat voice readable by room members" on storage.objects;
create policy "chat voice readable by room members"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'chat-voice'
    and app.can_read_room((storage.foldername(name))[1])
  );
