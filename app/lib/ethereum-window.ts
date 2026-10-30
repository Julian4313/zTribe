export type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  isMetaMask?: boolean;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export function getBrowserEthereumProvider(): EthereumProvider | null {
  if (typeof window === "undefined") {
    return null;
  }

  const provider = window.ethereum;
  if (!provider || typeof provider.request !== "function") {
    return null;
  }

  return provider;
}
