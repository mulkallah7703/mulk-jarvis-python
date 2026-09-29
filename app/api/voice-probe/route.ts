export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VOICE_ID = "ER6QMHaBjLyek2P4dKLO";

function redact(text: string, key: string): string {
  return key ? text.split(key).join("[key]") : text;
}

export async function GET() {
  const key = (process.env.ELEVENLABS_API_KEY || "").trim();
  if (!key) {
    return Response.json({ error: "ELEVENLABS_API_KEY is unset" }, { status: 500 });
  }

  const voiceResponse = await fetch(`https://api.elevenlabs.io/v1/voices/${VOICE_ID}`, {
    headers: { "xi-api-key": key },
    cache: "no-store",
  });
  const voiceBody = redact(await voiceResponse.text(), key);
  let voiceName = "";
  let returnedVoiceId = "";
  if (voiceResponse.ok) {
    try {
      const parsed = JSON.parse(voiceBody) as { name?: string; voice_id?: string };
      voiceName = parsed.name || "";
      returnedVoiceId = parsed.voice_id || "";
    } catch {
      voiceName = "";
    }
  }

  if (!voiceResponse.ok) {
    return Response.json({
      voiceStatus: voiceResponse.status,
      voiceError: voiceBody.slice(0, 800),
    });
  }

  const ttsResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: "POST",
    headers: {
      "xi-api-key": key,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: "Hi.",
      model_id: "eleven_flash_v2_5",
      language_code: "en",
    }),
  });
  const ttsBytes = new Uint8Array(await ttsResponse.arrayBuffer());
  const ttsError = ttsResponse.ok ? "" : redact(new TextDecoder().decode(ttsBytes), key).slice(0, 800);

  return Response.json({
    voiceStatus: voiceResponse.status,
    voiceName,
    voiceId: returnedVoiceId,
    ttsStatus: ttsResponse.status,
    ttsContentType: ttsResponse.headers.get("content-type"),
    ttsBytes: ttsBytes.byteLength,
    ttsError,
  });
}
