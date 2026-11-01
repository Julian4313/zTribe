import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "../../../../lib/supabase-server";
import { requireWallet } from "../../../../lib/request-user";
import { canManageTribeGate } from "../../../../lib/tribe-auth";
import {
  loadTribeGateSnapshot,
  updateTribeRequiredTokens,
} from "../../../../lib/tribe-room-db";
import {
  normalizeTokenAddress,
  parseRequiredTokensInput,
} from "../../../../lib/normalize-token";
import { isTribeRoom } from "../../../../lib/rooms";

type RouteContext = { params: Promise<{ token: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireWallet(_request);
  if (!auth.ok) {
    return auth.response;
  }

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

  try {
    const canEdit = await canManageTribeGate(writer, token, auth.address);
    const snapshot = await loadTribeGateSnapshot(writer, token, auth.address);

    return NextResponse.json({
      ...snapshot,
      canEdit,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取部落设置失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

type PatchBody = {
  requiredTokens?: unknown;
};

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireWallet(request);
  if (!auth.ok) {
    return auth.response;
  }

  const { token: rawToken } = await context.params;
  const token = normalizeTokenAddress(rawToken);
  if (!token || !isTribeRoom(token)) {
    return NextResponse.json({ error: "无效的 Tribe 地址。" }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON。" }, { status: 400 });
  }

  if (body.requiredTokens === undefined) {
    return NextResponse.json(
      { error: "请提供 requiredTokens。" },
      { status: 400 },
    );
  }

  const parsed = parseRequiredTokensInput(body.requiredTokens);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const writer = createServiceRoleSupabaseClient();
  if (!writer) {
    return NextResponse.json(
      { error: "服务端未配置 SUPABASE_SECRET_KEY。" },
      { status: 500 },
    );
  }

  try {
    const allowed = await canManageTribeGate(writer, token, auth.address);
    if (!allowed) {
      return NextResponse.json(
        { error: "只有酋长或平台管理员可以修改入群门槛。" },
        { status: 403 },
      );
    }

    await updateTribeRequiredTokens(writer, token, parsed.value);

    const snapshot = await loadTribeGateSnapshot(writer, token, auth.address);

    return NextResponse.json({
      ...snapshot,
      canEdit: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存部落设置失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
