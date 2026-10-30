-- Efficiently load the people who added a particular emoji to a message.
create index if not exists reactions_message_emoji_created_idx
  on app.reactions (room_id, message_id, emoji, created_at, user_address);
