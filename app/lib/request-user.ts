import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createUserSupabaseClient } from "./supabase-server";
import { getEthereumAddressFromUser } from "./user-display";

export function getBearerToken(authorizationHeader: string | null) {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

export async function requireWallet(request: Request): Promise<
  | { ok: true; accessToken: string; user: User; address: string }
  | { ok: false; response: NextResponse }
> {
  const accessToken = getBearerToken(request.headers.get("authorization"));
  if (!accessToken) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "缺少登录凭证，请先登录。" },
        { status: 401 },
      ),
    };
  }

  const userClient = createUserSupabaseClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser(accessToken);

  if (authError || !user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "登录已失效，请重新登录。" },
        { status: 401 },
      ),
    };
  }

  const address = getEthereumAddressFromUser(user)?.toLowerCase() ?? null;
  if (!address) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "当前会话没有钱包地址。" },
        { status: 401 },
      ),
    };
  }

  return { ok: true, accessToken, user, address };
}
