"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ChangeEvent,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "./lib/supabase";
import { useAuthUser } from "./lib/use-auth-user";
import {
  getEthereumAddressFromUser,
  getFallbackDisplayName,
  shortenEthereumAddress,
} from "./lib/user-display";
import {
  WORLD_ANNOUNCEMENTS,
  WORLD_CORE,
  WORLD_GENERAL,
  isTribeRoom,
  normalizeRoomId,
  roomTitle,
} from "./lib/rooms";

type Message = {
  id: string;
  name: string;
  time: string;
  text: string;
  system: boolean;
  kind?: string;
  mediaUrl?: string | null;
  deliveryStatus?: "sending" | "failed";
  canRetry?: boolean;
  isMine?: boolean;
};

type MessageRow = {
  id: string;
  seq: number;
  room_id: string;
  author_name: string;
  is_mine: boolean;
  kind: string;
  content: string;
  media_url: string | null;
  created_at: string;
};


const EMOJI_OPTIONS = [
  "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😍",
  "🥰", "😘", "😎", "🤔", "🙌", "👏", "👍", "👎", "❤️", "🔥",
  "🎉", "🚀", "💯", "🙏", "👀", "💪", "😭", "😢", "🤝", "✨",
];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const PAGE_SIZE = 50;

// Keep recently opened rooms in memory so a component remount does not
// blank the conversation while the latest messages are fetched.
const roomMessagesCache = new Map<
  string,
  { messages: Message[]; oldestSeq: number | null; hasEarlier: boolean; cachedAt: number; latestSeq: number }
>();

const sidebarRooms = [
  WORLD_ANNOUNCEMENTS,
  WORLD_GENERAL,
  WORLD_CORE,
];

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

function normalizeMessageRow(value: unknown): MessageRow | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const row = value as Record<string, unknown>;
  const seq =
    typeof row.seq === "number"
      ? row.seq
      : typeof row.seq === "string"
        ? Number(row.seq)
        : NaN;

  if (
    typeof row.id !== "string" ||
    !Number.isFinite(seq) ||
    typeof row.room_id !== "string" ||
    typeof row.kind !== "string" ||
    typeof row.content !== "string" ||
    (row.media_url !== null && row.media_url !== undefined && typeof row.media_url !== "string") ||
    typeof row.created_at !== "string"
  ) {
    return null;
  }

  if (typeof row.author_name !== "string" || typeof row.is_mine !== "boolean") return null;
  return {
    id: row.id,
    seq,
    room_id: row.room_id,
    author_name: row.author_name,
    is_mine: row.is_mine,
    kind: row.kind,
    content: row.content,
    media_url: typeof row.media_url === "string" ? row.media_url : null,
    created_at: row.created_at,
  };
}

function mapRowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    name: row.author_name || "用户",
    time: formatMessageTime(row.created_at),
    text: row.content,
    system: row.kind === "system",
    kind: row.kind,
    mediaUrl: row.media_url,
    isMine: row.is_mine,
  };
}


