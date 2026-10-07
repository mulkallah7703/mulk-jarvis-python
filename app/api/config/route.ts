import { readXCreds } from "@/lib/x-oauth";
import { geminiApiKey, geminiModel, resolveWebTts, sttProvider } from "@/lib/server/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return Response.json(
    {
      hasGeminiKey: Boolean(geminiApiKey()),
      model: geminiModel(),
      tts: resolveWebTts(),
      stt: sttProvider(),
      xPost: Boolean(readXCreds()),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
