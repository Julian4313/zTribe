import type { User } from "@supabase/supabase-js";

export const DEFAULT_DISPLAY_NAME = "新用户";

const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export function shortenEthereumAddress(address: string) {
  const trimmed = address.trim();
  if (trimmed.length < 10) {
    return trimmed;
  }

  return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
}

function parseEthereumAddress(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (EVM_ADDRESS_PATTERN.test(trimmed)) {
    return trimmed;
  }

  const web3PrefixMatch = /^web3:ethereum:(0x[a-fA-F0-9]{40})$/i.exec(trimmed);
  if (web3PrefixMatch) {
    return web3PrefixMatch[1];
  }

  const colonParts = trimmed.split(":");
  if (colonParts.length >= 3 && colonParts[0]?.toLowerCase() === "web3") {
    const maybeAddress = colonParts.at(-1);
    if (maybeAddress && EVM_ADDRESS_PATTERN.test(maybeAddress)) {
      return maybeAddress;
    }
  }

  return null;
}

function collectAddressCandidates(user: User): unknown[] {
  const metadata = user.user_metadata as Record<string, unknown> | undefined;
  const customClaims = metadata?.custom_claims as
    | Record<string, unknown>
    | undefined;

  const candidates: unknown[] = [
    metadata?.address,
    customClaims?.address,
    metadata?.sub,
  ];

  for (const identity of user.identities ?? []) {
    const data = identity.identity_data as Record<string, unknown> | undefined;
    candidates.push(identity.id, data?.address, data?.sub);
  }

  return candidates;
}

export function getEthereumAddressFromUser(user: User): string | null {
  for (const candidate of collectAddressCandidates(user)) {
    const address = parseEthereumAddress(candidate);
    if (address) {
      return address;
    }
  }

  return null;
}

export function getFallbackDisplayName(user: User) {
  // Never derive a public-facing fallback nickname from the wallet address.
  // Supabase's internal user UUID is stable for this account and unrelated
  // to the wallet string shown in the UI.
  if (typeof user.id === "string" && user.id.length >= 4) {
    return `User_${user.id.slice(-6).toUpperCase()}`;
  }

  return DEFAULT_DISPLAY_NAME;
}
