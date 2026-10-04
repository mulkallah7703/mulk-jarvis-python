export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Opens the upstream TLS sessions. Does not call Gemini, so it does not spend the daily quota. */
export async function GET() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 800);
  await Promise.all([
    fetch("https://generativelanguage.googleapis.com/", { method: "HEAD", signal: controller.signal }).catch(() => undefined),
    fetch("https://api.elevenlabs.io/", { method: "HEAD", signal: controller.signal }).catch(() => undefined),
  ]);
  clearTimeout(timer);
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
