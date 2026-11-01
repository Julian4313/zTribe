import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "../../../lib/supabase-server";
import { requireWallet } from "../../../lib/request-user";
import { loadMyTribes } from "../../../lib/tribe-room-db";

export async function GET(request: Request) {
  const auth = await requireWallet(request);
  if (!auth.ok) {
    return auth.response;
  }

  const writer = createServiceRoleSupabaseClient();
  if (!writer) {
    return NextResponse.json(
      { error: "服务端未配置 SUPABASE_SECRET_KEY。" },
      { status: 500 },
    );
  }

  try {
    const tribes = await loadMyTribes(writer, auth.address);
    return NextResponse.json({ tribes });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "读取 My Tribe 列表失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
