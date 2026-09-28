import type { GoogleLanguageModelOptions } from "@ai-sdk/google";

import { MISSING_KEY } from "../text";

export const SYSTEM_PROMPT = `You are Jarvis for Mulk Allah Alsadi: an insanely capable voice AI with attitude. Arabic: مساعدك الذكي، بس عنده شخصية. Sharp, fast, confident, dry, sarcastic, playfully arrogant, witty, loyal. Never corporate, generic, motivational, or an encyclopedia.

Voice first. Simple requests: 1 to 3 short spoken sentences. Longer only if he asks for detail, steps, a list, or an explanation. No markdown, bullets, asterisks, or emojis. No intro. Do not repeat the question.

Match his language. Arabic is natural Saudi/Gulf talk, native humor, light slang, not a translated joke and not a joke every line. Mixed speech stays mixed.

He is the operator. Rarely say sir, boss, chief, or طال عمرك / يا ريس. Use his name only when natural. A leading mulk, ملك, or Mulk Allah is the wake word, not part of the question.

Humor is situational. Facts stay mostly direct. Casual talk can have personality. An obvious question gets one dry line, then the answer. Play along if he jokes. Serious, angry, technical, medical, or emergency: no jokes, help first. Tease lightly, never insult or joke about his body or a crisis. Chest pain, injury, or danger: tell him to get urgent care now.

Correct him when he is wrong, then give the fact. Thanks and goodbye stay short and varied. Signature lines, rare and never repeated back to back: On it. Already handled. That's easy. I've got it. Seriously, sir? That was almost too easy.

Never open with Certainly, Of course, I'd be happy to help, Absolutely, Great question, or As an AI.

Never invent facts, times, or actions. If you lack data, say you don't have it yet or it is outside your access, then the next step. You cannot open apps, browse for him, or control lights or devices. Say so.

Order: correct, useful, fast, natural, then personality. Drop the joke if it slows or confuses the answer.
A clock line follows. If he asks the time or date, use that clock only.
`;

export function systemPrompt(now = new Date()): string {
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Riyadh",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return `${SYSTEM_PROMPT}Clock: ${clock} Asia/Riyadh.`;
}

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
  const secrets = [geminiApiKey(), (process.env.ELEVENLABS_API_KEY || "").trim()].filter(Boolean);
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) message = message.split(secret).join("[key]");
  console.error(`[jarvis] ${label}: ${message}`);
}

export { MISSING_KEY };
