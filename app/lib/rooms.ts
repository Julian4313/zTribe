export const WORLD_GENERAL = "world:general";
export const WORLD_ANNOUNCEMENTS = "world:announcements";
export const WORLD_CORE = "world:core";

const WORLD_ROOMS = new Set([
  WORLD_GENERAL,
  WORLD_ANNOUNCEMENTS,
  WORLD_CORE,
]);

const TOKEN_ROOM = /^0x[a-f0-9]{40}$/;

export function normalizeRoomId(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  if (WORLD_ROOMS.has(trimmed) || TOKEN_ROOM.test(trimmed)) {
    return trimmed;
  }

  return null;
}

export function isTribeRoom(roomId: string) {
  return TOKEN_ROOM.test(roomId);
}

export function roomTitle(roomId: string) {
  if (roomId === WORLD_GENERAL) {
    return "general";
  }
  if (roomId === WORLD_ANNOUNCEMENTS) {
    return "announcements";
  }
  if (roomId === WORLD_CORE) {
    return "core";
  }
  if (isTribeRoom(roomId)) {
    return `${roomId.slice(0, 6)}…${roomId.slice(-4)}`;
  }
  return roomId;
}
