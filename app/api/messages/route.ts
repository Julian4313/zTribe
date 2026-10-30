import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleSupabaseClient } from "../../lib/supabase-server";
import { requireWallet } from "../../lib/request-user";
import { normalizeRoomId } from "../../lib/rooms";
import { authorizeRoomPost } from "../../lib/room-post";
import { getOrCreateWalletIdentity } from "../../lib/wallet-identity";


type CreateMessageBody = { roomId?: unknown; content?: unknown; mediaKind?: unknown };
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_VOICE_SIZE = 10 * 1024 * 1024;
const ALLOWED_VOICE_TYPES = new Set(["audio/webm", "audio/mp4", "audio/ogg", "audio/mpeg", "audio/wav", "audio/x-wav"]);
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

function voiceExtension(type: string) {
  switch (type) {
    case "audio/mp4": return "m4a";
    case "audio/ogg": return "ogg";
    case "audio/mpeg": return "mp3";
    case "audio/wav": case "audio/x-wav": return "wav";
    case "audio/webm": return "webm";
    default: return null;
  }
}
function imageExtension(type: string) {
  switch (type) {
    case "image/jpeg": return "jpg";
    case "image/png": return "png";
    case "image/gif": return "gif";
    case "image/webp": return "webp";
    default: return null;
  }
}

async function publicMessages(writer: SupabaseClient, rows: Record<string, unknown>[], viewerAuthorId: string) {
  const authorIds = [...new Set(rows.map((row) => typeof row.author_id === "string" ? row.author_id : null).filter((id): id is string => !!id))];
  const identitiesResult = authorIds.length
    ? await writer.schema("app").from("wallet_identities").select("id, wallet_address").in("id", authorIds)
    : { data: [], error: null };
  if (identitiesResult.error) throw new Error(`读取消息作者失败：${identitiesResult.error.message}`);
  const identityById = new Map((identitiesResult.data ?? []).map((identity) => [identity.id as string, identity.wallet_address as string]));
  const addresses = [...new Set([...identityById.values()])];
  const profilesResult = addresses.length
    ? await writer.schema("app").from("profiles").select("address, nickname").in("address", addresses)
    : { data: [], error: null };
  if (profilesResult.error) throw new Error(`读取作者昵称失败：${profilesResult.error.message}`);
  const nicknameByAddress = new Map((profilesResult.data ?? []).map((profile) => [profile.address as string, (profile.nickname as string | null)?.trim() || "新用户"]));

  const imagePaths = [...new Set(rows.filter((row) => row.kind === "image" && typeof row.media_url === "string").map((row) => row.media_url as string))];
  const voicePaths = [...new Set(rows.filter((row) => row.kind === "voice" && typeof row.media_url === "string").map((row) => row.media_url as string))];
  const [images, voices] = await Promise.all([
    imagePaths.length ? writer.storage.from("chat-images").createSignedUrls(imagePaths, 60 * 60) : Promise.resolve({ data: [], error: null }),
    voicePaths.length ? writer.storage.from("chat-voice").createSignedUrls(voicePaths, 60 * 60) : Promise.resolve({ data: [], error: null }),
  ]);
  const signedByPath = new Map<string, string>();
  for (const item of [...(images.data ?? []), ...(voices.data ?? [])]) {
    if (item.path && item.signedUrl) signedByPath.set(item.path, item.signedUrl);
  }

  return rows.map((row) => {
    const authorId = typeof row.author_id === "string" ? row.author_id : null;
    const address = authorId ? identityById.get(authorId) ?? null : null;
    const rawMediaPath = typeof row.media_url === "string" ? row.media_url : null;
    return {
      id: row.id, seq: row.seq, room_id: row.room_id,
      author_name: address ? nicknameByAddress.get(address) ?? "新用户" : "系统",
      is_mine: authorId === viewerAuthorId,
      kind: row.kind, content: row.content,
      media_url: rawMediaPath ? signedByPath.get(rawMediaPath) ?? null : null,
      created_at: row.created_at,
    };
  });
}

