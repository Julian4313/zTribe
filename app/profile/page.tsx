
"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { useAuthUser } from "../lib/use-auth-user";
import { getEthereumAddressFromUser } from "../lib/user-display";

const MAX_DISPLAY_NAME_LENGTH = 40;

export default function ProfilePage() {
  const router = useRouter();
  const { user, authReady } = useAuthUser();
  // Initialize from navigation data on the very first render. This keeps
  // both the nickname and the wallet address visible immediately; the wallet
  // address is already available from the authenticated user and is not read
  // from the profiles table.
  const [initialNickname] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("nickname")?.trim() ?? "";
  });
  const [isLoadingProfile, setIsLoadingProfile] = useState(() => !initialNickname);
  const [isSaving, setIsSaving] = useState(false);
  const [displayName, setDisplayName] = useState(initialNickname);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
      return;
    }

    let cancelled = false;

    async function loadOrCreateProfile(currentUser: User) {
      setError(null);
      setSuccess(null);
      try {

      // The chat sidebar already has the current nickname. Reuse it when
      // navigating here instead of making the user wait for a duplicate read.
      const nicknameFromNavigation = new URLSearchParams(window.location.search)
        .get("nickname")?.trim();
      if (nicknameFromNavigation) {
        setDisplayName(nicknameFromNavigation.slice(0, MAX_DISPLAY_NAME_LENGTH));
        setIsLoadingProfile(false);
        return;
      }

      setIsLoadingProfile(true);
      const address = getEthereumAddressFromUser(currentUser)?.toLowerCase();
      if (!address) {
        setError("当前会话没有钱包地址。");
        setIsLoadingProfile(false);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setError("登录状态已失效，请重新登录。");
        setIsLoadingProfile(false);
        return;
      }
      const profileResponse = await fetch("/api/profile", { headers: { Authorization: `Bearer ${session.access_token}` } });
      const profilePayload = await profileResponse.json().catch(() => null) as { profile?: { nickname?: string | null }; error?: string } | null;
      const existing = profilePayload?.profile ?? null;
      const loadError = profileResponse.ok ? null : new Error(profilePayload?.error ?? "读取资料失败。");

      if (cancelled) {
        return;
      }

      if (loadError) {
        setError(`加载资料失败：${loadError.message}`);
        setIsLoadingProfile(false);
        return;
      }

      const existingNickname =
        typeof existing?.nickname === "string" ? existing.nickname.trim() : "";

      if (existingNickname) {
        setDisplayName(existingNickname);
        setIsLoadingProfile(false);
        return;
      }

      // Stable per-wallet default. The API's initializeOnly mode inserts only
      // when absent, so opening two tabs cannot overwrite a chosen nickname.
      const defaultNickname = `User_${currentUser.id.slice(-6).toUpperCase()}`;
      const response = await fetch("/api/profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ nickname: defaultNickname, initializeOnly: true }),
      });
      const payload = await response.json().catch(() => null) as
        | { error?: string; profile?: { nickname?: string | null } }
        | null;
      if (cancelled) return;
      if (!response.ok) {
        setError(payload?.error ?? "创建默认昵称失败，请稍后重试。");
        setIsLoadingProfile(false);
        return;
      }

      const savedName = typeof payload?.profile?.nickname === "string"
        ? payload.profile.nickname
        : defaultNickname;
      setDisplayName(savedName);
      setIsLoadingProfile(false);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error
            ? `加载资料失败：${loadError.message}`
            : "加载资料失败，请检查网络后重试。");
          setIsLoadingProfile(false);
        }
      }
    }

    void loadOrCreateProfile(user);

    return () => {
      cancelled = true;
    };
  }, [user]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSaving || isLoadingProfile) {
      return;
    }

    const trimmedName = displayName.trim();
    if (!trimmedName) {
      setError("显示名称不能为空。");
      setSuccess(null);
      return;
    }

    if (trimmedName.length > MAX_DISPLAY_NAME_LENGTH) {
      setError(`显示名称最多 ${MAX_DISPLAY_NAME_LENGTH} 个字符。`);
      setSuccess(null);
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const {
        data: { user: authUser },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !authUser) {
        setError("登录状态已失效，请重新登录。");
        await supabase.auth.signOut();
        router.replace("/login");
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setError("登录状态已失效，请重新登录。");
        await supabase.auth.signOut();
        router.replace("/login");
        return;
      }

      const response = await fetch("/api/profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ nickname: trimmedName }),
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; profile?: { nickname?: string | null } }
        | null;

      if (!response.ok) {
        setError(payload?.error ?? "保存失败，请稍后重试。");
        return;
      }

      const savedName = typeof payload?.profile?.nickname === "string"
        ? payload.profile.nickname.trim()
        : trimmedName;
      setDisplayName(savedName);
      setSuccess("保存成功，正在返回聊天室…");
      // Pass the confirmed server value back to the chat page so its sidebar
      // can update immediately without waiting for another profile request.
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      router.replace(`/?nickname=${encodeURIComponent(savedName)}`);
    } catch (saveError) {
      setError(saveError instanceof Error
        ? `保存失败：${saveError.message}`
        : "保存失败，请检查网络后重试。");
    } finally {
      setIsSaving(false);
    }
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

  const canSave =
    !isSaving &&
    !isLoadingProfile &&
    displayName.trim().length > 0 &&
    displayName.trim().length <= MAX_DISPLAY_NAME_LENGTH;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#313338] px-4 text-white">
      <div className="w-full max-w-md rounded-lg bg-[#2b2d31] p-8 shadow-xl">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">个人资料</h1>
            <p className="mt-1 text-sm text-gray-400">
              修改你在聊天室中的显示名称
            </p>
          </div>

          <button
            type="button"
            disabled={isSaving}
            onClick={() => router.replace("/")}
            className="shrink-0 rounded bg-[#404249] px-3 py-1.5 text-sm hover:bg-[#35373c] disabled:cursor-not-allowed disabled:opacity-40"
          >
            返回聊天
          </button>
        </div>

        {isLoadingProfile ? (
          <p className="text-gray-400">正在加载资料...</p>
        ) : (
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <p className="text-xs font-bold uppercase text-gray-400">
                钱包地址
              </p>
              <p className="mt-2 truncate rounded bg-[#1e1f22] px-3 py-2.5 font-mono text-sm text-gray-300">
                {getEthereumAddressFromUser(user) ?? "未绑定 EVM 钱包"}
              </p>
            </div>

            <label className="block text-xs font-bold uppercase text-gray-400">
              显示名称
              <input
                type="text"
                value={displayName}
                maxLength={MAX_DISPLAY_NAME_LENGTH}
                onChange={(event) => {
                  setDisplayName(event.target.value);
                  setSuccess(null);
                }}
                disabled={isSaving}
                className="mt-2 w-full rounded bg-[#1e1f22] px-3 py-2.5 text-sm text-white outline-none ring-1 ring-[#1e1f22] focus:ring-indigo-500 disabled:opacity-60"
              />
              <span className="mt-1 block text-[11px] font-normal normal-case text-gray-500">
                {displayName.trim().length}/{MAX_DISPLAY_NAME_LENGTH}
              </span>
            </label>

            {error && (
              <p className="rounded bg-[#3f2121] px-3 py-2 text-sm text-red-300">
                {error}
              </p>
            )}

            {success && (
              <p className="rounded bg-[#1f3a2a] px-3 py-2 text-sm text-green-300">
                {success}
              </p>
            )}

            <button
              type="submit"
              disabled={!canSave}
              className="w-full rounded bg-indigo-500 px-4 py-2.5 font-medium hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? "正在保存…" : success ? "保存成功" : "保存资料"}
            </button>
          </form>
        )}
      </div>
      {isSaving && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-[2px]" aria-live="polite">
          <div className="flex items-center gap-3 rounded-lg bg-[#2b2d31] px-5 py-4 text-sm shadow-xl">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-500 border-t-white" />
            正在保存资料，请稍候…
          </div>
        </div>
      )}
    </main>
  );
}
