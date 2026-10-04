/** Spoken-text helpers shared by the browser and the Vercel routes. */

import { normalize } from "./wake.ts";

export const GREETING = "Hi Mulk Allah!";
export const MISSING_KEY = "Add a Gemini API key to answer questions. Wake word still works.";
export const EMPTY_ANSWER = "I don't have an answer for that.";
export const REACH_ERROR = "I couldn't reach Gemini. Try again.";
export const KEY_ERROR = "Check the Gemini API key and try again.";
export const QUOTA_EN = "The free Gemini quota for today is used up. Turn on billing and I will answer properly.";
export const QUOTA_AR = "خلصت حصة Gemini المجانية اليوم. فعّل الفوترة وأرد عليك زين.";
export const HISTORY_MESSAGES = 20;

export function quotaPhrase(lang: string, text = ""): string {
  const code = (lang || "").toLowerCase();
  if (code === "en" || code.startsWith("en")) return QUOTA_EN;
  if (code === "ar" || code.startsWith("ar") || code === "mixed" || hasArabic(text)) return QUOTA_AR;
  return QUOTA_EN;
}

/** Per utterance. Romanized Gulf still counts as Arabic when the recognizer says so. */
export function utteranceLang(text: string, detected = ""): string {
  const arabic = hasArabic(text);
  const latin = /[A-Za-z]/.test(text);
  const code = (detected || "").toLowerCase();
  if (arabic && latin) return "mixed";
  if (arabic || code.startsWith("ar")) return "ar";
  if (latin || code.startsWith("en")) return "en";
  return "";
}

const ARABIC = /[\u0600-\u06FF]/;
const ABBREV = new Set(["mr", "mrs", "ms", "dr", "st", "vs", "prof", "sr", "jr"]);
const GHOST_RAW = [
  "thanks for watching",
  "thank you for watching",
  "subtitles by the amara.org community",
  "اشتركوا في القناة",
  "ترجمة نانسي قنقر",
];

export function hasArabic(text: string): boolean {
  return ARABIC.test(text || "");
}

export function ackPhrase(text: string): string {
  return hasArabic(text) ? "نعم؟" : "Yes?";
}

export function goodbyePhrase(text: string): string {
  return hasArabic(text) ? "حاضر." : "Okay.";
}

