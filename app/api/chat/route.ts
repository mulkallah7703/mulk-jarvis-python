import { createGoogle } from "@ai-sdk/google";
import { streamText, type ModelMessage } from "ai";

import { geminiErrorStatus, isQuotaError, isTemperatureRejection } from "@/lib/gemini-models";
import { EMPTY_ANSWER, quotaPhrase, speakableError } from "@/lib/text";
import {
  MISSING_KEY,
  chatLang,
  geminiApiKey,
  isGeminiAuthError,
  logChatModelFailure,
  logJarvisError,
  parseMessages,
  recentReplies,
  shouldFallbackModel,
  systemPrompt,
  thinkingConfig,
  voiceModelChain,
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
  const lang = chatLang(body);
  const lastUser = [...messages].reverse().find((message) => message.role === "user")?.content || "";

  const apiKey = geminiApiKey();
  if (!apiKey) return plain(MISSING_KEY);

  const google = createGoogle({ apiKey });
  const modelMessages: ModelMessage[] = messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
  const system = systemPrompt(new Date(), { replies: recentReplies(messages), lang });
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
      let stop = false;
      try {
        for (const modelName of voiceModelChain()) {
          if (yielded || req.signal.aborted || stop) break;
          let temperature: number | undefined = 0.8;
          let variant = thinkingConfig(modelName);
          let strippedTemp = false;
          let strippedThinking = false;
          let advance = false;
          while (!yielded && !req.signal.aborted && !stop) {
            try {
              let announced = false;
              const result = streamText({
                model: google(modelName),
                system,
                messages: modelMessages,
                maxOutputTokens: 280,
                maxRetries: 0,
                abortSignal: req.signal,
                ...(temperature === undefined ? {} : { temperature }),
                ...(variant ? { providerOptions: { google: { thinkingConfig: variant } } } : {}),
              });
              for await (const part of result.fullStream) {
                if (part.type === "text-delta") {
                  if (!part.text) continue;
                  if (!announced) {
                    announced = true;
                    console.info(`[jarvis] chat: model=${modelName}`);
                  }
                  yielded = true;
                  send(part.text);
                } else if (part.type === "error") {
                  throw part.error instanceof Error ? part.error : new Error("Gemini request failed");
                } else if (part.type === "abort") {
                  break;
                }
              }
              if (yielded) break;
              if (variant && !strippedThinking) {
                variant = undefined;
                strippedThinking = true;
                continue;
              }
              break;
            } catch (error) {
              lastError = error;
              if (yielded || req.signal.aborted) break;
              logChatModelFailure(modelName, error);
              if (isQuotaError(error) || isGeminiAuthError(error)) {
                stop = true;
                break;
              }
              if (temperature !== undefined && !strippedTemp && isTemperatureRejection(error)) {
                temperature = undefined;
                strippedTemp = true;
                continue;
              }
              if (variant && !strippedThinking && geminiErrorStatus(error) === 400) {
                variant = undefined;
                strippedThinking = true;
                continue;
              }
              if (shouldFallbackModel(error)) {
                advance = true;
                break;
              }
              break;
            }
          }
          if (!advance) break;
        }
        if (!yielded && !req.signal.aborted) {
          if (lastError && isQuotaError(lastError)) send(quotaPhrase(lang, lastUser));
          else send(lastError ? speakableError(lastError) : EMPTY_ANSWER);
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
