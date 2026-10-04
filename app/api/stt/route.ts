import { logJarvisError } from "@/lib/server/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

const MAX_BYTES = 4_000_000;

function elevenKey(): string {
  return (process.env.ELEVENLABS_API_KEY || "").trim();
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function transcribe(audio: ArrayBuffer, mime: string, model: string, extra: boolean, signal: AbortSignal): Promise<Response> {
  const body = new FormData();
  body.set("file", new Blob([audio], { type: mime || "audio/wav" }), "speech.wav");
  body.set("model_id", model);
  body.set("tag_audio_events", "false");
  body.set("diarize", "false");
  if (extra) body.set("timestamps_granularity", "none");
  return fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": elevenKey() },
    body,
    signal,
  });
}

export async function POST(req: Request) {
  if (!elevenKey()) return json({ error: "no-stt" }, 503);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "bad-body" }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "missing-file" }, 400);
  if (file.size <= 0 || file.size > MAX_BYTES) return json({ error: "bad-size" }, 413);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const audio = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(audio).set(bytes);
  const attempts = [
    { model: "scribe_v2", extra: true },
    { model: "scribe_v1", extra: false },
  ];
  let lastStatus = 502;
  for (const attempt of attempts) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const onAbort = () => controller.abort();
    req.signal.addEventListener("abort", onAbort);
    try {
      const response = await transcribe(audio, file.type, attempt.model, attempt.extra, controller.signal);
      lastStatus = response.status;
      if (response.ok) {
        const data = (await response.json()) as {
          text?: unknown;
          language_code?: unknown;
          language_probability?: unknown;
        };
        const text = typeof data.text === "string" ? data.text.trim() : "";
        const language = typeof data.language_code === "string" ? data.language_code.slice(0, 16) : "";
        console.info(`[jarvis] stt: model=${attempt.model} ms=${Date.now() - started} lang=${language || "unknown"}`);
        return json({
          text,
          language_code: language,
          language_probability: typeof data.language_probability === "number" ? data.language_probability : 0,
          ms: Date.now() - started,
        });
      }
      await response.body?.cancel().catch(() => undefined);
      console.info(`[jarvis] stt: model=${attempt.model} status=${response.status} ms=${Date.now() - started}`);
      if (response.status === 401 || response.status === 403) return json({ error: "stt-auth" }, 401);
      if (response.status === 429) return json({ error: "stt-busy" }, 429);
      if (response.status !== 400 && response.status !== 404) break;
    } catch (error) {
      logJarvisError("stt", error);
      break;
    } finally {
      clearTimeout(timer);
      req.signal.removeEventListener("abort", onAbort);
    }
  }
  return json({ error: "stt-failed" }, lastStatus >= 400 && lastStatus < 600 ? 502 : 502);
}
