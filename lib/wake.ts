/**
 * Wake-word and stop-phrase matching. Kept in step with `jarvis/wake.py`
 * so the browser hears the same phrases as the local Python CLI.
 */

const ARABIC_MAP: Record<string, string> = {
  أ: "ا",
  إ: "ا",
  آ: "ا",
  ٱ: "ا",
  ى: "ي",
  ة: "ه",
  ؤ: "و",
  ئ: "ي",
  ـ: "",
};

const WAKE_RAW = [
  "mulk allah alsadi",
  "ملك الله السعدي",
  "mulk allah",
  "ملك الله",
  "mulkallah",
  "mulk",
  "malk",
  "molk",
  "ملك",
  "مولك",
];

const STOP_RAW = [
  "stop jarvis",
  "goodbye jarvis",
  "exit jarvis",
  "quit jarvis",
  "jarvis stop",
  "jarvis goodbye",
  "stop",
  "goodbye",
  "exit",
  "quit",
  "go to sleep",
  "shutdown",
  "shut down",
  "توقف",
  "اوقف",
  "أوقف",
  "وقف",
  "خلاص",
  "مع السلامة",
  "اوقف جارفس",
  "أوقف جارفس",
  "اوقف جارفيز",
  "وقف يا جارفس",
  "توقف يا جارفس",
  "يا جارفس توقف",
];

const EDGE_CHARS = " ،,";

export type WakeMatch = {
  remainder: string;
};

function isAlnum(ch: string): boolean {
  return /[\p{L}\p{N}]/u.test(ch);
}

function isSpace(ch: string): boolean {
  return /\s/u.test(ch);
}

export function normalize(text: string): string {
  const mapped = [...text.trim().toLowerCase()]
    .map((ch) => (Object.prototype.hasOwnProperty.call(ARABIC_MAP, ch) ? ARABIC_MAP[ch] : ch))
    .join("");
  const stripped = [...mapped.normalize("NFKD")].filter((ch) => !/\p{M}/u.test(ch)).join("");
  const cleaned = [...stripped].map((ch) => (isAlnum(ch) || isSpace(ch) ? ch : " ")).join("");
  return cleaned.replace(/\s+/g, " ").trim();
}

function phraseTokens(phrases: string[]): string[][] {
  const tokenized: string[][] = [];
  const seen = new Set<string>();
  for (const phrase of phrases) {
    const tokens = normalize(phrase).split(" ").filter(Boolean);
    const key = tokens.join("\0");
    if (tokens.length > 0 && !seen.has(key)) {
      seen.add(key);
      tokenized.push(tokens);
    }
  }
  return tokenized;
}

const WAKE_PHRASES = phraseTokens(WAKE_RAW);
const STOP_PHRASES = new Set(phraseTokens(STOP_RAW).map((tokens) => tokens.join(" ")));

function stripEdges(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && EDGE_CHARS.includes(value[start] ?? "")) start += 1;
  while (end > start && EDGE_CHARS.includes(value[end - 1] ?? "")) end -= 1;
  return value.slice(start, end);
}

function alignedTokens(text: string): { raw: string[]; pieces: { index: number; piece: string }[] } {
  const raw = text.trim().split(/\s+/).filter(Boolean);
  const pieces: { index: number; piece: string }[] = [];
  raw.forEach((word, index) => {
    for (const piece of normalize(word).split(" ").filter(Boolean)) {
      pieces.push({ index, piece });
    }
  });
  return { raw, pieces };
}

function samePhrase(tokens: string[], index: number, phrase: string[]): boolean {
  for (let offset = 0; offset < phrase.length; offset += 1) {
    if (tokens[index + offset] !== phrase[offset]) return false;
  }
  return true;
}

export function matchWake(text: string): WakeMatch | null {
  const { raw, pieces } = alignedTokens(text);
  if (pieces.length === 0) return null;
  const tokens = pieces.map((piece) => piece.piece);
  let bestIndex: number | null = null;
  let bestLength = 0;
  for (const phrase of WAKE_PHRASES) {
    const size = phrase.length;
    const limit = tokens.length - size + 1;
    for (let index = 0; index < limit; index += 1) {
      if (!samePhrase(tokens, index, phrase)) continue;
      if (bestIndex === null || index < bestIndex || (index === bestIndex && size > bestLength)) {
        bestIndex = index;
        bestLength = size;
      }
    }
  }
  if (bestIndex === null) return null;
  const end = bestIndex + bestLength;
  if (end >= pieces.length) return { remainder: "" };
  let rawStart = pieces[end]?.index ?? raw.length;
  if (pieces.slice(0, end).some((piece) => piece.index === rawStart)) rawStart += 1;
  return { remainder: stripEdges(raw.slice(rawStart).join(" ")) };
}

export function isStopPhrase(text: string): boolean {
  const polite = /\b(please|now)\b|لو سمحت|من فضلك/gi;
  const cleaned = normalize(text).replace(polite, " ").replace(/\s+/g, " ").trim();
  return STOP_PHRASES.has(cleaned);
}
