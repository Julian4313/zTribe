
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function getSupabaseUrl() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  }
  return url;
}

function getPublishableKey() {
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  }
  return key;
}

/** Browser-user scoped client: JWT is used for Auth + RLS. */
export function createUserSupabaseClient(accessToken: string): SupabaseClient {
  return createClient(getSupabaseUrl(), getPublishableKey(), {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Privileged server client that bypasses RLS.
 * Accepts the new Supabase secret key or the legacy service_role JWT.
 * Never expose these values with NEXT_PUBLIC_*.
 */
export function createServiceRoleSupabaseClient(): SupabaseClient | null {
  const secretKey =
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!secretKey) {
    return null;
  }

  return createClient(getSupabaseUrl(), secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