export async function GET(request: Request) {
  const auth = await requireWallet(request);
  if (!auth.ok) return auth.response;
  const writer = createServiceRoleSupabaseClient();
  if (!writer) return NextResponse.json({ error: "服务端未配置 SUPABASE_SECRET_KEY。" }, { status: 500 });
  const viewerAuthorId = await getOrCreateWalletIdentity(writer, auth.address);
  const url = new URL(request.url);
  const roomId = normalizeRoomId(url.searchParams.get("roomId") ?? "");
  if (!roomId) return NextResponse.json({ error: "房间不存在。" }, { status: 400 });
  const limit = Math.min(51, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
  const beforeSeq = Number(url.searchParams.get("beforeSeq"));
  const afterSeq = Number(url.searchParams.get("afterSeq"));

  const { data: room, error: roomError } = await writer.schema("app").from("rooms").select("id, access").eq("id", roomId).maybeSingle();
  if (roomError || !room) return NextResponse.json({ error: "房间不存在。" }, { status: 404 });
  if (room.access !== "open") {
    const { data: access, error } = await writer.schema("app").from("room_access").select("expires_at").eq("room_id", roomId).eq("user_address", auth.address).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (error) return NextResponse.json({ error: "验证房间权限失败。" }, { status: 500 });
    if (!access) return NextResponse.json({ error: "你没有读取这个房间的权限。" }, { status: 403 });
  }
  const incremental = url.searchParams.has("afterSeq");
  let query = writer.schema("app").from("messages").select("id, seq, room_id, author_id, kind, content, media_url, created_at").eq("room_id", roomId).is("deleted_at", null).order("seq", { ascending: incremental }).limit(limit);
  if (Number.isFinite(beforeSeq) && beforeSeq > 0) query = query.lt("seq", beforeSeq);
  if (Number.isFinite(afterSeq) && afterSeq > 0) query = query.gt("seq", afterSeq);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: `加载消息失败：${error.message}` }, { status: 500 });
  const messages = await publicMessages(writer, (data ?? []) as Record<string, unknown>[], viewerAuthorId);
  return NextResponse.json({ messages }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: Request) {
  const auth = await requireWallet(request);
  if (!auth.ok) return auth.response;
  const contentType = request.headers.get("content-type") ?? "";
  let roomId: string;
  let content: string;
  let imageFile: File | null = null;
  let mediaKind: "image" | "voice" = "image";
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      roomId = normalizeRoomId(typeof form.get("roomId") === "string" ? String(form.get("roomId")) : "") ?? "";
      content = typeof form.get("content") === "string" ? String(form.get("content")).trim() : "";
      const file = form.get("file"); imageFile = file instanceof File ? file : null;
      mediaKind = form.get("mediaKind") === "voice" ? "voice" : "image";
    } else {
      const body = await request.json() as CreateMessageBody;
      roomId = normalizeRoomId(typeof body.roomId === "string" ? body.roomId : "") ?? "";
      content = typeof body.content === "string" ? body.content.trim() : "";
    }
  } catch { return NextResponse.json({ error: "无法解析发送内容。" }, { status: 400 }); }
  if (!roomId) return NextResponse.json({ error: "房间不存在。" }, { status: 400 });
  if (contentType.includes("multipart/form-data") && !imageFile) return NextResponse.json({ error: "没有收到有效媒体文件。" }, { status: 400 });
  if (!imageFile && !content) return NextResponse.json({ error: "消息内容不能为空。" }, { status: 400 });
  if (imageFile && mediaKind === "image" && !ALLOWED_IMAGE_TYPES.has(imageFile.type)) return NextResponse.json({ error: "图片格式仅支持 JPG、PNG、GIF、WebP。" }, { status: 400 });
  if (imageFile && mediaKind === "voice" && !ALLOWED_VOICE_TYPES.has(imageFile.type)) return NextResponse.json({ error: "语音格式仅支持 WebM、MP4、OGG、MP3、WAV。" }, { status: 400 });
  if (imageFile && imageFile.size > (mediaKind === "voice" ? MAX_VOICE_SIZE : MAX_IMAGE_SIZE)) return NextResponse.json({ error: "媒体文件不能超过 10 MB。" }, { status: 413 });
  const writer = createServiceRoleSupabaseClient();
  if (!writer) return NextResponse.json({ error: "服务端未配置 SUPABASE_SECRET_KEY。" }, { status: 500 });
  let uploadedPath: string | null = null;
  try {
    const gate = await authorizeRoomPost(writer, roomId, auth.address);
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
    let mediaUrl: string | null = null;
    if (imageFile) {
      const extension = mediaKind === "voice" ? voiceExtension(imageFile.type) : imageExtension(imageFile.type);
      if (!extension) return NextResponse.json({ error: "不支持的媒体格式。" }, { status: 400 });
      // Opaque path: wallet addresses are never embedded in new object names.
      uploadedPath = `${roomId}/${crypto.randomUUID()}/${crypto.randomUUID()}.${extension}`;
      const bucket = mediaKind === "voice" ? "chat-voice" : "chat-images";
      const { error: uploadError } = await writer.storage.from(bucket).upload(uploadedPath, imageFile, { contentType: imageFile.type, cacheControl: "3600", upsert: false });
      if (uploadError) return NextResponse.json({ error: `媒体上传失败：${uploadError.message}` }, { status: 500 });
      mediaUrl = uploadedPath;
      content = content || (mediaKind === "voice" ? "语音消息" : "图片");
    }
    const authorId = await getOrCreateWalletIdentity(writer, auth.address);
    const { data, error } = await writer.schema("app").from("messages").insert({ room_id: roomId, author_id: authorId, kind: imageFile ? mediaKind : "text", source: "app", content, media_url: mediaUrl }).select("id, seq, room_id, author_id, kind, content, media_url, created_at").single();
    if (error) {
      if (uploadedPath) await writer.storage.from(mediaKind === "voice" ? "chat-voice" : "chat-images").remove([uploadedPath]);
      return NextResponse.json({ error: `发送失败：${error.message}` }, { status: 500 });
    }
    const [message] = await publicMessages(writer, [data as Record<string, unknown>], authorId);
    return NextResponse.json({ message }, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (uploadedPath) await writer.storage.from(mediaKind === "voice" ? "chat-voice" : "chat-images").remove([uploadedPath]).catch(() => undefined);
    return NextResponse.json({ error: `发送失败：${error instanceof Error ? error.message : "发送失败。"}` }, { status: 500 });
  }
}
