# ZTribe interaction updates

## Changes

- Emoji reaction inserts and deletes now publish a privacy-safe row to `app.message_events` through a database trigger.
- The existing room Realtime subscription refreshes reaction aggregates through the authenticated `/api/reactions` endpoint. The browser does not subscribe to `app.reactions` and does not receive wallet addresses through Realtime.
- An open reaction participant preview or modal refreshes its participant list when a reaction event arrives.
- The discussion entry is rendered only when the message has at least one reply (`reply_count > 0` or a reply is already present in the loaded timeline).

## Required database migration

Apply `supabase/migrations/20261030220000_reaction_realtime_events.sql` to the same Supabase database after the existing migrations. It creates the reaction event trigger; without it, the frontend change alone cannot receive Realtime notifications for reactions.

## Verification

- `app/home-client.tsx` passed TypeScript/TSX syntax transpilation.
- A full Next.js build, ESLint run, browser test, and live Supabase Realtime test were not run in this environment because dependencies and project environment credentials are not present.
