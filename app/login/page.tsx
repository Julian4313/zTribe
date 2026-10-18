
"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      const { data, error: sessionError } = await supabase.auth.getSession();

      if (cancelled) {
        return;
      }

      if (sessionError) {
        setError(`读取登录状态失败：${sessionError.message}`);
        setAuthChecking(false);
        return;
      }

      if (data.session) {
        router.replace("/");
        return;
      }

      setAuthChecking(false);
    }

    void restoreSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        router.replace("/");
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [router]);

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setInfo(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });

    setIsSubmitting(false);

    if (signInError) {
      setError(`登录失败：${signInError.message}`);
      return;
    }

    router.replace("/");
  }

  async function handleSignUp() {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setInfo(null);

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: trimmedEmail,
      password,
    });

    setIsSubmitting(false);

    if (signUpError) {
      setError(`注册失败：${signUpError.message}`);
      return;
    }

    if (data.session) {
      router.replace("/");
      return;
    }

    setInfo(
      "注册成功。请查收确认邮件完成验证后再登录；若项目关闭了邮箱确认，也可直接登录。",
    );
  }

  if (authChecking) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#313338] text-white">
        <p className="text-gray-400">正在检查登录状态...</p>
      </main>
    );
  }

  const canSubmit = email.trim().length > 0 && password.length > 0 && !isSubmitting;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#313338] px-4 text-white">
      <div className="w-full max-w-md rounded-lg bg-[#2b2d31] p-8 shadow-xl">
        <h1 className="mb-2 text-2xl font-bold">欢迎回来</h1>
        <p className="mb-6 text-sm text-gray-400">
          使用邮箱登录或注册后进入聊天室
        </p>

        <form onSubmit={handleSignIn} className="space-y-4">
          <label className="block text-xs font-bold uppercase text-gray-400">
            邮箱
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={isSubmitting}
              className="mt-2 w-full rounded bg-[#1e1f22] px-3 py-2.5 text-sm text-white outline-none ring-1 ring-[#1e1f22] focus:ring-indigo-500 disabled:opacity-60"
            />
          </label>

          <label className="block text-xs font-bold uppercase text-gray-400">
            密码
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={isSubmitting}
              className="mt-2 w-full rounded bg-[#1e1f22] px-3 py-2.5 text-sm text-white outline-none ring-1 ring-[#1e1f22] focus:ring-indigo-500 disabled:opacity-60"
            />
          </label>

          {error && (
            <p className="rounded bg-[#3f2121] px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          {info && (
            <p className="rounded bg-[#1f3a2a] px-3 py-2 text-sm text-green-300">
              {info}
            </p>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full rounded bg-indigo-500 px-4 py-2.5 font-medium hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "处理中..." : "登录"}
          </button>

          <button
            type="button"
            onClick={() => void handleSignUp()}
            disabled={!canSubmit}
            className="w-full rounded bg-[#404249] px-4 py-2.5 font-medium hover:bg-[#35373c] disabled:cursor-not-allowed disabled:opacity-50"
          >
            注册
          </button>
        </form>
      </div>
    </main>
  );
}
