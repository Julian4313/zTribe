import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "../../lib/supabase-server";
import { requireWallet } from "../../lib/request-user";

const MAX_NICKNAME_LENGTH = 40;

type ProfileBody = {
  nickname?: unknown;
  initializeOnly?: unknown;
};

export async function GET(request: Request) {
  const auth = await requireWallet(request);
  if (!auth.ok) return auth.response;
  const writer = createServiceRoleSupabaseClient();
  if (!writer) return NextResponse.json({ error: "服务端未配置 SUPABASE_SECRET_KEY。" }, { status: 500 });
  const { data, error } = await writer.schema("app").from("profiles").select("nickname, avatar_url, bio, socials, updated_at").eq("address", auth.address).maybeSingle();
  if (error) return NextResponse.json({ error: `读取资料失败：${error.message}` }, { status: 500 });
  return NextResponse.json({ profile: data }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: Request) {
  const auth = await requireWallet(request);
  if (!auth.ok) {
    return auth.response;
  }

  let body: ProfileBody;
  try {
    body = (await request.json()) as ProfileBody;
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON。" }, { status: 400 });
  }

  const nickname =
    typeof body.nickname === "string" ? body.nickname.trim() : "";

  if (!nickname) {
    return NextResponse.json({ error: "显示名称不能为空。" }, { status: 400 });
  }

  if (nickname.length > MAX_NICKNAME_LENGTH) {
    return NextResponse.json(
      { error: `显示名称最多 ${MAX_NICKNAME_LENGTH} 个字符。` },
      { status: 400 },
    );
  }

  const writer = createServiceRoleSupabaseClient();
  if (!writer) {
    return NextResponse.json(
      { error: "服务端未配置 SUPABASE_SECRET_KEY。" },
      { status: 500 },
    );
  }

  if (body.initializeOnly === true) {
    // First-time setup must never overwrite a nickname created by another tab.
    const { data: inserted, error: insertError } = await writer
      .schema("app")
      .from("profiles")
      .insert({ address: auth.address, nickname })
      .select("nickname, updated_at")
      .maybeSingle();

    if (!insertError && inserted) {
      return NextResponse.json({ profile: inserted, created: true }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
    }

    // A concurrent request may have created the profile first. In that case,
    // return the existing nickname rather than replacing it.
    if (insertError?.code === "23505") {
      const { data: existing, error: readError } = await writer
        .schema("app")
        .from("profiles")
        .select("nickname, updated_at")
        .eq("address", auth.address)
        .single();
      if (!readError && existing) {
        const existingNickname = typeof existing.nickname === "string"
          ? existing.nickname.trim()
          : "";
        if (existingNickname) {
          return NextResponse.json({ profile: existing, created: false }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
        }

        // Legacy rows may exist with a NULL/blank nickname. Fill only while
        // still blank; never replace a nickname another request has chosen.
        const { data: initialized, error: initializeError } = await writer
          .schema("app")
          .from("profiles")
          .update({ nickname, updated_at: new Date().toISOString() })
          .eq("address", auth.address)
          .or("nickname.is.null,nickname.eq.")
          .select("nickname, updated_at")
          .maybeSingle();
        if (initializeError) {
          return NextResponse.json(
            { error: `初始化资料失败：${initializeError.message}` },
            { status: 500 },
          );
        }
        if (initialized) {
          return NextResponse.json({ profile: initialized, created: false }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
        }

        const { data: latest, error: latestError } = await writer
          .schema("app")
          .from("profiles")
          .select("nickname, updated_at")
          .eq("address", auth.address)
          .single();
        if (!latestError && latest) {
          return NextResponse.json({ profile: latest, created: false }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
        }
      }
    }

    return NextResponse.json(
      { error: `初始化资料失败：${insertError?.message ?? "无法读取已存在资料。"}` },
      { status: 500 },
    );
  }

  const { data, error } = await writer
    .schema("app")
    .from("profiles")
    .upsert(
      {
        address: auth.address,
        nickname,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "address" },
    )
    .select("nickname, updated_at")
    .single();

  if (error) {
    return NextResponse.json(
      { error: `保存失败：${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ profile: data, created: false }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