export default function Home() {
  const router = useRouter();
  const { user, authReady } = useAuthUser();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const searchParams = useSearchParams();
  const activeRoom =
    normalizeRoomId(searchParams.get("room")) ?? WORLD_GENERAL;
  const [roomDraft, setRoomDraft] = useState("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesRoomRef = useRef(activeRoom);
  const lastSeqRef = useRef(0);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const shouldScrollToBottomRef = useRef(false);
  const scrollAtBottomRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [newMessagesCount, setNewMessagesCount] = useState(0);
  const [isLoadingEarlier, setIsLoadingEarlier] = useState(false);
  const loadEarlierLockRef = useRef(false);
  const pendingScrollAdjustmentRef = useRef<{ roomId: string; height: number; top: number } | null>(null);
  const retryPayloadsRef = useRef(new Map<string, { args: { roomId: string; content: string; kind: "text" | "image" | "voice"; file?: File }; previewUrl: string | null }>());
  // Serialize POST requests per room so rapid consecutive sends receive server seq
  // values in the same order the user submitted them.
  const sendQueuesRef = useRef(new Map<string, Promise<void>>());
  const [isEmojiOpen, setIsEmojiOpen] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const voiceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const discardVoiceOnStopRef = useRef(false);
  const [oldestSeq, setOldestSeq] = useState<number | null>(null);
  const [hasEarlier, setHasEarlier] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [canCompose, setCanCompose] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedNickname, setSavedNickname] = useState<{
    address: string;
    name: string;
  } | null>(null);
  const activeRoomRef = useRef(activeRoom);
  activeRoomRef.current = activeRoom;

  // Save updates only for the room currently represented by `messages`.
  // The room check prevents the previous room's messages being cached under
  // the newly selected room during a room switch.
  useEffect(() => {
    if (messagesRoomRef.current !== activeRoom || isLoading) return;
    // Keep the cache bounded so browsing many rooms cannot grow memory forever.
    roomMessagesCache.delete(activeRoom);
    roomMessagesCache.set(activeRoom, { messages, oldestSeq, hasEarlier, cachedAt: Date.now(), latestSeq: lastSeqRef.current });
    if (roomMessagesCache.size > 10) {
      const oldestRoom = roomMessagesCache.keys().next().value;
      if (oldestRoom) roomMessagesCache.delete(oldestRoom);
    }
  }, [activeRoom, messages, oldestSeq, hasEarlier, isLoading]);

  useLayoutEffect(() => {
    const adjustment = pendingScrollAdjustmentRef.current;
    if (!adjustment || adjustment.roomId !== activeRoom) return;
    const container = messagesContainerRef.current;
    if (!container) return;
    container.scrollTop = adjustment.top + (container.scrollHeight - adjustment.height);
    pendingScrollAdjustmentRef.current = null;
  }, [messages, activeRoom]);

  useEffect(() => {
    if (!shouldScrollToBottomRef.current) return;
    shouldScrollToBottomRef.current = false;
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: "auto" });
      scrollAtBottomRef.current = true;
      setIsAtBottom(true);
      setNewMessagesCount(0);
    }
  }, [messages, activeRoom]);
  const walletAddress = user
    ? getEthereumAddressFromUser(user)?.toLowerCase() ?? null
    : null;
  const profileDisplayName =
    walletAddress && savedNickname?.address === walletAddress
      ? savedNickname.name
      : null;

  // A profile save returns the server-confirmed nickname in the URL once.
  // Seed local chat state immediately, then clean the transient query value.
  useEffect(() => {
    const nickname = searchParams.get("nickname")?.trim();
    if (!walletAddress || !nickname) return;
    setSavedNickname({ address: walletAddress, name: nickname.slice(0, 40) });
    const roomQuery = searchParams.get("room");
    router.replace(roomQuery ? `/?room=${encodeURIComponent(roomQuery)}` : "/");
  }, [walletAddress, searchParams, router]);

  useEffect(() => {
    activeRoomRef.current = activeRoom;
  }, [activeRoom]);

  useEffect(() => {
    if (!authReady) {
      return;
    }

    if (!user) {
      router.replace("/login");
    }
  }, [authReady, user, router]);

  useEffect(() => {
    if (!walletAddress) {
      return;
    }

    let cancelled = false;

    async function loadProfile() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const profileResponse = await fetch("/api/profile", { headers: { Authorization: `Bearer ${session.access_token}` } });
      const profilePayload = await profileResponse.json().catch(() => null) as { profile?: { nickname?: string | null } | null } | null;
      if (cancelled) return;
      let nickname = typeof profilePayload?.profile?.nickname === "string" ? profilePayload.profile.nickname.trim() : "";
      if (!nickname) {
        const defaultNickname = `User_${user?.id.slice(-6).toUpperCase() ?? "NEW"}`;
        const response = await fetch("/api/profile", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ nickname: defaultNickname, initializeOnly: true }),
        });
        const payload = await response.json().catch(() => null) as
          | { profile?: { nickname?: string | null } }
          | null;
        if (!response.ok) {
          if (!cancelled) setError("默认昵称创建失败：请刷新页面重试。");
          return;
        }
        nickname = typeof payload?.profile?.nickname === "string"
          ? payload.profile.nickname
          : defaultNickname;
      }
      if (cancelled || !nickname) return;
      setSavedNickname({ address: walletAddress!, name: nickname });
    }

    void loadProfile();

    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  useEffect(() => {
    if (!user) {
      return;
    }

    let cancelled = false;

    async function loadRoom() {
      const cachedEntry = roomMessagesCache.get(activeRoom);
      const cachedRoom = cachedEntry && Date.now() - cachedEntry.cachedAt < 45 * 60 * 1000 ? cachedEntry : undefined;
      if (!cachedRoom) roomMessagesCache.delete(activeRoom);
      lastSeqRef.current = cachedRoom?.latestSeq ?? 0;
      // Never carry the previous room's write permission into a new room.
      setCanCompose(false);
      messagesRoomRef.current = activeRoom;
      setMessages(cachedRoom?.messages ?? []);
      setOldestSeq(cachedRoom?.oldestSeq ?? null);
      setHasEarlier(cachedRoom?.hasEarlier ?? false);
      // Only show the full loading placeholder when this room has no cache.
      setIsLoading(!cachedRoom);
      setIsLoadingEarlier(false);
      setError(null);
      setNewMessagesCount(0);
      setIsAtBottom(true);
      scrollAtBottomRef.current = true;
      shouldScrollToBottomRef.current = true;
      pendingScrollAdjustmentRef.current = null;

      if (activeRoom === WORLD_CORE) {
        setCanCompose(false);
        setError("Core 房间本期不开放。");
        setIsLoading(false);
        return;
      }

      if (isTribeRoom(activeRoom)) {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.access_token) {
          setCanCompose(false);
          setError("请先登录后再进入部落。");
          setIsLoading(false);
          return;
        }

        const response = await fetch("/api/rooms/access", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ roomId: activeRoom }),
        });
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;

        if (cancelled) {
          return;
        }

        if (!response.ok) {
          setCanCompose(false);
          setError(payload?.error ?? "还不能进入这个部落。");
          setIsLoading(false);
          return;
        }
      }

      setCanCompose(true);

      const { data: { session: messageSession } } = await supabase.auth.getSession();
      if (!messageSession?.access_token) { setIsLoading(false); setError("登录状态已失效，请重新登录。"); return; }
      const historyResponse = await fetch(`/api/messages?roomId=${encodeURIComponent(activeRoom)}&limit=${PAGE_SIZE + 1}`, { headers: { Authorization: `Bearer ${messageSession.access_token}` }, cache: "no-store" });
      const historyPayload = await historyResponse.json().catch(() => null) as { messages?: unknown[]; error?: string } | null;
      if (cancelled) return;
      if (!historyResponse.ok) { setCanCompose(false); setError(historyPayload?.error ?? "加载消息失败。"); setIsLoading(false); return; }
      const fetchedRows = (historyPayload?.messages ?? [])
        .map((row) => normalizeMessageRow(row))
        .filter((row): row is MessageRow => row !== null);
      const hasMoreEarlier = fetchedRows.length > PAGE_SIZE;
      const rows = fetchedRows.slice(0, PAGE_SIZE).reverse();

      if (cancelled) return;
      shouldScrollToBottomRef.current = true;
      setMessages(rows.map((row) => mapRowToMessage(row)));
      setOldestSeq(rows[0]?.seq ?? null);
      lastSeqRef.current = rows[rows.length - 1]?.seq ?? 0;
      setHasEarlier(hasMoreEarlier);
      setIsLoading(false);
    }

    void loadRoom();

    return () => {
      cancelled = true;
    };
  }, [activeRoom, user]);

  // Poll the authenticated, sanitized message API. Raw messages are deliberately
  // not subscribed through Postgres Changes because that payload includes private columns.
  useEffect(() => {
    if (!user || activeRoom === WORLD_CORE) return;
    let cancelled = false;
    let inFlight = false;
    let pollAgain = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const isPageVisible = () => document.visibilityState === "visible";

    const poll = async () => {
      if (cancelled || !isPageVisible()) return;
      if (inFlight) { pollAgain = true; return; }
      inFlight = true;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token || cancelled) return;
        const response = await fetch(`/api/messages?roomId=${encodeURIComponent(activeRoom)}&limit=50&afterSeq=${lastSeqRef.current}`, { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" });
        const payload = await response.json().catch(() => null) as { messages?: unknown[] } | null;
        if (!response.ok || cancelled) return;
        const rows = (payload?.messages ?? []).map(normalizeMessageRow).filter((row): row is MessageRow => row !== null);
        // afterSeq is authoritative; avoid rebuilding an O(n) ID Set over the full
        // conversation on every poll. Sequence numbers are unique within a room.
        const knownIds = new Set<string>();
        const additions = rows.filter((row) => {
          if (row.seq <= lastSeqRef.current || knownIds.has(row.id)) return false;
          knownIds.add(row.id);
          return true;
        });
        if (!additions.length) return;
        const shouldFollow = scrollAtBottomRef.current;
        if (shouldFollow) shouldScrollToBottomRef.current = true;
        else setNewMessagesCount((count) => count + additions.length);
        setMessages((previous) => {
          const next = [...previous];
          for (const row of additions) {
            const confirmed = mapRowToMessage(row);
            // Reconcile an own pending message when Realtime/poll wins the race
            // against the POST response. Match the oldest pending equal payload;
            // POSTs are serialized per room, so repeated text remains ordered.
            const pendingIndex = row.is_mine
              ? next.findIndex((message) =>
                  message.deliveryStatus === "sending" &&
                  message.text === row.content &&
                  (message.kind ?? "text") === row.kind
                )
              : -1;
            if (pendingIndex >= 0) {
              next[pendingIndex] = confirmed;
            } else if (!next.some((message) => message.id === row.id)) {
              next.push(confirmed);
            }
          }
          return next;
        });
        lastSeqRef.current = additions.reduce((latest, row) => Math.max(latest, row.seq), lastSeqRef.current);
      } finally {
        inFlight = false;
        if (pollAgain && !cancelled && isPageVisible()) {
          pollAgain = false;
          schedulePoll(250);
        }
      }
    };

    const schedulePoll = (delay = 250) => {
      if (cancelled) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { debounceTimer = null; void poll(); }, delay);
    };

    const subscription = supabase
      .channel(`safe-message-events:${activeRoom}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "app",
        table: "message_events",
        filter: `room_id=eq.${activeRoom}`,
      }, () => { schedulePoll(250); })
      .subscribe();

    // Realtime handles the fast path. The 15s foreground poll is only a recovery
    // fallback; do not poll hidden tabs. Returning to the tab triggers one catch-up.
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") schedulePoll(0);
    }, 15000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") schedulePoll(0);
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      if (debounceTimer) clearTimeout(debounceTimer);
      void supabase.removeChannel(subscription);
    };
  }, [activeRoom, user]);

  function selectRoom(roomId: string) {
    router.replace(`/?room=${roomId}`);
  }

  function openTribeRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const roomId = normalizeRoomId(roomDraft);
    if (!roomId || !isTribeRoom(roomId)) {
      setError("请输入币合约地址。");
      return;
    }

    setRoomDraft("");
    selectRoom(roomId);
  }

  async function loadEarlier() {
    const roomAtStart = activeRoom;
    const cursorAtStart = oldestSeq;
    const container = messagesContainerRef.current;
    if (cursorAtStart === null || isLoading || loadEarlierLockRef.current || !hasEarlier) return;

    loadEarlierLockRef.current = true;
    setIsLoadingEarlier(true);
    const previousHeight = container?.scrollHeight ?? 0;
    const previousTop = container?.scrollTop ?? 0;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const response = await fetch(`/api/messages?roomId=${encodeURIComponent(roomAtStart)}&limit=${PAGE_SIZE + 1}&beforeSeq=${cursorAtStart}`, { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" });
      const payload = await response.json().catch(() => null) as { messages?: unknown[]; error?: string } | null;
      if (activeRoomRef.current !== roomAtStart) return;
      if (!response.ok) { setError(payload?.error ?? "加载历史消息失败。"); return; }
      const fetchedRows = (payload?.messages ?? [])
        .map((row) => normalizeMessageRow(row))
        .filter((row): row is MessageRow => row !== null);
      const hasMoreEarlier = fetchedRows.length > PAGE_SIZE;
      const rows = fetchedRows.slice(0, PAGE_SIZE).reverse();

      if (activeRoomRef.current !== roomAtStart) return;
      const earlierMessages = rows.map(mapRowToMessage);
      if (earlierMessages.length && container) {
        pendingScrollAdjustmentRef.current = {
          roomId: roomAtStart,
          height: previousHeight,
          top: previousTop,
        };
      }
      setMessages((previous) => {
        const ids = new Set(previous.map((message) => message.id));
        return [
          ...earlierMessages.filter((message) => !ids.has(message.id)),
          ...previous,
        ];
      });
      setOldestSeq(rows[0]?.seq ?? cursorAtStart);
      setHasEarlier(hasMoreEarlier);
    } catch (err) {
      if (activeRoomRef.current === roomAtStart) {
        setError(err instanceof Error ? `加载历史消息失败：${err.message}` : "加载历史消息失败，请重试。");
      }
    } finally {
      loadEarlierLockRef.current = false;
      if (activeRoomRef.current === roomAtStart) setIsLoadingEarlier(false);
    }
  }

  function handleMessagesScroll() {
    const container = messagesContainerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const atBottom = distanceFromBottom < 80;
    scrollAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
    if (atBottom) setNewMessagesCount(0);
    if (container.scrollTop < 80 && hasEarlier && !isLoading && !loadEarlierLockRef.current) {
      void loadEarlier();
    }
  }

  function scrollToLatest() {
    const container = messagesContainerRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    scrollAtBottomRef.current = true;
    setIsAtBottom(true);
    setNewMessagesCount(0);
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || !canCompose) return;
    setInput("");
    setIsEmojiOpen(false);
    await submitMessage({ roomId: activeRoom, content: text, kind: "text" });
  }

  async function submitMessage(
    args: { roomId: string; content: string; kind: "text" | "image" | "voice"; file?: File },
    existingOptimisticId?: string,
    existingPreviewUrl?: string | null,
  ) {
    const { roomId, content, kind, file } = args;
    const optimisticId = existingOptimisticId ?? `pending-${crypto.randomUUID()}`;
    const localImageUrl = existingOptimisticId ? existingPreviewUrl ?? null : file ? URL.createObjectURL(file) : null;
    retryPayloadsRef.current.set(optimisticId, { args, previewUrl: localImageUrl });
    shouldScrollToBottomRef.current = true;

    if (existingOptimisticId) {
      setMessages((previous) => previous.map((message) =>
        message.id === optimisticId ? { ...message, deliveryStatus: "sending", canRetry: false } : message,
      ));
    } else {
      setMessages((previous) => [
        ...previous,
        {
          id: optimisticId,
          name: profileDisplayName ?? "我",
          time: formatMessageTime(new Date().toISOString()),
          text: content,
          system: false,
          kind,
          mediaUrl: localImageUrl,
          deliveryStatus: "sending",
        },
      ]);
    }
    setError(null);

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session?.access_token) {
        setMessages((previous) => previous.filter((message) => message.id !== optimisticId));
        retryPayloadsRef.current.delete(optimisticId);
        setError("请先登录后再发送消息。");
        if (localImageUrl) URL.revokeObjectURL(localImageUrl);
        await supabase.auth.signOut();
        router.replace("/login");
        return;
      }

      // Keep the optimistic messages visible immediately, but serialize their
      // network writes per room. Concurrent POSTs can otherwise obtain seq values
      // in a different order from the user's 1, 2, 3 submission order.
      const previousSend = sendQueuesRef.current.get(roomId) ?? Promise.resolve();
      let releaseSend!: () => void;
      const thisSend = new Promise<void>((resolve) => { releaseSend = resolve; });
      const queuedSend = previousSend.catch(() => undefined).then(() => thisSend);
      sendQueuesRef.current.set(roomId, queuedSend);
      await previousSend.catch(() => undefined);

      let response: Response;
      try {
        if (file) {
          const formData = new FormData();
          formData.set("roomId", roomId);
          formData.set("content", content);
          formData.set("file", file);
          formData.set("mediaKind", kind);
          response = await fetch("/api/messages", {
            method: "POST",
            headers: { Authorization: `Bearer ${session.access_token}` },
            body: formData,
          });
        } else {
          response = await fetch("/api/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ roomId, content }),
          });
        }
      } finally {
        releaseSend();
        if (sendQueuesRef.current.get(roomId) === queuedSend) {
          sendQueuesRef.current.delete(roomId);
        }
      }

      const payload = (await response.json().catch(() => null)) as
        | { message?: unknown; error?: string }
        | null;

      if (!response.ok) {
        if (response.status === 401) {
          setMessages((previous) => previous.filter((message) => message.id !== optimisticId));
          retryPayloadsRef.current.delete(optimisticId);
          setError(payload?.error ?? "请先登录后再发送消息。");
          if (localImageUrl) URL.revokeObjectURL(localImageUrl);
          await supabase.auth.signOut();
          router.replace("/login");
          return;
        }

        // Permission/validation failures are definitive: remove the optimistic
        // message immediately instead of leaving a message that was never saved.
        if (response.status === 400 || response.status === 403 || response.status === 413 || response.status === 422) {
          setMessages((previous) => previous.filter((message) => message.id !== optimisticId));
          retryPayloadsRef.current.delete(optimisticId);
          if (localImageUrl) URL.revokeObjectURL(localImageUrl);
          setError(payload?.error ?? `发送失败（${response.status}）`);
          return;
        }

        setMessages((previous) => previous.map((message) =>
          message.id === optimisticId
            ? { ...message, deliveryStatus: "failed", canRetry: true }
            : message,
        ));
        setError(payload?.error ?? `发送失败（${response.status}）`);
        return;
      }

      const row = normalizeMessageRow(payload?.message);
      if (!row) {
        setMessages((previous) => previous.map((message) =>
          message.id === optimisticId
            ? { ...message, deliveryStatus: "failed", canRetry: true }
            : message,
        ));
        setError("服务器已响应，但返回的消息数据无法识别。请刷新房间确认是否发送成功。");
        return;
      }

      retryPayloadsRef.current.delete(optimisticId);
      if (localImageUrl) URL.revokeObjectURL(localImageUrl);
      if (roomId !== activeRoomRef.current) return;
      lastSeqRef.current = Math.max(lastSeqRef.current, row.seq);
      const confirmedMessage = mapRowToMessage(row);
      setMessages((previous) => {
        // Replace the optimistic placeholder in-place. Appending the confirmed
        // message to the end caused visible jumps (e.g. 1,2,3 -> 2,3,1).
        const optimisticIndex = previous.findIndex((message) => message.id === optimisticId);
        const existingIndex = previous.findIndex((message) => message.id === row.id);
        if (optimisticIndex >= 0) {
          const next = [...previous];
          next[optimisticIndex] = confirmedMessage;
          // If the poll already inserted this same server row, remove that copy
          // while retaining the optimistic slot and therefore the visible order.
          return next.filter((message, index) => message.id !== row.id || index === optimisticIndex);
        }
        if (existingIndex >= 0) return previous;
        return [...previous, confirmedMessage];
      });
    } catch (err) {
      setMessages((previous) => previous.map((message) =>
        message.id === optimisticId
          ? { ...message, deliveryStatus: "failed", canRetry: true }
          : message,
      ));
      setError(err instanceof Error ? `发送失败：${err.message}` : "发送失败：网络错误");
    }
  }

  async function retryMessage(messageId: string) {
    const retry = retryPayloadsRef.current.get(messageId);
    if (!retry || !canCompose) return;
    setError(null);
    await submitMessage(retry.args, messageId, retry.previewUrl);
  }

  async function handleImageSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !canCompose) return;

    const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      setError("图片格式仅支持 JPG、PNG、GIF、WebP。");
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      setError("图片不能超过 10 MB。");
      return;
    }

    await submitMessage({ roomId: activeRoom, content: "图片", kind: "image", file });
  }

  async function startVoiceRecording() {
    if (!canCompose || isRecordingVoice) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("当前浏览器不支持语音录制，请使用最新版 Chrome、Edge 或 Safari。");
      return;
    }

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
      const mimeType = candidates.find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      voiceChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) voiceChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setError("录音过程中出现问题，请重试。");
        setIsRecordingVoice(false);
        stream?.getTracks().forEach((track) => track.stop());
      };
      recorder.onstop = () => {
        const shouldDiscard = discardVoiceOnStopRef.current;
        discardVoiceOnStopRef.current = false;
        const recorderMimeType = (recorder.mimeType || "audio/webm").split(";")[0].trim();
        const blob = new Blob(voiceChunksRef.current, { type: recorderMimeType });
        stream?.getTracks().forEach((track) => track.stop());
        setIsRecordingVoice(false);
        mediaRecorderRef.current = null;
        if (shouldDiscard) {
          voiceChunksRef.current = [];
          return;
        }
        if (blob.size === 0) {
          setError("没有录到有效语音，请重试。");
          return;
        }
        if (blob.size > 10 * 1024 * 1024) {
          setError("语音文件超过 10 MB，请缩短录音后重试。");
          return;
        }
        const extension = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
        const file = new File([blob], `voice-${Date.now()}.${extension}`, { type: blob.type || "audio/webm" });
        void submitMessage({ roomId: activeRoomRef.current, content: "语音消息", kind: "voice", file });
      };
      recorder.start(250);
      setIsRecordingVoice(true);
      setError(null);
      voiceTimerRef.current = setTimeout(() => {
        if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
        setError("录音已达到 2 分钟上限，已自动结束并发送。");
      }, 2 * 60 * 1000);
    } catch (err) {
      stream?.getTracks().forEach((track) => track.stop());
      setError(err instanceof Error ? `无法开始录音：${err.message}` : "无法访问麦克风，请检查浏览器权限。");
    }
  }

  function stopVoiceRecording() {
    discardVoiceOnStopRef.current = false;
    if (voiceTimerRef.current) {
      clearTimeout(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
  }

  useEffect(() => () => {
    if (voiceTimerRef.current) clearTimeout(voiceTimerRef.current);
    // Unmounting is cancellation, never an implicit send action.
    discardVoiceOnStopRef.current = true;
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
    mediaRecorderRef.current?.stream?.getTracks().forEach((track) => track.stop());
  }, []);

  function insertEmoji(emoji: string) {
    setInput((current) => `${current}${emoji}`);
    setIsEmojiOpen(false);
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

  const displayName = profileDisplayName ?? getFallbackDisplayName(user);
  const avatarLetter = displayName[0]?.toUpperCase() ?? "?";
  const title = roomTitle(activeRoom);
  const tribeRooms = isTribeRoom(activeRoom) ? [activeRoom] : [];
  const visibleMessages = messagesRoomRef.current === activeRoom ? messages : [];

  return (
    <main className="flex h-screen overflow-hidden bg-[#313338] text-white">
      <aside className="flex w-[72px] shrink-0 flex-col items-center gap-3 bg-[#1e1f22] py-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500 text-xl font-bold">
          F
        </div>
      </aside>

      <aside className="flex w-60 shrink-0 flex-col bg-[#2b2d31]">
        <header className="border-b border-[#1f2024] p-4 font-bold">
          Freetribe
        </header>

        <div className="p-3">
          <p className="mb-2 px-2 text-xs font-bold uppercase text-gray-400">
            World
          </p>

          {sidebarRooms.map((roomId) => (
            <button
              key={roomId}
              type="button"
              onClick={() => selectRoom(roomId)}
              className={`mb-1 flex w-full items-center gap-2 rounded px-2 py-2 text-left ${
                activeRoom === roomId
                  ? "bg-[#404249] text-white"
                  : "text-gray-400 hover:bg-[#35373c] hover:text-white"
              }`}
            >
              <span className="text-xl">#</span>
              {roomTitle(roomId)}
            </button>
          ))}

          <p className="mb-2 mt-4 px-2 text-xs font-bold uppercase text-gray-400">
            Tribe
          </p>

          {tribeRooms.map((roomId) => (
            <button
              key={roomId}
              type="button"
              onClick={() => selectRoom(roomId)}
              className="mb-1 flex w-full items-center gap-2 rounded bg-[#404249] px-2 py-2 text-left text-white"
            >
              <span className="text-xl">#</span>
              {roomTitle(roomId)}
            </button>
          ))}

          <form onSubmit={openTribeRoom} className="mt-2 px-1">
            <input
              value={roomDraft}
              onChange={(event) => setRoomDraft(event.target.value)}
              placeholder="0x 币合约"
              aria-label="打开部落房间"
              className="w-full rounded bg-[#1e1f22] px-2 py-1.5 text-xs text-white outline-none ring-1 ring-[#1e1f22] focus:ring-indigo-500"
            />
          </form>
        </div>

        <div className="mt-auto space-y-2 bg-[#232428] p-3">
          <Link
            href={`/profile?nickname=${encodeURIComponent(profileDisplayName ?? displayName)}`}
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
                className="truncate text-xs font-mono text-gray-400"
                title={getEthereumAddressFromUser(user) ?? undefined}
              >
                {getEthereumAddressFromUser(user) ?? "已登录"}
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

      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center border-b border-[#26272d] px-5 font-semibold">
          <span className="mr-2 text-xl text-gray-400">#</span>
          {title}
        </header>

        <div
          ref={messagesContainerRef}
          onScroll={handleMessagesScroll}
          className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5"
        >
          {error && (
            <p className="rounded bg-[#3f2121] px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          {hasEarlier && (
            <button
              type="button"
              onClick={() => void loadEarlier()}
              disabled={isLoadingEarlier}
              className="mx-auto block text-sm text-indigo-300 hover:text-indigo-200 disabled:opacity-50"
            >
              {isLoadingEarlier ? "正在加载更早的消息…" : "↑ 加载更早的消息"}
            </button>
          )}

          {isLoading && (
            <p className="pt-8 text-center text-gray-400">
              正在加载 #{title} 的消息...
            </p>
          )}

          {!isLoading &&
            visibleMessages.map((message) =>
              message.system ? (
                <p key={message.id} className="text-center text-sm text-gray-400">
                  {message.text}
                </p>
              ) : (
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
                      {message.deliveryStatus === "sending" && (
                        <span className="text-xs text-gray-500">发送中…</span>
                      )}
                      {message.deliveryStatus === "failed" && (
                        <span className="inline-flex items-center gap-2 text-xs text-red-300">
                          发送失败
                          {message.canRetry && (
                            <button type="button" onClick={() => void retryMessage(message.id)} className="underline decoration-dotted hover:text-red-200">
                              重试
                            </button>
                          )}
                        </span>
                      )}
                    </div>

                    {message.kind === "image" && message.mediaUrl ? (
                      <div className="mt-2">
                        <img
                          src={message.mediaUrl}
                          alt="聊天图片"
                          loading="lazy"
                          decoding="async"
                          className="max-h-96 max-w-full rounded-lg border border-white/10 object-contain"
                        />
                      </div>
                    ) : message.kind === "voice" && message.mediaUrl ? (
                      <div className="mt-2 flex max-w-sm items-center gap-2 rounded-lg bg-[#2b2d31] p-3">
                        <span aria-hidden="true">🎙️</span>
                        <audio controls preload="metadata" src={message.mediaUrl} className="h-9 max-w-full" />
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap break-words text-gray-200">{message.text}</p>
                    )}
                  </div>
                </article>
              ),
            )}

          {!isLoading && visibleMessages.length === 0 && !error && (
            <p className="pt-8 text-center text-gray-400">
              这里还没有消息。
            </p>
          )}
        </div>

        {!isAtBottom && (
          <button
            type="button"
            onClick={scrollToLatest}
            className="absolute bottom-24 right-6 z-10 rounded-full border border-white/10 bg-[#5865f2] px-4 py-2 text-sm font-medium text-white shadow-lg transition hover:bg-[#4752c4]"
            aria-label="回到最新消息"
          >
            {newMessagesCount > 0 ? `${newMessagesCount} 条新消息 ↓` : "回到最新消息 ↓"}
          </button>
        )}

        <form onSubmit={sendMessage} className="px-5 pb-6">
          <div className="relative flex items-center gap-2 rounded-lg bg-[#383a40] px-3">
            <button
              type="button"
              onClick={() => setIsEmojiOpen((open) => !open)}
              disabled={!canCompose}
              aria-label="选择 Emoji 表情"
              aria-expanded={isEmojiOpen}
              className="rounded p-2 text-xl text-gray-300 hover:bg-white/10 hover:text-white disabled:opacity-50"
            >
              😊
            </button>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={(event) => void handleImageSelected(event)}
              className="hidden"
              aria-label="选择图片"
            />
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              disabled={!canCompose}
              aria-label="发送图片"
              title="发送图片（最大 10 MB）"
              className="rounded p-2 text-xl text-gray-300 hover:bg-white/10 hover:text-white disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="3" y="3" width="18" height="18" rx="3" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="m21 15-5-5L5 21" />
              </svg>
            </button>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={canCompose ? `发送到 #${title}` : "当前房间不能发言"}
              aria-label={`发送到 #${title}`}
              disabled={!canCompose}
              className="min-w-0 flex-1 bg-transparent py-4 text-white outline-none placeholder:text-gray-400 disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => isRecordingVoice ? stopVoiceRecording() : void startVoiceRecording()}
              disabled={!canCompose}
              aria-label={isRecordingVoice ? "结束并发送语音" : "录制语音"}
              title={isRecordingVoice ? "结束并发送语音" : "录制语音（最长 2 分钟）"}
              className={`rounded p-2 text-xl hover:bg-white/10 disabled:opacity-50 ${isRecordingVoice ? "text-red-400" : "text-gray-300 hover:text-white"}`}
            >
              {isRecordingVoice ? "⏹" : "🎙️"}
            </button>
            <button
              type="submit"
              disabled={!canCompose || input.trim().length === 0}
              className="rounded bg-indigo-500 px-4 py-2 font-medium hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              发送
            </button>

            {isEmojiOpen && (
              <div className="absolute bottom-full left-0 z-20 mb-2 grid w-72 grid-cols-6 gap-1 rounded-xl border border-white/10 bg-[#24262b] p-3 shadow-xl">
                {EMOJI_OPTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => insertEmoji(emoji)}
                    className="rounded p-2 text-xl hover:bg-white/10"
                    aria-label={`插入 ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="mt-2 px-1 text-xs text-gray-500">图片支持 JPG、PNG、GIF、WebP（单张最大 10 MB）；语音最长 2 分钟、最大 10 MB。录音需允许浏览器访问麦克风。</p>
        </form>
      </section>
    </main>
  );
}
