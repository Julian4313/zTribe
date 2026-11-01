export function normalizeTokenAddress(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(trimmed)) {
    return null;
  }

  return trimmed;
}

export function parseRequiredTokensInput(value: unknown) {
  if (value === null || value === undefined) {
    return { ok: true as const, value: null };
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      return { ok: false as const, error: "requiredTokens 必须是非负数。" };
    }

    return { ok: true as const, value: String(value) };
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return { ok: true as const, value: null };
    }

    if (!/^\d+(\.\d+)?$/.test(trimmed) || Number(trimmed) < 0) {
      return { ok: false as const, error: "requiredTokens 必须是非负数字。" };
    }

    return { ok: true as const, value: trimmed };
  }

  return { ok: false as const, error: "requiredTokens 格式无效。" };
}
