import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "../../../../lib/supabase-server";
import { requireIndexerKey } from "../../../../lib/indexer-auth";
import {
  normalizeTokenAddress,
  parseRequiredTokensInput,
} from "../../../../lib/normalize-token";
import { syncTribeFromIndexer } from "../../../../lib/tribe-room-db";
import { upsertTokenBalances } from "../../../../lib/sync-token-balances";

type SyncBody = {
  tokenAddress?: unknown;
  title?: unknown;
  requiredTokens?: unknown;
  chiefAddress?: unknown;
  balances?: unknown;
};

function normalizeWallet(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  return /^0x[0-9a-f]{40}$/.test(trimmed) ? trimmed : undefined;
}

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

  const token =
    typeof body.tokenAddress === "string"
      ? normalizeTokenAddress(body.tokenAddress)
      : null;

  if (!token) {
    return NextResponse.json({ error: "tokenAddress 无效。" }, { status: 400 });
  }

  let requiredTokens: string | null | undefined;
  if (body.requiredTokens !== undefined) {
    const parsed = parseRequiredTokensInput(body.requiredTokens);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    requiredTokens = parsed.value;
  }

  let chiefAddress: string | null | undefined;
  if (body.chiefAddress !== undefined) {
    const normalized = normalizeWallet(body.chiefAddress);
    if (normalized === undefined) {
      return NextResponse.json({ error: "chiefAddress 无效。" }, { status: 400 });
    }

    chiefAddress = normalized;
  }

  const writer = createServiceRoleSupabaseClient();
  if (!writer) {
    return NextResponse.json(
      { error: "服务端未配置 SUPABASE_SECRET_KEY。" },
      { status: 500 },
    );
  }

  try {
    await syncTribeFromIndexer(writer, token, {
      title: typeof body.title === "string" ? body.title : undefined,
      requiredTokens,
      chiefAddress,
    });

    let synced = 0;
    if (Array.isArray(body.balances) && body.balances.length > 0) {
      synced = await upsertTokenBalances(writer, body.balances);
    }

    return NextResponse.json({ ok: true, tokenAddress: token, syncedBalances: synced });
  } catch (error) {
    const message = error instanceof Error ? error.message : "同步部落失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
