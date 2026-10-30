
"use client";

import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function SupabaseTestPage() {
  const [status, setStatus] = useState("尚未测试");

  async function testConnection() {
    setStatus("正在连接...");

    const { error } = await supabase
      .schema("app")
      .from("rooms")
      .select("id")
      .limit(1);

    if (error) {
      setStatus(`连接请求失败：${error.message}`);
      return;
    }

      setStatus("连接成功！已成功读取 app.rooms。");
  }

  return (
    <main className="min-h-screen bg-[#313338] p-8 text-white">
      <h1 className="mb-4 text-2xl font-bold">
        Supabase 连接测试
      </h1>

      <button
        onClick={testConnection}
        className="rounded bg-indigo-500 px-4 py-2 hover:bg-indigo-400"
      >
        测试数据库连接
      </button>

      <p className="mt-5 break-words">{status}</p>
    </main>
  );
}
