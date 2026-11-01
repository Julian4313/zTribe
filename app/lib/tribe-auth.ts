import type { SupabaseClient } from "@supabase/supabase-js";
import { isTribeRoom } from "./rooms";

function app(client: SupabaseClient) {
  return client.schema("app");
}

export async function isPlatformAdmin(
  writer: SupabaseClient,
  address: string,
): Promise<boolean> {
  const { data, error } = await app(writer)
    .from("admins")
    .select("role")
    .eq("address", address.toLowerCase())
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data?.role === "platform_admin";
}

export async function isTribeChief(
  writer: SupabaseClient,
  tokenAddress: string,
  address: string,
): Promise<boolean> {
  if (!isTribeRoom(tokenAddress)) {
    return false;
  }

  const token = tokenAddress.toLowerCase();
  const wallet = address.toLowerCase();

  const { data, error } = await app(writer)
    .from("rooms")
    .select("chief_address")
    .eq("id", token)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data?.chief_address === wallet;
}

export async function canManageTribeGate(
  writer: SupabaseClient,
  tokenAddress: string,
  address: string,
): Promise<boolean> {
  if (await isPlatformAdmin(writer, address)) {
    return true;
  }

  return isTribeChief(writer, tokenAddress, address);
}
