import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readJoinGateFromDb } from "./room-gate-db";
import { ensureTribeRoomRow } from "./tribe-room-db";
import { isPlatformAdmin } from "./tribe-auth";
import {
  WORLD_ANNOUNCEMENTS,
  WORLD_CORE,
  WORLD_GENERAL,
  isTribeRoom,
} from "./rooms";

const ACCESS_TTL_MS = 15 * 60 * 1000;

type GateResult =
  | { ok: true; expiresAt: string | null }
  | { ok: false; status: number; error: string };

function app(client: SupabaseClient) {
  return client.schema("app");
}

async function ensureProfile(writer: SupabaseClient, address: string) {
  const { error } = await app(writer)
    .from("profiles")
    .upsert({ address }, { onConflict: "address", ignoreDuplicates: true });

  if (error) {
    throw new Error(error.message);
  }
}

type ActiveModeration = {
  globalMute: boolean;
  roomFreeze: boolean;
  roomMute: boolean;
};

async function activeModeration(
  writer: SupabaseClient,
  roomId: string,
  address: string,
): Promise<ActiveModeration> {
  // Only fetch the three moderation cases that can block this specific post.
  // This avoids loading every active moderation record on every message.
  const activeUntil = `until.is.null,until.gt.${new Date().toISOString()}`;

  const [globalMute, roomFreeze, roomMute] = await Promise.all([
    app(writer)
      .from("moderation")
      .select("id")
      .eq("scope", "global")
      .eq("type", "mute")
      .eq("target_address", address)
      .is("revoked_at", null)
      .or(activeUntil)
      .limit(1),
    app(writer)
      .from("moderation")
      .select("id")
      .eq("scope", "room")
      .eq("room_id", roomId)
      .eq("type", "freeze")
      .is("revoked_at", null)
      .or(activeUntil)
      .limit(1),
    app(writer)
      .from("moderation")
      .select("id")
      .eq("scope", "room")
      .eq("room_id", roomId)
      .eq("type", "mute")
      .eq("target_address", address)
      .is("revoked_at", null)
      .or(activeUntil)
      .limit(1),
  ]);

  const error = globalMute.error ?? roomFreeze.error ?? roomMute.error;
  if (error) {
    throw new Error(error.message);
  }

  return {
    globalMute: (globalMute.data?.length ?? 0) > 0,
    roomFreeze: (roomFreeze.data?.length ?? 0) > 0,
    roomMute: (roomMute.data?.length ?? 0) > 0,
  };
}

async function getValidRoomAccessExpiry(
  writer: SupabaseClient,
  roomId: string,
  address: string,
): Promise<string | null> {
  const { data, error } = await app(writer)
    .from("room_access")
    .select("expires_at")
    .eq("room_id", roomId)
    .eq("user_address", address)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data?.expires_at ?? null;
}


async function grantRoomAccess(
  writer: SupabaseClient,
  roomId: string,
  address: string,
) {
  const { data: existing, error: readError } = await app(writer)
    .from("room_access")
    .select("granted_at")
    .eq("room_id", roomId)
    .eq("user_address", address)
    .maybeSingle();

  if (readError) {
    throw new Error(readError.message);
  }

  const grantedAt = existing?.granted_at ?? new Date().toISOString();
  const expiresAt = new Date(Date.now() + ACCESS_TTL_MS).toISOString();

  const { error } = await app(writer).from("room_access").upsert(
    {
      room_id: roomId,
      user_address: address,
      granted_at: grantedAt,
      expires_at: expiresAt,
    },
    { onConflict: "room_id,user_address" },
  );

  if (error) {
    throw new Error(error.message);
  }

  if (!existing) {
    const { data: profile } = await app(writer)
      .from("profiles")
      .select("nickname")
      .eq("address", address)
      .maybeSingle();

    const name = profile?.nickname?.trim() || "新用户";
    const { error: joinError } = await app(writer).from("messages").insert({
      room_id: roomId,
      kind: "system",
      source: "app",
      system_code: "join",
      event_key: `join:${roomId}:${createHash("sha256").update(address).digest("hex")}`,
      content: `${name} 加入了部落`,
      system_payload: { nickname: name },
    });

    if (joinError && joinError.code !== "23505") {
      throw new Error(joinError.message);
    }
  }

  return expiresAt;
}

async function expireRoomAccess(
  writer: SupabaseClient,
  roomId: string,
  address: string,
) {
  await app(writer)
    .from("room_access")
    .delete()
    .eq("room_id", roomId)
    .eq("user_address", address);
}

export async function authorizeRoomPost(
  writer: SupabaseClient,
  roomId: string,
  address: string,
): Promise<GateResult> {
  await ensureProfile(writer, address);

  if (roomId === WORLD_CORE) {
    return { ok: false, status: 403, error: "Core 房间本期不开放。" };
  }

  const blocks = await activeModeration(writer, roomId, address);
  if (blocks.globalMute) {
    return { ok: false, status: 403, error: "你已被全站禁言。" };
  }

  if (roomId === WORLD_GENERAL) {
    return { ok: true, expiresAt: null };
  }

  if (roomId === WORLD_ANNOUNCEMENTS) {
    const allowed = await isPlatformAdmin(writer, address);
    if (!allowed) {
      return { ok: false, status: 403, error: "只有平台管理员可以在公告频道发言。" };
    }
    return { ok: true, expiresAt: null };
  }

  if (!isTribeRoom(roomId)) {
    return { ok: false, status: 400, error: "房间不存在。" };
  }

  if (blocks.roomFreeze) {
    return { ok: false, status: 403, error: "这个部落已被资料冻结，暂时不能发言。" };
  }

  if (blocks.roomMute) {
    return { ok: false, status: 403, error: "你已被禁言，无法发送消息。" };
  }

  await ensureTribeRoomRow(writer, roomId);

  // DB 持仓快照 + rooms.required_tokens；15 分钟内复用 room_access，过期后再查库。
  try {
    const cachedExpiry = await getValidRoomAccessExpiry(writer, roomId, address);
    if (cachedExpiry) {
      return { ok: true, expiresAt: cachedExpiry };
    }

    const gate = await readJoinGateFromDb(writer, roomId, address);
    if (!gate.allowed) {
      await expireRoomAccess(writer, roomId, address);
      return { ok: false, status: 403, error: "持仓没有达到入群门槛。" };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "入群校验失败。";
    return { ok: false, status: 502, error: `入群校验失败：${message}` };
  }

  const expiresAt = await grantRoomAccess(writer, roomId, address);
  return { ok: true, expiresAt };
}
