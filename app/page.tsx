import { Suspense } from "react";
import Home from "./home-client";

export default function Page() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-[#313338] text-white">
          <p className="text-gray-400">正在检查登录状态...</p>
        </main>
      }
    >
      <Home />
    </Suspense>
  );
}
