import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "../../../lib/supabase-server";
import { requireWallet } from "../../../lib/request-user";
import { isTribeRoom, normalizeRoomId } from "../../../lib/rooms";
import { authorizeRoomPost } from "../../../lib/room-post";

type AccessBody = {
  roomId?: unknown;
};

export async function POST(request: Request) {
  const auth = await requireWallet(request);
  if (!auth.ok) {
    return auth.response;
  }

  let body: AccessBody;
  try {
    body = (await request.json()) as AccessBody;
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON。" }, { status: 400 });
  }

  const roomId = normalizeRoomId(
    typeof body.roomId === "string" ? body.roomId : "",
  );

  if (!roomId || !isTribeRoom(roomId)) {
    return NextResponse.json(
      { error: "只有部落房间需要入群校验。" },
      { status: 400 },
    );
  }

  const writer = createServiceRoleSupabaseClient();
  if (!writer) {
    return NextResponse.json(
      { error: "服务端未配置 SUPABASE_SECRET_KEY。" },
      { status: 500 },
    );
  }

  try {
    const gate = await authorizeRoomPost(writer, roomId, auth.address);
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }

    return NextResponse.json({
      roomId,
      expiresAt: gate.expiresAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "入群校验失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
