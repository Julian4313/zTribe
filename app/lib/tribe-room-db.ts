import type { SupabaseClient } from "@supabase/supabase-js";
import { parseTokenAmount, readJoinGateFromDb } from "./room-gate-db";
import { isTribeRoom } from "./rooms";

function app(client: SupabaseClient) {
  return client.schema("app");
}

/** 首次进入部落时插入房间行，不覆盖已有门槛/酋长。 */
export async function ensureTribeRoomRow(
  writer: SupabaseClient,
  tokenAddress: string,
) {
  const token = tokenAddress.toLowerCase();
  if (!isTribeRoom(token)) {
    throw new Error("无效的 Tribe 代币地址。");
  }

  const { error } = await app(writer).from("rooms").upsert(
    {
      id: token,
      kind: "tribe",
      token_address: token,
      title: token,
      access: "token_gated",
      post_policy: "member",
    },
    { onConflict: "id", ignoreDuplicates: true },
  );

  if (error) {
    throw new Error(error.message);
  }
}

export async function updateTribeRequiredTokens(
  writer: SupabaseClient,
  tokenAddress: string,
  requiredTokens: string | null,
) {
  const token = tokenAddress.toLowerCase();
  await ensureTribeRoomRow(writer, token);

  const { error } = await app(writer)
    .from("rooms")
    .update({ required_tokens: requiredTokens })
    .eq("id", token);

  if (error) {
    throw new Error(error.message);
  }
}

export async function syncTribeFromIndexer(
  writer: SupabaseClient,
  tokenAddress: string,
  patch: {
    title?: string;
    requiredTokens?: string | null;
    chiefAddress?: string | null;
  },
) {
  const token = tokenAddress.toLowerCase();
  if (!isTribeRoom(token)) {
    throw new Error("无效的 Tribe 代币地址。");
  }

  await ensureTribeRoomRow(writer, token);

  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    update.title = patch.title.trim() || token;
  }
  if (patch.requiredTokens !== undefined) {
    update.required_tokens = patch.requiredTokens;
  }
  if (patch.chiefAddress !== undefined) {
    update.chief_address = patch.chiefAddress;
  }

  if (Object.keys(update).length === 0) {
    return;
  }

  const { error } = await app(writer).from("rooms").update(update).eq("id", token);

  if (error) {
    throw new Error(error.message);
  }
}

export type TribeGateSnapshot = {
  tokenAddress: string;
  requiredTokens: string | null;
  chiefAddress: string | null;
  myBalance: string;
  allowed: boolean;
};

export async function loadTribeGateSnapshot(
  writer: SupabaseClient,
  tokenAddress: string,
  walletAddress: string | null,
): Promise<TribeGateSnapshot> {
  const token = tokenAddress.toLowerCase();

  const { data: room, error: roomError } = await app(writer)
    .from("rooms")
    .select("required_tokens, chief_address")
    .eq("id", token)
    .maybeSingle();

  if (roomError) {
    throw new Error(roomError.message);
  }

  if (!walletAddress) {
    const minimum = parseTokenAmount(room?.required_tokens ?? 0);
    return {
      tokenAddress: token,
      requiredTokens:
        room?.required_tokens != null ? String(room.required_tokens) : null,
      chiefAddress: room?.chief_address ?? null,
      myBalance: "0",
      allowed: minimum === BigInt(0),
    };
  }

  const gate = await readJoinGateFromDb(writer, token, walletAddress);

  return {
    tokenAddress: token,
    requiredTokens:
      room?.required_tokens != null ? String(room.required_tokens) : null,
    chiefAddress: room?.chief_address ?? null,
    myBalance: gate.balance.toString(),
    allowed: gate.allowed,
  };
}
