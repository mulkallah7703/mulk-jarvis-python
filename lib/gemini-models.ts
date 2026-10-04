import type { GoogleLanguageModelOptions } from "@ai-sdk/google";

/**
 * Parsed into the raw chain. The voice path drops any name containing "lite"
 * so a free-tier miss cannot silently answer with a weaker model.
 */
export const DEFAULT_GEMINI_FALLBACK_MODELS = "gemini-3.1-flash-lite,gemini-3.5-flash-lite";

export function geminiModelChain(primary: string, fallbacks: string | undefined): string[] {
  const extra = fallbacks === undefined ? DEFAULT_GEMINI_FALLBACK_MODELS : fallbacks;
  const names = [primary, ...extra.split(/[,;\s]+/)].map((name) => name.trim()).filter(Boolean);
  const chain: string[] = [];
  for (const name of names) {
    if (!chain.includes(name)) chain.push(name);
  }
  return chain.length > 0 ? chain : ["gemini-2.5-flash"];
}

export function isLiteModel(name: string): boolean {
  return name.toLowerCase().includes("lite");
}

/** Voice answers stay on the primary model. Lite names are only kept if nothing else is configured. */
export function voiceModelChain(primary: string, fallbacks: string | undefined): string[] {
  const chain = geminiModelChain(primary, fallbacks);
  const strong = chain.filter((name) => !isLiteModel(name));
  return strong.length > 0 ? strong : chain.slice(0, 1);
}

export function thinkingConfig(model: string): GoogleLanguageModelOptions["thinkingConfig"] | undefined {
  const name = model.toLowerCase();
  if (name.includes("flash-lite")) {
    // 3.1 rejects thinking levels; 3.5 rejects a zero budget. Both were checked live.
    if (name.includes("3.1")) return { thinkingBudget: 0 };
    if (name.includes("gemini-3")) return { thinkingLevel: "minimal" };
    return { thinkingBudget: 0 };
  }
  if (name.includes("gemini-3")) return { thinkingLevel: "low" };
  if (name.includes("2.5")) return { thinkingBudget: 0 };
  return undefined;
}

const FALLBACK_STATUS = new Set([404, 500, 502, 503, 504]);

function errorBlob(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const message = (current as { message?: unknown }).message;
    if (typeof message === "string" && message) parts.push(message);
    const record = current as { responseBody?: unknown; data?: unknown; cause?: unknown };
    if (typeof record.responseBody === "string" && record.responseBody) parts.push(record.responseBody);
    if (record.data !== undefined) {
      try {
        parts.push(JSON.stringify(record.data));
      } catch {
        // Ignore values that cannot be serialized.
      }
    }
    current = record.cause;
  }
  if (typeof error === "string") parts.push(error);
  return parts.join("\n");
}

export function geminiErrorStatus(error: unknown): number | undefined {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const record = current as {
      statusCode?: unknown;
      status?: unknown;
      responseBody?: unknown;
      data?: unknown;
      cause?: unknown;
    };
    for (const value of [record.statusCode, record.status]) {
      if (typeof value === "number" && Number.isInteger(value)) return value;
      if (typeof value === "string" && /^\d{3}$/.test(value)) return Number(value);
    }
    if (typeof record.responseBody === "string") {
      const matched = record.responseBody.match(/"code"\s*:\s*(\d{3})/);
      if (matched?.[1]) return Number(matched[1]);
    }
    const code = (record.data as { error?: { code?: unknown } } | undefined)?.error?.code;
    if (typeof code === "number" && Number.isInteger(code)) return code;
    current = record.cause;
  }
  const matched = errorBlob(error).match(/\b(429|404|500|502|503|504)\b/);
  return matched?.[1] ? Number(matched[1]) : undefined;
}

export function isGeminiAuthError(error: unknown): boolean {
  const status = geminiErrorStatus(error);
  if (status === 429 || status === 404 || (status !== undefined && status >= 500)) return false;
  const raw = errorBlob(error).toLowerCase();
  if (raw.includes("quota") || raw.includes("resource_exhausted") || raw.includes("rate limit")) return false;
  if (status === 401 || status === 403) return true;
  return ["api key", "api_key", "permission", "unauthenticated", "401", "403"].some((word) => raw.includes(word));
}

/** Daily cap or a per-minute limit. The voice path says so instead of switching models. */
export function isQuotaError(error: unknown): boolean {
  const status = geminiErrorStatus(error);
  if (status === 429) return true;
  const raw = errorBlob(error).toLowerCase();
  return (
    raw.includes("quota") ||
    raw.includes("resource_exhausted") ||
    raw.includes("rate limit") ||
    raw.includes("too many requests") ||
    raw.includes("free_tier")
  );
}

/** Gemini 3 sometimes rejects an explicit temperature. Same model, one retry without it. */
export function isTemperatureRejection(error: unknown): boolean {
  if (geminiErrorStatus(error) !== 400) return false;
  const raw = errorBlob(error).toLowerCase();
  return raw.includes("temperature") || raw.includes("invalid argument");
}

/** A missing model or an upstream outage. Not quota, an invalid key, or a bad prompt. */
export function shouldFallbackModel(error: unknown): boolean {
  if (isGeminiAuthError(error) || isQuotaError(error)) return false;
  const status = geminiErrorStatus(error);
  if (status !== undefined && FALLBACK_STATUS.has(status)) return true;
  if (status !== undefined && status >= 500) return true;
  const raw = errorBlob(error).toLowerCase();
  return raw.includes("no longer available") || raw.includes("not found") || raw.includes("model_not_found");
}

export function logChatModelFailure(model: string, error: unknown, secrets: string[]): void {
  let message = errorBlob(error).replace(/\s+/g, " ").trim();
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join("[key]");
  }
  const status = geminiErrorStatus(error);
  console.error(`[jarvis] chat: model=${model} status=${status ?? "unknown"} ${message.slice(0, 500)}`);
}
