import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "../../../../lib/supabase-server";
import { getBearerToken } from "../../../../lib/request-user";
import { createUserSupabaseClient } from "../../../../lib/supabase-server";
import { getEthereumAddressFromUser } from "../../../../lib/user-display";
import { loadTribeGateSnapshot } from "../../../../lib/tribe-room-db";
import { normalizeTokenAddress } from "../../../../lib/normalize-token";
import { isTribeRoom } from "../../../../lib/rooms";

type RouteContext = { params: Promise<{ token: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { token: rawToken } = await context.params;
  const token = normalizeTokenAddress(rawToken);

  if (!token || !isTribeRoom(token)) {
    return NextResponse.json({ error: "无效的 Tribe 地址。" }, { status: 400 });
  }

  const writer = createServiceRoleSupabaseClient();
  if (!writer) {
    return NextResponse.json(
      { error: "服务端未配置 SUPABASE_SECRET_KEY。" },
      { status: 500 },
    );
  }

  let wallet: string | null = null;
  const accessToken = getBearerToken(request.headers.get("authorization"));
  if (accessToken) {
    const userClient = createUserSupabaseClient(accessToken);
    const {
      data: { user },
    } = await userClient.auth.getUser(accessToken);
    if (user) {
      wallet = getEthereumAddressFromUser(user)?.toLowerCase() ?? null;
    }
  }

  try {
    const snapshot = await loadTribeGateSnapshot(writer, token, wallet);
    return NextResponse.json(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取入群门槛失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
