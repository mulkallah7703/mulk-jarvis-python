import { composePost } from "@/lib/x";
import { postTweet, readXCreds, XApiError } from "@/lib/x-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function logXFailure(error: unknown): void {
  const secrets = [process.env.X_API_KEY, process.env.X_API_SECRET, process.env.X_ACCESS_TOKEN, process.env.X_ACCESS_TOKEN_SECRET]
    .map((value) => (value || "").trim())
    .filter(Boolean);
  let message = error instanceof Error ? error.message : String(error);
  if (error instanceof XApiError && error.detail) message = `${message} ${error.detail}`;
  for (const secret of secrets) message = message.split(secret).join("[key]");
  console.error(`[jarvis] x: ${message}`);
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ posted: false, reason: "bad-body" }, 400);
  }
  const raw = body && typeof body === "object" ? (body as { text?: unknown }).text : "";
  if (typeof raw !== "string" || !raw.trim()) return json({ posted: false, reason: "empty" }, 400);
  const text = composePost(raw);
  const creds = readXCreds();
  if (!creds) return json({ posted: false, reason: "unconfigured", text });
  try {
    const tweet = await postTweet(text, creds);
    return json({
      posted: true,
      id: tweet.id,
      url: `https://x.com/i/web/status/${tweet.id}`,
      text,
    });
  } catch (error) {
    logXFailure(error);
    const reason = error instanceof XApiError ? error.reason : "failed";
    return json({ posted: false, reason, text }, 502);
  }
}
