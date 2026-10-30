import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "../../lib/supabase-server";
import { requireWallet } from "../../lib/request-user";
import { normalizeRoomId } from "../../lib/rooms";

const ALLOWED = new Set(["👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "👏", "🙏", "🚀", "👀", "💯"]);

async function authorizeRoom(db: NonNullable<ReturnType<typeof createServiceRoleSupabaseClient>>, roomId: string, address: string) {
  const { data: room, error: roomError } = await db.schema("app").from("rooms").select("access").eq("id", roomId).maybeSingle();
  if (roomError || !room) return { ok: false as const, response: NextResponse.json({ error: "房间不存在。" }, { status: 404 }) };
  if (room.access !== "open") {
    const { data: access, error } = await db.schema("app").from("room_access").select("expires_at").eq("room_id", roomId).eq("user_address", address).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (error) return { ok: false as const, response: NextResponse.json({ error: "验证房间权限失败。" }, { status: 500 }) };
    if (!access) return { ok: false as const, response: NextResponse.json({ error: "你没有读取这个房间的权限。" }, { status: 403 }) };
  }
  return { ok: true as const };
}

export async function GET(request: Request) {
  const auth = await requireWallet(request);
  if (!auth.ok) return auth.response;
  const db = createServiceRoleSupabaseClient();
  if (!db) return NextResponse.json({ error: "服务端未配置数据库密钥。" }, { status: 500 });
  const url = new URL(request.url);
  const roomId = normalizeRoomId(url.searchParams.get("roomId") ?? "");
  if (!roomId) return NextResponse.json({ error: "房间不存在。" }, { status: 400 });
  const access = await authorizeRoom(db, roomId, auth.address);
  if (!access.ok) return access.response;

  const messageId = url.searchParams.get("messageId");
  const emoji = url.searchParams.get("emoji");
  if (messageId) {
    if (!emoji || !ALLOWED.has(emoji)) return NextResponse.json({ error: "无效的表情回应。" }, { status: 400 });
    const { data: message, error: messageError } = await db.schema("app").from("messages").select("id").eq("id", messageId).eq("room_id", roomId).is("deleted_at", null).maybeSingle();
    if (messageError || !message) return NextResponse.json({ error: "消息不存在。" }, { status: 404 });
    const offset = Math.max(0, Math.min(100000, Number(url.searchParams.get("offset") ?? 0) || 0));
    const { data: rows, error } = await db.schema("app").from("reactions").select("user_address, created_at").eq("room_id", roomId).eq("message_id", messageId).eq("emoji", emoji).order("created_at", { ascending: true }).range(offset, offset + 50);
    if (error) return NextResponse.json({ error: "读取回应参与者失败。" }, { status: 500 });
    const fetched = rows ?? [];
    const hasMore = fetched.length > 50;
    const reactions = fetched.slice(0, 50);
    const addresses = [...new Set(reactions.map((row) => row.user_address as string))];
    const { data: profiles, error: profileError } = addresses.length
      ? await db.schema("app").from("profiles").select("address, nickname, avatar_url").in("address", addresses)
      : { data: [], error: null };
    if (profileError) return NextResponse.json({ error: "读取参与者资料失败。" }, { status: 500 });
    const profileByAddress = new Map((profiles ?? []).map((profile) => [profile.address as string, profile]));
    const people = reactions.map((row) => {
      const profile = profileByAddress.get(row.user_address as string);
      const address = row.user_address as string;
      return {
        name: (profile?.nickname as string | null)?.trim() || `${address.slice(0, 6)}…${address.slice(-4)}`,
        avatarUrl: typeof profile?.avatar_url === "string" ? profile.avatar_url : null,
        createdAt: row.created_at,
        mine: address === auth.address,
      };
    });
    return NextResponse.json({ people, hasMore }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  }

  const rawIds = (url.searchParams.get("messageIds") ?? "").split(",").filter(Boolean);
  const messageIds = [...new Set(rawIds)].slice(0, 50);
  if (!messageIds.length) return NextResponse.json({ reactions: {} }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  const { data: rows, error } = await db.schema("app").from("reactions").select("message_id, emoji, user_address").eq("room_id", roomId).in("message_id", messageIds);
  if (error) return NextResponse.json({ error: "读取表情回应失败。" }, { status: 500 });
  const reactions: Record<string, { emoji: string; count: number; mine: boolean }[]> = {};
  for (const row of rows ?? []) {
    const list = reactions[row.message_id] ?? (reactions[row.message_id] = []);
    const existing = list.find((item) => item.emoji === row.emoji);
    if (existing) { existing.count += 1; existing.mine ||= row.user_address === auth.address; }
    else list.push({ emoji: row.emoji, count: 1, mine: row.user_address === auth.address });
  }
  return NextResponse.json({ reactions }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: Request) {
  const auth = await requireWallet(request);
  if (!auth.ok) return auth.response;
  let body: { roomId?: unknown; messageId?: unknown; emoji?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "请求格式错误。" }, { status: 400 }); }
  const roomId = normalizeRoomId(typeof body.roomId === "string" ? body.roomId : "");
  const messageId = typeof body.messageId === "string" ? body.messageId : "";
  const emoji = typeof body.emoji === "string" ? body.emoji : "";
  if (!roomId || !messageId || !ALLOWED.has(emoji)) return NextResponse.json({ error: "无效的表情回应。" }, { status: 400 });
  const db = createServiceRoleSupabaseClient();
  if (!db) return NextResponse.json({ error: "服务端未配置数据库密钥。" }, { status: 500 });
  const access = await authorizeRoom(db, roomId, auth.address);
  if (!access.ok) return access.response;
  const { data: message } = await db.schema("app").from("messages").select("id").eq("id", messageId).eq("room_id", roomId).is("deleted_at", null).maybeSingle();
  if (!message) return NextResponse.json({ error: "消息不存在。" }, { status: 404 });
  const { data: existing } = await db.schema("app").from("reactions").select("message_id").eq("message_id", messageId).eq("user_address", auth.address).eq("emoji", emoji).maybeSingle();
  if (existing) {
    const { error } = await db.schema("app").from("reactions").delete().eq("message_id", messageId).eq("user_address", auth.address).eq("emoji", emoji);
    if (error) return NextResponse.json({ error: "更新回应失败。" }, { status: 500 });
  } else {
    const { error } = await db.schema("app").from("reactions").insert({ message_id: messageId, room_id: roomId, user_address: auth.address, emoji });
    if (error) return NextResponse.json({ error: "保存回应失败。" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, active: !existing });
}
