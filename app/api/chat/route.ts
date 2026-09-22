import { createGoogle } from "@ai-sdk/google";
import { streamText, type ModelMessage } from "ai";

import { EMPTY_ANSWER, speakableError } from "@/lib/text";
import {
  MISSING_KEY,
  SYSTEM_PROMPT,
  geminiApiKey,
  geminiModel,
  logJarvisError,
  parseMessages,
  thinkingConfig,
} from "@/lib/server/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

function plain(text: string, status = 200): Response {
  return new Response(text, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return plain("Send a JSON body with messages.", 400);
  }
  const messages = parseMessages(body);
  if (!messages) return plain("Send at least one user message.", 400);

  const apiKey = geminiApiKey();
  if (!apiKey) return plain(MISSING_KEY);

  const modelName = geminiModel();
  const google = createGoogle({ apiKey });
  const modelMessages: ModelMessage[] = messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
  const thinking = thinkingConfig(modelName);
  const variants = thinking ? [thinking, undefined] : [undefined];
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (text: string) => {
        if (!closed && text) controller.enqueue(encoder.encode(text));
      };
      const finish = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };
      let yielded = false;
      let lastError: unknown;
      try {
        for (const variant of variants) {
          if (yielded || req.signal.aborted) break;
          try {
            const result = streamText({
              model: google(modelName),
              system: SYSTEM_PROMPT,
              messages: modelMessages,
              maxOutputTokens: 400,
              maxRetries: 0,
              abortSignal: req.signal,
              ...(modelName.toLowerCase().includes("gemini-3") ? {} : { temperature: 0.4 }),
              ...(variant ? { providerOptions: { google: { thinkingConfig: variant } } } : {}),
            });
            for await (const chunk of result.textStream) {
              if (!chunk) continue;
              yielded = true;
              send(chunk);
            }
            if (yielded) break;
          } catch (error) {
            lastError = error;
            if (yielded || req.signal.aborted) break;
          }
        }
        if (!yielded && !req.signal.aborted) {
          const message = lastError ? speakableError(lastError) : EMPTY_ANSWER;
          if (lastError) logJarvisError("chat", lastError);
          send(message);
        }
      } catch (error) {
        if (!req.signal.aborted && !yielded) {
          logJarvisError("chat", error);
          send(speakableError(error));
        }
      } finally {
        finish();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
