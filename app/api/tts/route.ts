import { createGoogle } from "@ai-sdk/google";
import { generateSpeech } from "ai";

import { sanitizeSpeech } from "@/lib/text";
import { geminiApiKey, geminiTtsModel, geminiTtsVoice, logJarvisError, resolveWebTts } from "@/lib/server/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

function browserFallback(): Response {
  return Response.json({ fallback: "browser" }, { headers: { "Cache-Control": "no-store", "X-TTS": "browser" } });
}

function audioResponse(bytes: Uint8Array, contentType: string): Response {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Response(copy, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "X-TTS": "server",
    },
  });
}

async function elevenLabs(text: string, signal: AbortSignal): Promise<Response> {
  const voiceId = (process.env.ELEVENLABS_VOICE_ID || "").trim();
  const apiKey = (process.env.ELEVENLABS_API_KEY || "").trim();
  const model = (process.env.ELEVENLABS_MODEL_ID || "eleven_flash_v2_5").trim() || "eleven_flash_v2_5";
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({ text, model_id: model }),
    signal,
  });
  if (!response.ok) throw new Error(`ElevenLabs ${response.status}`);
  return audioResponse(new Uint8Array(await response.arrayBuffer()), "audio/mpeg");
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
  if (resolveWebTts() === "browser") return browserFallback();

  let text = "";
  try {
    const body = (await req.json()) as { text?: unknown };
    text = sanitizeSpeech(typeof body.text === "string" ? body.text : "").slice(0, 800);
  } catch {
    return browserFallback();
  }
  if (!text) return browserFallback();

  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(20_000)]);
  const provider = resolveWebTts();
  try {
    if (provider === "elevenlabs") return await elevenLabs(text, signal);
    if (provider === "gemini") return await geminiSpeech(text, signal);
  } catch (error) {
    if (!req.signal.aborted) logJarvisError("tts", error);
  }
  return browserFallback();
}
