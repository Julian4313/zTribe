
"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";

type Message = {
  id: number;
  name: string;
  time: string;
  text: string;
};

type MessageRow = {
  id: number;
  channel: string;
  username: string;
  content: string;
  created_at: string;
  user_id: string | null;
};

const MESSAGE_SELECT =
  "id, channel, username, content, created_at, user_id";

const channels = ["general", "development", "random"];
const DEFAULT_DISPLAY_NAME = "新用户";

function getFallbackDisplayName(user: User) {
  return user.email || DEFAULT_DISPLAY_NAME;
}

function formatMessageTime(createdAt: string) {
  const date = new Date(createdAt);
  const time = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const isToday = date.toDateString() === new Date().toDateString();

  if (isToday) {
    return `Today at ${time}`;
  }

  return `${date.toLocaleDateString()} ${time}`;
}

function mapRowToMessage(
  row: MessageRow,
  displayNameByUserId: Record<string, string> = {},
): Message {
  const profileName =
    row.user_id && displayNameByUserId[row.user_id]
      ? displayNameByUserId[row.user_id]
      : null;

  return {
    id: row.id,
    name: profileName || row.username,
    time: formatMessageTime(row.created_at),
    text: row.content,
  };
}

async function fetchDisplayNamesByUserIds(
  userIds: string[],
): Promise<Record<string, string>> {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return {};
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", uniqueIds);

  if (error || !data) {
    return {};
  }

  return Object.fromEntries(
    data.map((profile) => [profile.id, profile.display_name]),
  );
}

async function fetchProfileDisplayName(userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data?.display_name?.trim()) {
    return null;
  }

  return data.display_name.trim();
}

function normalizeMessageRow(value: unknown): MessageRow | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const row = value as Record<string, unknown>;
  const id =
    typeof row.id === "number"
      ? row.id
      : typeof row.id === "string"
        ? Number(row.id)
        : NaN;

  const userId =
    row.user_id === null || row.user_id === undefined
      ? null
      : typeof row.user_id === "string"
        ? row.user_id
        : null;

  if (
    !Number.isFinite(id) ||
    typeof row.channel !== "string" ||
    typeof row.username !== "string" ||
    typeof row.content !== "string" ||
    typeof row.created_at !== "string" ||
    (row.user_id !== null &&
      row.user_id !== undefined &&
      typeof row.user_id !== "string")
  ) {
    return null;
  }

  return {
    id,
    channel: row.channel,
    username: row.username,
    content: row.content,
    created_at: row.created_at,
    user_id: userId,
  };
}

function appendMessageIfNew(
  previous: Message[],
  row: MessageRow,
  displayNameByUserId: Record<string, string> = {},
): Message[] {
  if (previous.some((message) => message.id === row.id)) {
    return previous;
  }

  return [...previous, mapRowToMessage(row, displayNameByUserId)];
}

