import type { SupabaseClient } from "@supabase/supabase-js";

function app(client: SupabaseClient) {
  return client.schema("app");
}

/** 与链上 uint256 对齐：只比较整数部分，避免浮点误差。 */
export function parseTokenAmount(value: unknown): bigint {
  if (value === null || value === undefined) {
    return BigInt(0);
  }

  const raw = String(value).trim();
  if (!raw) {
    return BigInt(0);
  }

  const [whole] = raw.split(".");
  const digits = whole?.replace(/^0+/, "") || "0";
  if (!/^\d+$/.test(digits)) {
    return BigInt(0);
  }

  return BigInt(digits);
}

export type DbJoinGateResult = {
  allowed: boolean;
  balance: bigint;
  minimum: bigint;
};

export async function readJoinGateFromDb(
  writer: SupabaseClient,
  tokenAddress: string,
  walletAddress: string,
): Promise<DbJoinGateResult> {
  const token = tokenAddress.toLowerCase();
  const wallet = walletAddress.toLowerCase();

  const [roomResult, balanceResult] = await Promise.all([
    app(writer)
      .from("rooms")
      .select("required_tokens")
      .eq("id", token)
      .maybeSingle(),
    app(writer)
      .from("wallet_token_balances")
      .select("balance")
      .eq("token_address", token)
      .eq("wallet_address", wallet)
      .maybeSingle(),
  ]);

  if (roomResult.error) {
    throw new Error(roomResult.error.message);
  }

  if (balanceResult.error) {
    throw new Error(balanceResult.error.message);
  }

  const minimum = parseTokenAmount(roomResult.data?.required_tokens ?? 0);
  const balance = parseTokenAmount(balanceResult.data?.balance ?? 0);

  return {
    allowed: balance >= minimum,
    balance,
    minimum,
  };
}
