-- Private chat image storage. Uploads are performed server-side after wallet and room-post authorization.
-- Reads are allowed only to users who can read the room containing the image.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-images',
  'chat-images',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "chat images readable by room members" on storage.objects;
create policy "chat images readable by room members"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'chat-images'
    and app.can_read_room((storage.foldername(name))[1])
  );