export default function Home() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [activeChannel, setActiveChannel] = useState("general");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileDisplayName, setProfileDisplayName] = useState<string | null>(
    null,
  );
  const activeChannelRef = useRef(activeChannel);
  const profileNamesRef = useRef<Record<string, string>>({});

  useEffect(() => {
    activeChannelRef.current = activeChannel;
  }, [activeChannel]);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      const { data, error: sessionError } = await supabase.auth.getSession();

      if (cancelled) {
        return;
      }

      if (sessionError) {
        setError(`读取登录状态失败：${sessionError.message}`);
        setUser(null);
        setAuthReady(true);
        return;
      }

      setUser(data.session?.user ?? null);
      setAuthReady(true);
    }

    void restoreSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthReady(true);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authReady) {
      return;
    }

    if (!user) {
      router.replace("/login");
    }
  }, [authReady, user, router]);

  useEffect(() => {
    if (!user) {
      setProfileDisplayName(null);
      return;
    }

    let cancelled = false;

    async function loadProfile(currentUser: User) {
      const name = await fetchProfileDisplayName(currentUser.id);

      if (cancelled) {
        return;
      }

      const resolved = name ?? getFallbackDisplayName(currentUser);
      setProfileDisplayName(resolved);
      profileNamesRef.current = {
        ...profileNamesRef.current,
        [currentUser.id]: resolved,
      };
    }

    void loadProfile(user);

    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    let cancelled = false;

    async function loadMessages() {
      setIsLoading(true);
      setError(null);

      const { data, error: loadError } = await supabase
        .from("messages")
        .select(MESSAGE_SELECT)
        .eq("channel", activeChannel)
        .order("created_at", { ascending: true });

      if (cancelled) {
        return;
      }

      if (loadError) {
        setMessages([]);
        setError(`加载消息失败：${loadError.message}`);
        setIsLoading(false);
        return;
      }

      const rows = (data ?? [])
        .map((row) => normalizeMessageRow(row))
        .filter((row): row is MessageRow => row !== null);

      const displayNameByUserId = await fetchDisplayNamesByUserIds(
        rows
          .map((row) => row.user_id)
          .filter((id): id is string => typeof id === "string"),
      );

      if (cancelled) {
        return;
      }

      profileNamesRef.current = {
        ...profileNamesRef.current,
        ...displayNameByUserId,
      };

      setMessages(rows.map((row) => mapRowToMessage(row, displayNameByUserId)));
      setIsLoading(false);
    }

    void loadMessages();

    return () => {
      cancelled = true;
    };
  }, [activeChannel, user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const subscription = supabase
      .channel(`messages:${activeChannel}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `channel=eq.${activeChannel}`,
        },
        (payload) => {
          const row = normalizeMessageRow(payload.new);
          if (!row || row.channel !== activeChannelRef.current) {
            return;
          }

          void (async () => {
            if (
              row.user_id &&
              !profileNamesRef.current[row.user_id]
            ) {
              const name = await fetchProfileDisplayName(row.user_id);
              if (name) {
                profileNamesRef.current[row.user_id] = name;
              }
            }

            setMessages((previous) =>
              appendMessageIfNew(previous, row, profileNamesRef.current),
            );
          })();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(subscription);
    };
  }, [activeChannel, user]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const text = input.trim();
    if (!text || isSending) {
      return;
    }

    const channel = activeChannel;
    setIsSending(true);
    setError(null);

    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.access_token || !session.user) {
      setIsSending(false);
      setError("请先登录后再发送消息。");
      setUser(null);
      router.replace("/login");
      return;
    }

    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          channel,
          content: text,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { message?: unknown; error?: string }
        | null;

      if (!response.ok) {
        setIsSending(false);

        if (response.status === 401) {
          setError(payload?.error ?? "请先登录后再发送消息。");
          setUser(null);
          router.replace("/login");
          return;
        }

        setError(payload?.error ?? `发送失败（${response.status}）`);
        return;
      }

      const row = normalizeMessageRow(payload?.message);
      setIsSending(false);
      setInput("");

      if (!row || channel !== activeChannelRef.current) {
        return;
      }

      if (row.user_id) {
        profileNamesRef.current[row.user_id] = row.username;
        if (row.user_id === session.user.id) {
          setProfileDisplayName(row.username);
        }
      }

      setMessages((previous) =>
        appendMessageIfNew(previous, row, profileNamesRef.current),
      );
    } catch (err) {
      setIsSending(false);
      setError(
        err instanceof Error
          ? `发送失败：${err.message}`
          : "发送失败：网络错误",
      );
    }
  }

  async function handleSignOut() {
    if (isSigningOut) {
      return;
    }

    setIsSigningOut(true);
    setError(null);

    const { error: signOutError } = await supabase.auth.signOut();

    if (signOutError) {
      setError(`退出登录失败：${signOutError.message}`);
      setIsSigningOut(false);
      return;
    }

    setUser(null);
    router.replace("/login");
  }

  if (!authReady || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#313338] text-white">
        <p className="text-gray-400">
          {!authReady ? "正在检查登录状态..." : "正在跳转到登录页..."}
        </p>
      </main>
    );
  }

  const displayName =
    profileDisplayName ?? getFallbackDisplayName(user);
  const avatarLetter = displayName[0]?.toUpperCase() ?? "?";

  return (
    <main className="flex h-screen overflow-hidden bg-[#313338] text-white">
      <aside className="flex w-[72px] shrink-0 flex-col items-center gap-3 bg-[#1e1f22] py-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500 text-xl font-bold">
          C
        </div>

        <div className="h-px w-8 bg-[#3f4147]" />

        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#36383f] text-lg">
          DEV
        </div>

        <button
          type="button"
          aria-label="Add server"
          className="h-12 w-12 rounded-2xl bg-[#36383f] text-2xl text-green-400"
        >
          +
        </button>
      </aside>

      <aside className="flex w-60 shrink-0 flex-col bg-[#2b2d31]">
        <header className="border-b border-[#1f2024] p-4 font-bold">
          My Community
        </header>

        <div className="p-3">
          <p className="mb-2 px-2 text-xs font-bold uppercase text-gray-400">
            Text Channels
          </p>

          {channels.map((channel) => (
            <button
              key={channel}
              type="button"
              onClick={() => setActiveChannel(channel)}
              className={`mb-1 flex w-full items-center gap-2 rounded px-2 py-2 text-left ${
                activeChannel === channel
                  ? "bg-[#404249] text-white"
                  : "text-gray-400 hover:bg-[#35373c] hover:text-white"
              }`}
            >
              <span className="text-xl">#</span>
              {channel}
            </button>
          ))}
        </div>

        <div className="mt-auto space-y-2 bg-[#232428] p-3">
          <Link
            href="/profile"
            className="flex items-center gap-2 rounded px-1 py-1 hover:bg-[#35373c]"
            title="编辑个人资料"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-sm font-bold">
              {avatarLetter}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium" title={displayName}>
                {displayName}
              </div>
              <div
                className="truncate text-xs text-gray-400"
                title={user.email ?? undefined}
              >
                {user.email ?? "Online"}
              </div>
            </div>
            <span className="shrink-0 text-xs text-indigo-300">编辑</span>
          </Link>

          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={isSigningOut}
            className="w-full rounded bg-[#404249] px-3 py-1.5 text-sm hover:bg-[#35373c] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSigningOut ? "退出中..." : "退出登录"}
          </button>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center border-b border-[#26272d] px-5 font-semibold">
          <span className="mr-2 text-xl text-gray-400">#</span>
          {activeChannel}
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {error && (
            <p className="rounded bg-[#3f2121] px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          {isLoading && (
            <p className="pt-8 text-center text-gray-400">
              正在加载 #{activeChannel} 的消息...
            </p>
          )}

          {!isLoading &&
            messages.map((message) => (
              <article key={message.id} className="flex gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-500 font-bold">
                  {message.name[0]?.toUpperCase() ?? "?"}
                </div>

                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-baseline gap-2">
                    <span className="font-semibold">{message.name}</span>
                    <span className="text-xs text-gray-400">
                      {message.time}
                    </span>
                  </div>

                  <p className="break-words text-gray-200">
                    {message.text}
                  </p>
                </div>
              </article>
            ))}

          {!isLoading && messages.length === 0 && !error && (
            <p className="pt-8 text-center text-gray-400">
              这里还没有消息，发送第一条消息吧！
            </p>
          )}
        </div>

        <form onSubmit={sendMessage} className="px-5 pb-6">
          <div className="flex items-center gap-3 rounded-lg bg-[#383a40] px-4">
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={`Message #${activeChannel}`}
              aria-label={`Message #${activeChannel}`}
              disabled={isSending}
              className="min-w-0 flex-1 bg-transparent py-4 text-white outline-none placeholder:text-gray-400 disabled:opacity-60"
            />

            <button
              type="submit"
              disabled={isSending || input.trim().length === 0}
              className="rounded bg-indigo-500 px-4 py-2 font-medium hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSending ? "Sending..." : "Send"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
