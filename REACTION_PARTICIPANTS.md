# Reaction participant visibility

## Behavior
- Clicking a reaction pill continues to add or remove that emoji, unchanged.
- On desktop, hovering over an existing reaction pill shows a compact participant tooltip.
- On touch devices, long-pressing an existing reaction pill shows the same participant preview.
- The preview shows display names and profile avatars when available; “查看全部参与者” opens the full paginated list with reaction times.
- The current user is marked as `你`; their reaction can be removed from the full list.
- Participant lists are fetched only when opened and paginated 50 at a time.
- The room summary endpoint is scoped to the message IDs currently loaded by the chat client (maximum 50), rather than scanning every reaction in the room.

## Database migration
Apply `supabase/migrations/20261030210000_reaction_participant_lookup.sql` to add the lookup index used by the paginated participant query.

## API
`GET /api/reactions?roomId=...&messageIds=id1,id2` returns aggregate counts and the viewer's own-reaction flag for the supplied messages.

`GET /api/reactions?roomId=...&messageId=...&emoji=...&offset=0` returns up to 50 sanitized participant records. Wallet addresses are never returned to the browser.
