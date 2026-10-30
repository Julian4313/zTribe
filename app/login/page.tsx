"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { getBrowserEthereumProvider } from "../lib/ethereum-window";
import { supabase } from "../lib/supabase";
import { useAuthUser } from "../lib/use-auth-user";
import { getEthereumAddressFromUser } from "../lib/user-display";

const SIGN_IN_STATEMENT =
  "授权登录 zTribe 聊天室。签名仅用于验证钱包所有权，不会发起链上交易。";

export default function LoginPage() {
  const router = useRouter();
  const { user, authReady } = useAuthUser();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const hasWallet = useSyncExternalStore(
    () => () => {},
    () => getBrowserEthereumProvider() !== null,
    () => null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authReady && user && !isSubmitting) {
      router.replace("/");
    }
  }, [authReady, user, router]);

  async function handleWalletSignIn() {
    if (isSubmitting) return;

    const provider = getBrowserEthereumProvider();
    if (!provider) {
      setError(
        "未检测到 EVM 钱包。请安装任意支持 Ethereum 的浏览器钱包插件（如 MetaMask、Rabby、Coinbase Wallet 等），刷新本页后重试。",
      );
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const { error: signInError } = await supabase.auth.signInWithWeb3({
        chain: "ethereum",
        statement: SIGN_IN_STATEMENT,
      });

      if (signInError) {
        const message = signInError.message || "未知登录错误";
        const normalized = message.toLowerCase();
        const errorCode = String(
          (signInError as { code?: string | number }).code ?? "",
        ).toLowerCase();

        if (
          errorCode === "4001" ||
          errorCode === "action_rejected" ||
          normalized.includes("user rejected") ||
          normalized.includes("user denied") ||
          normalized.includes("rejected") ||
          normalized.includes("denied")
        ) {
          setError("你已取消钱包签名，未完成登录。需要登录时，可以再次点击按钮。 ");
          return;
        }

        if (
          normalized.includes("web3") ||
          normalized.includes("provider") ||
          normalized.includes("not enabled")
        ) {
          setError(
            `登录失败：${message}。请在 Supabase 控制台启用 Authentication → Providers → Web3（Ethereum），并将 http://localhost:3000/** 加入 Redirect URLs。`,
          );
          return;
        }

        setError(`登录失败：${message}`);
        return;
      }

      // Create the user's default nickname before entering the chat. This is
      // deliberately part of the successful login flow, not an edit-page action.
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();
      if (sessionError || !session?.access_token || !session.user) {
        await supabase.auth.signOut();
        setError("登录成功，但无法读取登录凭证。请重新连接钱包。");
        return;
      }

      const address = getEthereumAddressFromUser(session.user)?.toLowerCase();
      if (!address) {
        await supabase.auth.signOut();
        setError("登录成功，但未能读取钱包地址。请重新连接钱包。");
        return;
      }

      const defaultNickname = `User_${session.user.id.slice(-6).toUpperCase()}`;
      const profileResponse = await fetch("/api/profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ nickname: defaultNickname, initializeOnly: true }),
      });
      const profilePayload = await profileResponse.json().catch(() => null) as
        | { error?: string }
        | null;

      if (!profileResponse.ok) {
        await supabase.auth.signOut();
        setError(profilePayload?.error ?? "默认昵称创建失败，请稍后重试登录。");
        return;
      }

      router.replace("/");
    } catch (caughtError) {
      const errorObject = caughtError as {
        message?: string;
        code?: string | number;
        shortMessage?: string;
      } | null;
      const message =
        errorObject?.shortMessage ||
        errorObject?.message ||
        (typeof caughtError === "string" ? caughtError : "未知登录错误");
      const normalized = message.toLowerCase();
      const errorCode = String(errorObject?.code ?? "").toLowerCase();

      if (
        errorCode === "4001" ||
        errorCode === "action_rejected" ||
        normalized.includes("user rejected") ||
        normalized.includes("user denied") ||
        normalized.includes("rejected") ||
        normalized.includes("denied")
      ) {
        setError("你已取消钱包签名，未完成登录。需要登录时，可以再次点击按钮。");
      } else {
        setError(`登录失败：${message}`);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!authReady || user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#313338] text-white">
        <p className="text-gray-400">正在检查登录状态...</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#313338] px-4 text-white">
      <div className="w-full max-w-md rounded-lg bg-[#2b2d31] p-8 shadow-xl">
        <h1 className="mb-2 text-2xl font-bold">欢迎回来</h1>
        <p className="mb-6 text-sm text-gray-400">
          使用 EVM 钱包签名登录后进入聊天室（Sign-In with Ethereum）
        </p>

        {hasWallet === false && (
          <p className="mb-4 rounded bg-[#3a3520] px-3 py-2 text-sm text-amber-200">
            未检测到浏览器钱包。请安装任意 EVM 钱包扩展（MetaMask、Rabby、OKX
            Wallet、Coinbase Wallet 等），安装后刷新本页。
          </p>
        )}

        {error && (
          <p className="mb-4 rounded bg-[#3f2121] px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={() => void handleWalletSignIn()}
          disabled={isSubmitting}
          className="w-full rounded bg-indigo-500 px-4 py-3 font-medium hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? "等待钱包签名…" : "连接钱包并登录"}
        </button>

        <p className="mt-4 text-xs leading-relaxed text-gray-500">
          点击后将唤起钱包，对登录消息进行链下签名，不会产生 gas 费用。
        </p>
      </div>
    </main>
  );
}
