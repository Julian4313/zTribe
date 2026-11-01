import { NextResponse } from "next/server";

export function requireIndexerKey(request: Request):
  | { ok: true }
  | { ok: false; response: NextResponse } {
  const configured = process.env.INDEXER_API_KEY?.trim();
  if (!configured) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "服务端未配置 INDEXER_API_KEY。" },
        { status: 503 },
      ),
    };
  }

  const header = request.headers.get("x-indexer-key")?.trim();
  const authorization = request.headers.get("authorization");
  const bearer =
    authorization?.toLowerCase().startsWith("bearer ")
      ? authorization.slice(7).trim()
      : null;

  const provided = header || bearer;
  if (!provided || provided !== configured) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Indexer 密钥无效。" }, { status: 401 }),
    };
  }

  return { ok: true };
}
