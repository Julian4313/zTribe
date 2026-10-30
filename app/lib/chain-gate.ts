const BALANCE_OF = "0x70a08231";
const AUTO_DELEGATE_MIN = "0xe7d7fdbb";

export class ChainNotConfiguredError extends Error {
  constructor() {
    super("链未配置，无法校验余额。");
    this.name = "ChainNotConfiguredError";
  }
}

function padAddress(address: string) {
  return address.slice(2).toLowerCase().padStart(64, "0");
}

async function ethCall(token: string, data: string) {
  const rpcUrl = process.env.BSC_RPC_URL;
  if (!rpcUrl) {
    throw new ChainNotConfiguredError();
  }

  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: token, data }, "latest"],
    }),
  });

  if (!response.ok) {
    throw new Error(`RPC 请求失败（${response.status}）。`);
  }

  const payload = (await response.json()) as {
    result?: string;
    error?: { message?: string };
  };

  if (payload.error) {
    throw new Error(payload.error.message ?? "eth_call 失败。");
  }

  if (!payload.result || payload.result === "0x") {
    throw new Error("合约没有返回余额。");
  }

  return BigInt(payload.result);
}

/** 进门权威是链上 balanceOf 与 AUTO_DELEGATE_MIN。不读 chain 表，不造余额。 */
export async function readJoinBalance(token: string, wallet: string) {
  const [balance, minimum] = await Promise.all([
    ethCall(token, BALANCE_OF + padAddress(wallet)),
    ethCall(token, AUTO_DELEGATE_MIN),
  ]);

  return { balance, minimum, allowed: balance >= minimum };
}
