import { createGoogle } from "@ai-sdk/google";
import { generateSpeech } from "ai";

import { sanitizeSpeech, speechLang } from "@/lib/text";
import { geminiApiKey, geminiTtsModel, geminiTtsVoice, logJarvisError, resolveWebTts } from "@/lib/server/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

function browserFallback(): Response {
  return Response.json({ fallback: "browser" }, { headers: { "Cache-Control": "no-store", "X-TTS": "browser" } });
}

const DEFAULT_ELEVEN_VOICE = "rPNcQ53R703tTmtue1AT";
const DEFAULT_ELEVEN_MODEL = "eleven_flash_v2_5";

function audioResponse(bytes: Uint8Array, contentType: string, provider = "server"): Response {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Response(copy, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "X-TTS": provider,
    },
  });
}

function elevenLabsKey(): string {
  return (process.env.ELEVENLABS_API_KEY || "").trim();
}

function elevenLabsVoiceId(): string {
  return (process.env.ELEVENLABS_VOICE_ID || DEFAULT_ELEVEN_VOICE).trim() || DEFAULT_ELEVEN_VOICE;
}

function elevenLabsModel(): string {
  const configured = process.env.ELEVENLABS_MODEL || process.env.ELEVENLABS_MODEL_ID || DEFAULT_ELEVEN_MODEL;
  return configured.trim() || DEFAULT_ELEVEN_MODEL;
}

function supportsLanguageCode(model: string): boolean {
  return /(?:^|_)(?:flash|turbo)_v2_5$/.test(model) || model.includes("v2_5") || model.includes("v2.5");
}

async function elevenLabs(text: string, lang: "ar" | "en", previous: string, signal: AbortSignal): Promise<Response> {
  const apiKey = elevenLabsKey();
  if (!apiKey) throw new Error("ElevenLabs key missing");
  const voiceId = elevenLabsVoiceId();
  const model = elevenLabsModel();
  const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream`);
  url.searchParams.set("optimize_streaming_latency", "3");
  const payload: {
    text: string;
    model_id: string;
    language_code?: string;
    previous_text?: string;
  } = { text, model_id: model };
  if (supportsLanguageCode(model)) payload.language_code = lang;
  if (previous) payload.previous_text = previous;
  // Bound time-to-first-byte only. Aborting the body cuts the mp3 mid-sentence.
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort);
  const timer = setTimeout(() => controller.abort(), 12_000);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    signal.removeEventListener("abort", onAbort);
    throw error;
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok || !response.body) {
    signal.removeEventListener("abort", onAbort);
    throw new Error(`ElevenLabs ${response.status}`);
  }
  const contentType = (response.headers.get("content-type") || "audio/mpeg").split(";")[0].trim();
  return new Response(response.body, {
    headers: {
      "Content-Type": contentType.startsWith("audio/") ? contentType : "audio/mpeg",
      "Cache-Control": "no-store",
      "X-TTS": "elevenlabs",
      "X-TTS-Lang": lang,
    },
  });
}

async function geminiSpeech(text: string, signal: AbortSignal): Promise<Response> {
  const apiKey = geminiApiKey();
  const google = createGoogle({ apiKey });
  const result = await generateSpeech({
    model: google.speech(geminiTtsModel()),
    text,
    voice: geminiTtsVoice(),
    outputFormat: "wav",
    maxRetries: 0,
    abortSignal: signal,
  });
  const bytes = result.audio.uint8Array;
  if (bytes.byteLength < 44) throw new Error("Gemini TTS returned no audio");
  return audioResponse(bytes, result.audio.mediaType || "audio/wav");
}

export async function POST(req: Request) {
  let text = "";
  let lang: "ar" | "en" = "en";
  let previous = "";
  let lock = false;
  try {
    const body = (await req.json()) as { text?: unknown; lang?: unknown; previous?: unknown; lock?: unknown };
    text = sanitizeSpeech(typeof body.text === "string" ? body.text : "").slice(0, 800);
    lang = speechLang(text, body.lang);
    previous = sanitizeSpeech(typeof body.previous === "string" ? body.previous : "").slice(-300);
    lock = body.lock === true;
  } catch {
    return browserFallback();
  }
  if (!text) return browserFallback();

  if (elevenLabsKey()) {
    try {
      return await elevenLabs(text, lang, previous, req.signal);
    } catch (error) {
      if (req.signal.aborted || lock) return browserFallback();
      logJarvisError("tts", error);
    }
  }

  if (resolveWebTts() === "browser") return browserFallback();

  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(20_000)]);
  const provider = resolveWebTts();
  try {
    if (provider === "gemini") return await geminiSpeech(text, signal);
  } catch (error) {
    if (!req.signal.aborted) logJarvisError("tts", error);
  }
  return browserFallback();
}
