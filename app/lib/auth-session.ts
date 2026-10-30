import type { SupabaseClient, User } from "@supabase/supabase-js";

/** Prefer getUser() so Web3 identities (wallet address) are present. */
export async function resolveCurrentUser(
  supabase: SupabaseClient,
): Promise<{ user: User | null; errorMessage: string | null }> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    return { user: null, errorMessage: error.message };
  }

  return { user, errorMessage: null };
}
