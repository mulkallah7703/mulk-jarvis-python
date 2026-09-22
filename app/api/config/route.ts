import { geminiApiKey, geminiModel, resolveWebTts } from "@/lib/server/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return Response.json(
    {
      hasGeminiKey: Boolean(geminiApiKey()),
      model: geminiModel(),
      tts: resolveWebTts(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