const CLOCK_ASK =
  /what\s+time|what'?s the time|whats the time|what\s+date|today'?s date|the date|where am i|where are we|what(?:'s| is) (?:my )?location|timezone|time zone|كم الساعة|كم الوقت|وش الساعة|الساعة كم|كم اليوم|وش التاريخ|التاريخ|وين انا|وين أنا|وينك|الموقع|المنطقة الزمنية/i;

const CLOCK_TAIL =
  /(?:^|\s+)(?:(?:mon|tue|wed|thu|fri|sat|sun)\w*,?\s+\d{1,2}\s+[a-z]{3,9},?\s+\d{1,2}:\d{2}(?:\s+asia\/riyadh)?|asia\/riyadh)\s*$/i;

export function asksForClock(text: string): boolean {
  return CLOCK_ASK.test(text || "");
}

export function withoutUnaskedClock(ask: string, answer: string): string {
  if (asksForClock(ask)) return answer;
  return (answer || "").replace(CLOCK_TAIL, "").replace(/\s+/g, " ").trim();
}

export function sanitizeSpeech(text: string): string {
  return (text || "").replace(/[*_`#]+/g, "").replace(/\s+/g, " ").trim();
}

export function speakableError(error: unknown): string {
  const raw = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (["api key", "api_key", "permission", "unauthenticated", "401", "403"].some((word) => raw.includes(word))) {
    return KEY_ERROR;
  }
  return REACH_ERROR;
}

function isAlpha(ch: string): boolean {
  return /\p{L}/u.test(ch);
}

function isDigit(ch: string): boolean {
  return /\p{N}/u.test(ch);
}

function isUpper(ch: string): boolean {
  return /\p{Lu}/u.test(ch);
}

function abbreviation(buf: string, dotIndex: number): boolean {
  let start = dotIndex - 1;
  while (start >= 0 && isAlpha(buf[start] ?? "")) start -= 1;
  const word = buf.slice(start + 1, dotIndex);
  return ABBREV.has(word.toLowerCase()) || word.length === 1;
}

function betweenDigits(buf: string, index: number): boolean {
  return (
    index > 0 &&
    index + 1 < buf.length &&
    isDigit(buf[index - 1] ?? "") &&
    isDigit(buf[index + 1] ?? "")
  );
}

function firstSentenceCut(buf: string): number | null {
  const stops = new Set([".", "!", "?", "؟", "…"]);
  for (let index = 0; index < buf.length; index += 1) {
    const char = buf[index] ?? "";
    if (!stops.has(char)) continue;
    if (char === "." && (betweenDigits(buf, index) || abbreviation(buf, index))) continue;
    const next = index + 1 < buf.length ? (buf[index + 1] ?? "") : "";
    if (next === "" || /\s/u.test(next) || isUpper(next)) return index + 1;
  }
  return null;
}

function clauseSpan(buf: string): [number, number] | null {
  let best: [number, number] | null = null;
  for (const sep of [", ", "، "]) {
    const found = buf.indexOf(sep, 40);
    if (found === -1) continue;
    const end = found + sep.length;
    if (!best || found < best[0]) best = [found, end];
  }
  return best;
}

export function popSentences(buf: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let rest = buf;
  while (true) {
    rest = rest.replace(/^\s+/, "");
    const cut = firstSentenceCut(rest);
    if (cut !== null) {
      const piece = rest.slice(0, cut).trim();
      rest = rest.slice(cut);
      if (piece) sentences.push(piece);
      continue;
    }
    if (rest.length >= 110) {
      const clause = clauseSpan(rest);
      if (clause) {
        const [start, end] = clause;
        const piece = rest.slice(0, start).trim();
        rest = rest.slice(end);
        if (piece) sentences.push(piece);
        continue;
      }
    }
    break;
  }
  return { sentences, rest };
}

export type SpeechQueue = { sent: boolean; held: string };

function speechLetters(text: string): number {
  return sanitizeSpeech(text).replace(/[^\p{L}\p{N}]/gu, "").length;
}

/** A short or punctuation-only tail is where a fresh TTS call loses the Arabic voice. */
export function isTinySpeech(text: string): boolean {
  return speechLetters(text) < 16;
}

export function coalesceTail(parts: string[]): string[] {
  const clean = parts.map((part) => sanitizeSpeech(part)).filter(Boolean);
  while (clean.length >= 2 && isTinySpeech(clean[clean.length - 1] ?? "")) {
    const last = clean.pop() ?? "";
    const prev = clean.pop() ?? "";
    clean.push(`${prev} ${last}`.trim());
  }
  return clean.filter((part) => speechLetters(part) > 0);
}

/**
 * First complete sentence is returned immediately so speech can start.
 * Later sentences stay held until the next one arrives, and a short tail
 * is glued onto the previous sentence instead of becoming its own call.
 */
export function feedSpeech(
  queue: SpeechQueue,
  sentences: string[],
  ended: boolean,
  rest = "",
): { queue: SpeechQueue; emit: string[] } {
  const incoming = sentences.map((sentence) => sentence.trim()).filter(Boolean);
  if (ended) {
    const tail = rest.trim();
    if (tail) incoming.push(tail);
  }
  const pieces: string[] = [];
  if (queue.held) pieces.push(queue.held);
  pieces.push(...incoming);

  if (!ended) {
    let parts = pieces.slice();
    if (parts.length >= 2 && isTinySpeech(parts[parts.length - 1] ?? "")) parts = coalesceTail(parts);
    if (!queue.sent && parts.length <= 1) {
      const only = sanitizeSpeech(parts[0] ?? "");
      if (!only || speechLetters(only) === 0) return { queue, emit: [] };
      return { queue: { sent: true, held: "" }, emit: [only] };
    }
    if (parts.length === 0) return { queue: { sent: queue.sent, held: "" }, emit: [] };
    const held = parts[parts.length - 1] ?? "";
    const emit = parts.slice(0, -1).map((part) => sanitizeSpeech(part)).filter((part) => speechLetters(part) > 0);
    return { queue: { sent: queue.sent || emit.length > 0, held }, emit };
  }

  const emit = coalesceTail(pieces);
  return { queue: { sent: queue.sent || emit.length > 0, held: "" }, emit };
}

export function speechLang(text: string, requested: unknown): "ar" | "en" {
  if (requested === "ar" || requested === "en") return requested;
  return hasArabic(text) ? "ar" : "en";
}

const GHOSTS = new Set(GHOST_RAW.map((phrase) => normalize(phrase)));

export function cleanTranscript(text: string): string {
  const stripped = (text || "").trim();
  if (!stripped || /^\[.*\]$/.test(stripped)) return "";
  if (GHOSTS.has(normalize(stripped))) return "";
  return stripped;
}
