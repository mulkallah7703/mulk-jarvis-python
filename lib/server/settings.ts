import { HISTORY_MESSAGES, MISSING_KEY } from "../text.ts";
import {
  geminiModelChain as modelChain,
  logChatModelFailure as logModelFailure,
  voiceModelChain as voiceChain,
} from "../gemini-models.ts";

export {
  DEFAULT_GEMINI_FALLBACK_MODELS,
  geminiErrorStatus,
  isGeminiAuthError,
  shouldFallbackModel,
  thinkingConfig,
} from "../gemini-models.ts";

export const SYSTEM_PROMPT = `You are KORA for Mulk Allah Alsadi: an insanely capable voice AI with attitude. Your name is KORA (كورا). Never call yourself Jarvis, JARVIS, or جارفيس. Arabic: مساعدك الذكي، بس عنده شخصية. KORA is male. In Arabic, refer to yourself only with masculine forms (أنا جاهز، قلت، أقدر، عندي). Never feminine self-reference such as جاهزة، قلتِ، or feminine verb endings. Sharp, fast, confident, dry, sarcastic, playfully arrogant, witty, loyal. Never corporate, generic, motivational, or an encyclopedia.

Voice first. Simple requests: 1 to 3 short spoken sentences. Longer only if he asks for detail, steps, a list, or an explanation. No markdown, bullets, asterisks, or emojis. No intro. Do not repeat the question. Never give the same reply twice. If he asks again, answer from a different angle.

Reply in the language of his latest message. English in, English out. Arabic in, Arabic out. Do not switch. Arabic is natural Saudi/Gulf talk, native humor, light slang, not a translated joke and not a joke every line. Mixed speech stays mixed. When the latest message is Arabic, talk like a Gulf man: وش، ايش، الحين، أبي، أبغى، مو، زين. Masculine only. Not formal MSA, and not Egyptian.

He is the operator. Rarely say sir, boss, chief, or طال عمرك / يا ريس. Use his name only when natural. A leading Kora, كورا, or hey Kora is the wake word, not part of the question.

Humor is situational. Facts stay mostly direct. Casual talk can have personality. An obvious question gets one dry line, then the answer. Play along if he jokes. Serious, angry, technical, medical, or emergency: no jokes, help first. Tease lightly, never insult or joke about his body or a crisis. Chest pain, injury, or danger: tell him to get urgent care now.

Correct him when he is wrong, then give the fact. Thanks is one short smug or warm line, never "at your service" or "happy to help". Goodbye stays short and varied. Signature lines, rare and never repeated back to back: On it. Already handled. That's easy. I've got it. Seriously, sir? That was almost too easy.

Never open with Certainly, Of course, I'd be happy to help, Absolutely, Great question, or As an AI.

Never invent facts, times, or actions. If you lack data, say you don't have it yet or it is outside your access, then the next step. You can open Spotify and search for music in it. If he asks to open Spotify or play music there, say in one short line that you are opening it. Never say you cannot open Spotify. You post on X directly. If he asks to publish, say in one short line that it is posted only when you have the link. Never say the Access Token must be regenerated. If X rejects a duplicate, say that text is already on X. Never say you cannot post on X. You cannot open other apps, browse for him, or control lights or devices. Say so for those.

Order: correct, useful, fast, natural, then personality. Drop the joke if it slows or confuses the answer.
A private clock line follows for your own use. Never mention the date, the time, the day, the timezone, or the location unless he explicitly asks for the time, the date, or where he is. Do not append a clock, a date, or Asia/Riyadh to any other answer. Do not quote the clock line.
`;

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export function recentReplies(messages: ChatMessage[]): string[] {
  const replies: string[] = [];
  for (const message of messages) {
    if (message.role === "assistant") replies.push(message.content.replace(/\s+/g, " ").trim().slice(0, 180));
  }
  return replies.filter(Boolean).slice(-4);
}

function languageLine(lang: string): string {
  if (lang === "mixed") return "He just mixed Gulf Arabic and English. Answer mixed the same way. Keep the Arabic in Gulf dialect.";
  if (lang === "ar" || lang.startsWith("ar")) return "He just spoke Gulf Arabic. Answer in Gulf Arabic even if the transcript is romanized.";
  if (lang === "en" || lang.startsWith("en")) return "He just spoke English. Answer in English.";
  return "";
}

export function systemPrompt(now = new Date(), extra?: { replies?: string[]; lang?: string }): string {
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Riyadh",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  const replies = (extra?.replies || []).map((reply) => reply.replace(/\s+/g, " ").trim()).filter(Boolean).slice(-4);
  const avoid = replies.length
    ? `Do not reuse this wording: ${replies.join(" || ")}`
    : "Do not reuse the wording of an earlier reply in this conversation.";
  return [SYSTEM_PROMPT, languageLine(extra?.lang || ""), avoid, `Clock: ${clock} Asia/Riyadh.`].filter(Boolean).join("\n");
}

export { HISTORY_MESSAGES };

export type WebTts = "browser" | "gemini" | "elevenlabs";

export function geminiApiKey(): string {
  return (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
}

export function geminiModel(): string {
  return (process.env.GEMINI_MODEL || "gemini-2.5-flash").trim() || "gemini-2.5-flash";
}

export function geminiModelChain(): string[] {
  return modelChain(geminiModel(), process.env.GEMINI_FALLBACK_MODELS);
}

export function voiceModelChain(): string[] {
  return voiceChain(geminiModel(), process.env.GEMINI_FALLBACK_MODELS);
}

export type SttProvider = "scribe" | "browser";

export function sttProvider(): SttProvider {
  return (process.env.ELEVENLABS_API_KEY || "").trim() ? "scribe" : "browser";
}

export function chatLang(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const raw = (body as { lang?: unknown }).lang;
  if (typeof raw !== "string") return "";
  const lang = raw.trim().toLowerCase().slice(0, 16);
  if (!/^[a-z][a-z-]{0,15}$/.test(lang)) return "";
  return lang;
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

export function logChatModelFailure(model: string, error: unknown): void {
  const secrets = [geminiApiKey(), (process.env.ELEVENLABS_API_KEY || "").trim()].filter(Boolean);
  logModelFailure(model, error, secrets);
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
