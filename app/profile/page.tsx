
"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { resolveCurrentUser } from "../lib/auth-session";
import { supabase } from "../lib/supabase";
import { getEthereumAddressFromUser } from "../lib/user-display";

type Profile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  updated_at: string;
};

const DEFAULT_DISPLAY_NAME = "新用户";
const MAX_DISPLAY_NAME_LENGTH = 40;

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [displayName, setDisplayName] = useState(DEFAULT_DISPLAY_NAME);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      const { user: currentUser, errorMessage } =
        await resolveCurrentUser(supabase);

      if (cancelled) {
        return;
      }

      if (errorMessage) {
        setError(`读取登录状态失败：${errorMessage}`);
        setUser(null);
        setAuthReady(true);
        return;
      }

      setUser(currentUser);
      setAuthReady(true);
    }

    void restoreSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setUser(null);
        setAuthReady(true);
        return;
      }

      void resolveCurrentUser(supabase).then(
        ({ user: currentUser, errorMessage }) => {
          if (cancelled) {
            return;
          }

          if (errorMessage) {
            setError(`读取登录状态失败：${errorMessage}`);
            setUser(null);
          } else {
            setUser(currentUser);
          }

          setAuthReady(true);
        },
      );
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
      return;
    }

    let cancelled = false;

    async function loadOrCreateProfile(currentUser: User) {
      setIsLoadingProfile(true);
      setError(null);
      setSuccess(null);

      const { data: existing, error: loadError } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url, updated_at")
        .eq("id", currentUser.id)
        .maybeSingle();

      if (cancelled) {
        return;
      }

      if (loadError) {
        setError(`加载资料失败：${loadError.message}`);
        setIsLoadingProfile(false);
        return;
      }

      if (existing) {
        setDisplayName(existing.display_name);
        setIsLoadingProfile(false);
        return;
      }

      const { data: created, error: createError } = await supabase
        .from("profiles")
        .insert({
          id: currentUser.id,
          display_name: DEFAULT_DISPLAY_NAME,
        })
        .select("id, display_name, avatar_url, updated_at")
        .single();

      if (cancelled) {
        return;
      }

      if (createError) {
        setError(`创建资料失败：${createError.message}`);
        setIsLoadingProfile(false);
        return;
      }

      const profile = created as Profile;
      setDisplayName(profile.display_name);
      setIsLoadingProfile(false);
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

    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !authUser) {
      setIsSaving(false);
      setError("请先登录后再编辑资料。");
      setUser(null);
      router.replace("/login");
      return;
    }

    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        display_name: trimmedName,
        updated_at: new Date().toISOString(),
      })
      .eq("id", authUser.id);

    setIsSaving(false);

    if (updateError) {
      setError(`保存失败：${updateError.message}`);
      return;
    }

    setDisplayName(trimmedName);
    setSuccess("资料已保存。");
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

          <Link
            href="/"
            className="shrink-0 rounded bg-[#404249] px-3 py-1.5 text-sm hover:bg-[#35373c]"
          >
            返回聊天
          </Link>
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
              {isSaving ? "保存中..." : "保存资料"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
