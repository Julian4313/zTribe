import type { SupabaseClient } from "@supabase/supabase-js";

/** Resolve a wallet to an opaque internal author UUID. The wallet value never leaves the server. */
export async function getOrCreateWalletIdentity(writer: SupabaseClient, address: string): Promise<string> {
  const schema = writer.schema("app");
  const { data: existing, error: readError } = await schema
    .from("wallet_identities")
    .select("id")
    .eq("wallet_address", address)
    .maybeSingle();
  if (readError) throw new Error(`读取钱包身份失败：${readError.message}`);
  if (existing?.id) return existing.id as string;

  const { data: created, error: insertError } = await schema
    .from("wallet_identities")
    .insert({ wallet_address: address })
    .select("id")
    .single();
  if (!insertError && created?.id) return created.id as string;

  // Another request/tab may have created the identity concurrently.
  if (insertError?.code === "23505") {
    const { data: raced, error: racedError } = await schema
      .from("wallet_identities")
      .select("id")
      .eq("wallet_address", address)
      .single();
    if (!racedError && raced?.id) return raced.id as string;
  }
  throw new Error(`创建钱包身份失败：${insertError?.message ?? "无法读取已创建身份。"}`);
}
