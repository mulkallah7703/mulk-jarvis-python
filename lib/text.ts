/** Spoken-text helpers shared by the browser and the Vercel routes. */

import { normalize } from "./wake.ts";

export const GREETING = "Hi Mulk Allah!";
export const MISSING_KEY = "Add a Gemini API key to answer questions. Wake word still works.";
export const EMPTY_ANSWER = "I don't have an answer for that.";
export const REACH_ERROR = "I couldn't reach Gemini. Try again.";
export const KEY_ERROR = "Check the Gemini API key and try again.";

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

const GHOSTS = new Set(GHOST_RAW.map((phrase) => normalize(phrase)));

export function cleanTranscript(text: string): string {
  const stripped = (text || "").trim();
  if (!stripped || /^\[.*\]$/.test(stripped)) return "";
  if (GHOSTS.has(normalize(stripped))) return "";
  return stripped;
}
