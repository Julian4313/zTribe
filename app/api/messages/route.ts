
import { NextResponse } from "next/server";
import {
  createServiceRoleSupabaseClient,
  createUserSupabaseClient,
} from "../../lib/supabase-server";

type CreateMessageBody = {
  channel?: unknown;
  content?: unknown;
};

const DEFAULT_DISPLAY_NAME = "新用户";
const MESSAGE_SELECT =
  "id, channel, username, content, created_at, user_id";

function getBearerToken(authorizationHeader: string | null) {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

export async function POST(request: Request) {
  const accessToken = getBearerToken(request.headers.get("authorization"));
  if (!accessToken) {
    return NextResponse.json(
      { error: "缺少登录凭证，请先登录。" },
      { status: 401 },
    );
  }

  let body: CreateMessageBody;
  try {
    body = (await request.json()) as CreateMessageBody;
  } catch {
    return NextResponse.json(
      { error: "请求体必须是 JSON。" },
      { status: 400 },
    );
  }

  const channel =
    typeof body.channel === "string" ? body.channel.trim() : "";
  const content =
    typeof body.content === "string" ? body.content.trim() : "";

  if (!channel) {
    return NextResponse.json(
      { error: "channel 不能为空。" },
      { status: 400 },
    );
  }

  if (!content) {
    return NextResponse.json(
      { error: "消息内容不能为空。" },
      { status: 400 },
    );
  }

  const userClient = createUserSupabaseClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser(accessToken);

  if (authError || !user) {
    return NextResponse.json(
      { error: "登录已失效，请重新登录。" },
      { status: 401 },
    );
  }

  const { data: profile, error: profileError } = await userClient
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json(
      { error: `读取昵称失败：${profileError.message}` },
      { status: 500 },
    );
  }

  const username =
    profile?.display_name?.trim() ||
    user.email ||
    DEFAULT_DISPLAY_NAME;

  const writer = createServiceRoleSupabaseClient() ?? userClient;

  const { data, error: insertError } = await writer
    .from("messages")
    .insert({
      channel,
      content,
      username,
      user_id: user.id,
    })
    .select(MESSAGE_SELECT)
    .single();

  if (insertError) {
    return NextResponse.json(
      { error: `发送失败：${insertError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ message: data }, { status: 201 });
}
