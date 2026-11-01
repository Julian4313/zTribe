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

export type MyTribeEntry = {
  tokenAddress: string;
  title: string;
  balance: string;
  requiredTokens: string | null;
  allowed: boolean;
};

/** 当前钱包在 DB 快照里持仓 > 0 的 Tribe（token_address = room id）。 */
export async function loadMyTribes(
  writer: SupabaseClient,
  walletAddress: string,
): Promise<MyTribeEntry[]> {
  const wallet = walletAddress.toLowerCase();

  const { data: balances, error: balanceError } = await app(writer)
    .from("wallet_token_balances")
    .select("token_address, balance")
    .eq("wallet_address", wallet);

  if (balanceError) {
    throw new Error(balanceError.message);
  }

  const held = (balances ?? []).filter(
    (row) =>
      isTribeRoom(row.token_address) &&
      parseTokenAmount(row.balance) > BigInt(0),
  );

  if (held.length === 0) {
    return [];
  }

  const tokens = held.map((row) => row.token_address);
  const { data: rooms, error: roomError } = await app(writer)
    .from("rooms")
    .select("id, title, required_tokens")
    .in("id", tokens);

  if (roomError) {
    throw new Error(roomError.message);
  }

  const roomById = new Map(
    (rooms ?? []).map((room) => [room.id as string, room]),
  );

  const entries: MyTribeEntry[] = held.map((row) => {
    const token = row.token_address;
    const room = roomById.get(token);
    const balance = parseTokenAmount(row.balance);
    const minimum = parseTokenAmount(room?.required_tokens ?? 0);
    const rawTitle =
      typeof room?.title === "string" ? room.title.trim() : "";

    return {
      tokenAddress: token,
      title: rawTitle && rawTitle !== token ? rawTitle : token,
      balance: balance.toString(),
      requiredTokens:
        room?.required_tokens != null ? String(room.required_tokens) : null,
      allowed: balance >= minimum,
    };
  });

  entries.sort((a, b) => a.title.localeCompare(b.title));
  return entries;
}

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
