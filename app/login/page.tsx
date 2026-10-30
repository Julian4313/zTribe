"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getBrowserEthereumProvider } from "../lib/ethereum-window";
import { supabase } from "../lib/supabase";

const SIGN_IN_STATEMENT =
  "授权登录 zTribe 聊天室。签名仅用于验证钱包所有权，不会发起链上交易。";

export default function LoginPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [hasWallet, setHasWallet] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHasWallet(getBrowserEthereumProvider() !== null);
  }, []);

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

  async function handleWalletSignIn() {
    if (isSubmitting) {
      return;
    }

    const provider = getBrowserEthereumProvider();
    if (!provider) {
      setError(
        "未检测到 EVM 钱包。请安装任意支持 Ethereum 的浏览器钱包插件（如 MetaMask、Rabby、Coinbase Wallet 等），刷新本页后重试。",
      );
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithWeb3({
      chain: "ethereum",
      statement: SIGN_IN_STATEMENT,
    });

    setIsSubmitting(false);

    if (signInError) {
      const message = signInError.message.toLowerCase();

      if (
        message.includes("user rejected") ||
        message.includes("rejected") ||
        message.includes("denied")
      ) {
        setError("你已取消钱包签名，未完成登录。");
        return;
      }

      if (
        message.includes("web3") ||
        message.includes("provider") ||
        message.includes("not enabled")
      ) {
        setError(
          `登录失败：${signInError.message}。请在 Supabase 控制台启用 Authentication → Providers → Web3（Ethereum），并将 http://localhost:3000/** 加入 Redirect URLs。`,
        );
        return;
      }

      setError(`登录失败：${signInError.message}`);
      return;
    }

    router.replace("/");
  }

  if (authChecking) {
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
