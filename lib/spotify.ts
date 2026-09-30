/**
 * Local Spotify open/play intents. Matched on the transcript before Gemini
 * so a voice command does not wait on a model round-trip.
 */

import { hasArabic } from "./text.ts";
import { normalize } from "./wake.ts";

export type SpotifyIntent = {
  kind: "open" | "play";
  query: string;
};

export type SpotifyTarget = {
  uri: string;
  web: string;
};

const SPOTIFY = "(?:spotify|سبوتيفاي|سبوتفاي|سبوتي فاي|سبوت فاي)";
const MUSIC = "(?:ال)?(?:موسيقي|اغاني|اغنيه)";
const LEAD =
  /^(?:please|pls|hey|hi|ok|okay|now|can you|could you|would you|لو سمحت|من فضلك|ياخي|يا|ابي|ابغى|ابغي|ودي|خلني|خل)\s+/;
const TRAIL = /\s+(?:please|pls|now|لو سمحت|من فضلك|الحين)$/;

function corePhrase(raw: string): string {
  let text = normalize(raw);
  for (let pass = 0; pass < 4; pass += 1) {
    const next = text.replace(LEAD, "");
    if (next === text) break;
    text = next;
  }
  text = text.replace(TRAIL, "");
  return text.replace(/\s+/g, " ").trim();
}

function cleanQuery(query: string): string {
  return query.replace(/\s+/g, " ").replace(/^(?:some|لي)\s+/, "").trim();
}

function isGenericQuery(query: string): boolean {
  return /^(?:music|songs?|موسيقي|اغاني|اغنيه|الاغاني|الموسيقي|الاغنيه)$/.test(query);
}

function originalQuery(raw: string, normalizedQuery: string): string {
  const want = normalizedQuery.split(" ").filter(Boolean);
  if (want.length === 0) return "";
  const rawWords = raw.trim().split(/\s+/);
  const flat: { index: number; piece: string }[] = [];
  rawWords.forEach((word, index) => {
    for (const piece of normalize(word).split(" ").filter(Boolean)) flat.push({ index, piece });
  });
  for (let start = 0; start <= flat.length - want.length; start += 1) {
    if (!want.every((piece, offset) => flat[start + offset]?.piece === piece)) continue;
    const from = flat[start]?.index ?? 0;
    const to = flat[start + want.length - 1]?.index ?? from;
    return rawWords
      .slice(from, to + 1)
      .join(" ")
      .replace(/[؟?!.،,]+$/u, "");
  }
  return normalizedQuery;
}

export function matchSpotify(raw: string): SpotifyIntent | null {
  const text = corePhrase(raw);
  if (!text || text.length > 140) return null;

  const openHome = new RegExp(
    `^(?:open|launch|start)\\s+(?:up\\s+)?(?:the\\s+|my\\s+)?${SPOTIFY}$|^(?:افتح|فتح)\\s+(?:لي\\s+)?${SPOTIFY}$|^${SPOTIFY}$`,
  );
  if (openHome.test(text)) return { kind: "open", query: "" };

  const playGeneric = new RegExp(
    `^(?:play|put on|start)\\s+(?:some\\s+|the\\s+|a\\s+)?(?:music|songs?)(?:\\s+(?:on|in|from|via)\\s+${SPOTIFY})?$|^(?:شغل|حط|طق|سمعني)\\s+(?:لي\\s+)?${MUSIC}(?:\\s+(?:في|على|من)\\s+${SPOTIFY})?$`,
  );
  if (playGeneric.test(text)) return { kind: "play", query: "" };

  const patterns = [
    new RegExp(`^(?:play|put on|search(?:\\s+for)?)\\s+(.+?)\\s+(?:on|in|from|via)\\s+${SPOTIFY}$`),
    new RegExp(`^${SPOTIFY}\\s+(?:play|search)\\s+(.+)$`),
    new RegExp(`^(?:افتح|فتح)\\s+${SPOTIFY}\\s+(?:و\\s*)?(?:شغل|حط)\\s+(?:لي\\s+)?(?:${MUSIC}\\s+)?(.+)$`),
    new RegExp(`^(?:شغل|حط|طق|سمعني)\\s+(?:لي\\s+)?${MUSIC}\\s+(.+?)(?:\\s+(?:في|على|من)\\s+${SPOTIFY})?$`),
    new RegExp(`^(?:شغل|حط|طق|سمعني)\\s+(?:لي\\s+)?(.+?)\\s+(?:في|على|من)\\s+${SPOTIFY}$`),
  ];
  for (const pattern of patterns) {
    const hit = text.match(pattern);
    const captured = cleanQuery(hit?.[1] || "");
    if (!captured || captured.length > 80) continue;
    if (/^(?:what|who|why|how|when|وش|ليش|كيف|متى)\b/.test(captured)) return null;
    if (isGenericQuery(captured)) return { kind: "play", query: "" };
    return { kind: "play", query: originalQuery(raw, captured) };
  }
  return null;
}

export function spotifyTarget(intent: SpotifyIntent): SpotifyTarget {
  const query = intent.query.trim() || (intent.kind === "play" ? "top hits" : "");
  if (!query) return { uri: "spotify:", web: "https://open.spotify.com" };
  const encoded = encodeURIComponent(query);
  return {
    uri: `spotify:search:${encoded}`,
    web: `https://open.spotify.com/search/${encoded}`,
  };
}

export function spotifyLine(raw: string, intent: SpotifyIntent): string {
  if (hasArabic(raw)) {
    if (intent.query) return `أدور لك على ${intent.query} في سبوتيفاي. لا تتأخر.`;
    if (intent.kind === "play") return "حاضر. سبوتيفاي مفتوح. اختار شي فيه ذوق.";
    return "فتحت سبوتيفاي. الباقي عليك.";
  }
  if (intent.query) return `Searching Spotify for ${intent.query}. Try not to skip the good part.`;
  if (intent.kind === "play") return "Spotify's open. The taste is still on you.";
  return "Spotify's open. Don't just stand there.";
}

/**
 * Ask the OS to open the Spotify app via a hidden frame, and open the web
 * player in a named tab. Returns false when the browser blocks window.open
 * (typical for a speech-recognition callback, which is not a user gesture).
 * If the app takes focus, the extra tab is closed.
 */
export function launchSpotify(target: SpotifyTarget): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  try {
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "display:none;width:0;height:0;border:0";
    frame.src = target.uri;
    document.body.append(frame);
    window.setTimeout(() => frame.remove(), 2000);
  } catch {
    /* the protocol handler is best-effort */
  }
  let popup: Window | null = null;
  try {
    popup = window.open(target.web, "kora-spotify");
  } catch {
    popup = null;
  }
  if (!popup) return false;
  try {
    popup.opener = null;
  } catch {
    /* already severed */
  }
  const closeIfAppTookFocus = () => {
    if (!document.hidden) return;
    document.removeEventListener("visibilitychange", closeIfAppTookFocus);
    try {
      popup?.close();
    } catch {
      /* the tab may already be gone */
    }
  };
  document.addEventListener("visibilitychange", closeIfAppTookFocus);
  window.setTimeout(() => document.removeEventListener("visibilitychange", closeIfAppTookFocus), 2500);
  return true;
}
