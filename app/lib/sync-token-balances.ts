import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeTokenAddress } from "./normalize-token";

type BalanceInput = {
  tokenAddress?: unknown;
  walletAddress?: unknown;
  balance?: unknown;
};

function normalizeWallet(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(trimmed) ? trimmed : null;
}

function normalizeBalance(value: unknown) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      return null;
    }

    return String(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^\d+(\.\d+)?$/.test(trimmed) || Number(trimmed) < 0) {
      return null;
    }

    return trimmed;
  }

  return null;
}

export function parseBalanceRows(items: unknown[]) {
  const rows: {
    token_address: string;
    wallet_address: string;
    balance: string;
    updated_at: string;
  }[] = [];

  for (const item of items as BalanceInput[]) {
    const token = normalizeTokenAddress(
      typeof item.tokenAddress === "string" ? item.tokenAddress : "",
    );
    const wallet = normalizeWallet(item.walletAddress);
    const balance = normalizeBalance(item.balance);

    if (!token || !wallet || balance === null) {
      return { ok: false as const, error: "balances 中存在无效条目。" };
    }

    rows.push({
      token_address: token,
      wallet_address: wallet,
      balance,
      updated_at: new Date().toISOString(),
    });
  }

  return { ok: true as const, rows };
}

export async function upsertTokenBalances(
  writer: SupabaseClient,
  items: unknown[],
) {
  const parsed = parseBalanceRows(items);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }

  if (parsed.rows.length === 0) {
    return 0;
  }

  const { error } = await writer
    .schema("app")
    .from("wallet_token_balances")
    .upsert(parsed.rows, { onConflict: "token_address,wallet_address" });

  if (error) {
    throw new Error(error.message);
  }

  return parsed.rows.length;
}
