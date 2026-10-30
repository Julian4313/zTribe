# Reply thread optimization

This change replaces full-room history scans when opening a discussion with indexed, per-thread pagination.

## Apply the database migration

Run `supabase/migrations/20261030200000_message_reply_threads.sql` against the same Supabase database used by this app before deploying the updated Next.js code.

The migration:

- Adds `reply_count`, `latest_reply_id`, and `latest_reply_at` to `app.messages`.
- Backfills metadata for existing replies.
- Adds a partial index on `(room_id, reply_to, seq desc)` for non-deleted replies.
- Installs a trigger to maintain counts and latest-reply metadata on insert, delete, soft-delete, restore, or parent reassignment.

## API behavior

- Normal room message reads include denormalized reply metadata and the latest reply preview.
- `GET /api/messages?roomId=...&threadId=...&limit=30` returns only replies to that parent.
- Pass `beforeSeq` using `next_before_seq` to load older replies. The API returns `has_more` and `reply_count`.
- Opening a thread no longer paginates through the room's general message history.

The discussion panel initially loads the latest 30 replies; older replies are fetched only when the user requests them.
