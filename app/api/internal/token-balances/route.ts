import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "../../../lib/supabase-server";
import { requireIndexerKey } from "../../../lib/indexer-auth";
import { upsertTokenBalances } from "../../../lib/sync-token-balances";

type SyncBody = {
  balances?: unknown;
};

export async function POST(request: Request) {
  const indexer = requireIndexerKey(request);
  if (!indexer.ok) {
    return indexer.response;
  }

  let body: SyncBody;
  try {
    body = (await request.json()) as SyncBody;
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON。" }, { status: 400 });
  }

  if (!Array.isArray(body.balances) || body.balances.length === 0) {
    return NextResponse.json(
      { error: "balances 必须是非空数组。" },
      { status: 400 },
    );
  }

  if (body.balances.length > 500) {
    return NextResponse.json(
      { error: "单次最多同步 500 条持仓。" },
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
    const synced = await upsertTokenBalances(writer, body.balances);
    return NextResponse.json({ synced });
  } catch (error) {
    const message = error instanceof Error ? error.message : "同步持仓失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
