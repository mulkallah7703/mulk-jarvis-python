import type { GoogleLanguageModelOptions } from "@ai-sdk/google";

import { MISSING_KEY } from "../text";

export const SYSTEM_PROMPT = `You are Jarvis, a fast voice assistant for Mulk Allah Alsadi.
Reply in the language the user just used: Arabic or English.
Default to one or two short spoken sentences.
Give a longer answer only when the user asks for detail, steps, a list, or an explanation.
No markdown, bullets, asterisks, or emojis. Plain sentences for text-to-speech.
Be direct. If you do not know, say so in one sentence.
Use the name Mulk Allah only when a name is natural, not in every reply.
`;

export const HISTORY_MESSAGES = 12;

export type WebTts = "browser" | "gemini" | "elevenlabs";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export function geminiApiKey(): string {
  return (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
}

export function geminiModel(): string {
  return (process.env.GEMINI_MODEL || "gemini-2.5-flash").trim() || "gemini-2.5-flash";
}

export function geminiTtsModel(): string {
  return (process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts").trim() || "gemini-2.5-flash-preview-tts";
}

export function geminiTtsVoice(): string {
  return (process.env.GEMINI_TTS_VOICE || "Charon").trim() || "Charon";
}

export function resolveWebTts(): WebTts {
  const requested = (process.env.TTS_PROVIDER || "").trim().toLowerCase();
  const eleven = Boolean((process.env.ELEVENLABS_API_KEY || "").trim() && (process.env.ELEVENLABS_VOICE_ID || "").trim());
  const gemini = Boolean(geminiApiKey());
  if (requested === "browser") return "browser";
  if (requested === "elevenlabs") return eleven ? "elevenlabs" : gemini ? "gemini" : "browser";
  if (requested === "gemini") return gemini ? "gemini" : eleven ? "elevenlabs" : "browser";
  // The CLI default is edge-tts, which cannot run on Vercel.
  if (gemini) return "gemini";
  if (eleven) return "elevenlabs";
  return "browser";
}

export function thinkingConfig(model: string): GoogleLanguageModelOptions["thinkingConfig"] | undefined {
  const name = model.toLowerCase();
  if (name.includes("gemini-3")) return { thinkingLevel: "low" };
  if (name.includes("2.5") || name.includes("flash-lite")) return { thinkingBudget: 0 };
  return undefined;
}

export function parseMessages(body: unknown): ChatMessage[] | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { messages?: unknown }).messages;
  if (!Array.isArray(raw)) return null;
  const messages: ChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;
    const text = content.trim().slice(0, 4000);
    if (!text) continue;
    messages.push({ role, content: text });
  }
  const trimmed = messages.slice(-HISTORY_MESSAGES);
  if (trimmed.length === 0 || trimmed[trimmed.length - 1]?.role !== "user") return null;
  return trimmed;
}

export function logJarvisError(label: string, error: unknown): void {
  const key = geminiApiKey();
  let message = error instanceof Error ? error.message : String(error);
  if (key) message = message.split(key).join("[key]");
  console.error(`[jarvis] ${label}: ${message}`);
}

export { MISSING_KEY };
