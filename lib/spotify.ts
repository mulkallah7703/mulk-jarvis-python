/**
 * Local Spotify open/play intents. Matched on the transcript before Gemini
 * so a voice command does not wait on a model round-trip.
 */

import { hasArabic } from "./text.ts";
import { normalize, stripAddress } from "./wake.ts";

export type SpotifyIntent = {
  kind: "open" | "play";
  query: string;
};

export type SpotifyTarget = {
  uri: string;
  web: string;
};

const SPOTIFY = "(?:ال\\s+)?spotify";
const MUSIC = "(?:ال)?(?:موسيقي|اغاني|اغنيه)";
const TRAIL = /\s+(?:please|pls|now|لو سمحت|من فضلك|الحين)$/;
const PLAY = "(?:شغل|حط|طق|سمعني|سوي|سو)";

// Longer aliases first. Web Speech often splits or misspells the name.
const SPOTIFY_ALIASES: string[][] = [
  ["spot", "a", "fi"],
  ["spot", "if", "i"],
  ["spotty", "fly"],
  ["spotify", "fly"],
  ["spoti", "fy"],
  ["spoti", "fai"],
  ["سبوتي", "فاي"],
  ["سبوت", "يفاي"],
  ["سبوت", "فاي"],
  ["السبوتيفاي"],
  ["السبوتفاي"],
  ["السبوتيفي"],
  ["سبوتيفاي"],
  ["سبوتفاي"],
  ["سبوتيفي"],
  ["سبوتفي"],
  ["spotifi"],
  ["spotifai"],
  ["spotify"],
];

function foldSpotify(text: string): string {
  const tokens = text.split(" ").filter(Boolean);
  const aliases = [...SPOTIFY_ALIASES].sort((a, b) => b.length - a.length || b.join(" ").length - a.join(" ").length);
  const folded: string[] = [];
  for (let index = 0; index < tokens.length; ) {
    const alias = aliases.find((parts) => parts.every((part, offset) => tokens[index + offset] === part));
    if (alias) {
      folded.push("spotify");
      index += alias.length;
      continue;
    }
    folded.push(tokens[index] ?? "");
    index += 1;
  }
  return folded.join(" ");
}

function corePhrase(raw: string): string {
  const text = stripAddress(normalize(raw)).replace(TRAIL, "");
  return foldSpotify(text).replace(/\s+/g, " ").trim();
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
    `^(?:open|launch|start|play)\\s+(?:up\\s+)?(?:the\\s+|my\\s+)?${SPOTIFY}$|^(?:افتح|فتح|${PLAY})\\s+(?:لي\\s+)?${SPOTIFY}$|^${SPOTIFY}$`,
  );
  if (openHome.test(text)) return { kind: "open", query: "" };

  const playGeneric = new RegExp(
    `^(?:play|put on|start)\\s+(?:some\\s+|the\\s+|a\\s+)?(?:music|songs?)(?:\\s+(?:on|in|from|via)\\s+${SPOTIFY})?$|^${PLAY}\\s+(?:لي\\s+)?${MUSIC}(?:\\s+(?:في|على|من)\\s+${SPOTIFY})?$`,
  );
  if (playGeneric.test(text)) return { kind: "play", query: "" };

  const patterns = [
    new RegExp(`^(?:play|put on|search(?:\\s+for)?)\\s+(.+?)\\s+(?:on|in|from|via)\\s+${SPOTIFY}$`),
    new RegExp(`^${SPOTIFY}\\s+(?:play|search)\\s+(.+)$`),
    new RegExp(`^(?:افتح|فتح)\\s+${SPOTIFY}\\s+(?:و\\s*)?(?:${PLAY})\\s+(?:لي\\s+)?(?:${MUSIC}\\s+)?(.+)$`),
    new RegExp(`^${PLAY}\\s+(?:لي\\s+)?${MUSIC}\\s+(.+?)(?:\\s+(?:في|على|من)\\s+${SPOTIFY})?$`),
    new RegExp(`^${PLAY}\\s+(?:لي\\s+)?(.+?)\\s+(?:في|على|من)\\s+${SPOTIFY}$`),
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

const OPEN_EN = [
  "Spotify's open, so don't just stand there.",
  "Spotify's up, and the taste is still your problem.",
  "I opened Spotify already, so keep up.",
  "Spotify's open, so pick something with a pulse.",
  "Spotify's ready, so don't stare at the menu.",
  "Opened Spotify, and the rest is on you.",
  "Spotify's open, so impress me.",
  "Fine, Spotify's open.",
  "Spotify's up, so don't blame me for the playlist.",
  "There, Spotify, before you even finished asking.",
];

const PLAY_EN = [
  "Spotify's open, and the taste is still on you.",
  "Music's waiting, so try not to pick noise.",
  "Spotify's up, so find a song with some spine.",
  "I opened Spotify, and the soundtrack is your mess.",
  "There's the music, so don't make it boring.",
  "Spotify's open on the hits, and the rest is taste.",
  "Spotify's ready, so pick something I'd tolerate.",
  "Music's on the screen, so don't freeze.",
  "I opened it, so don't embarrass the speakers.",
  "Playtime, and I'm judging quietly.",
];

const QUERY_EN = [
  "Searching Spotify for {query}, so don't skip the good part.",
  "{query} is up on Spotify, so don't waste it.",
  "{query} is loading, so don't pretend this was hard.",
  "I put {query} in Spotify, and the taste is noted.",
  "Spotify's hunting {query}, and I'm already judging the pick.",
  "{query} it is, and Spotify's open.",
  "{query} is on Spotify, so try to look like you meant it.",
  "{query}, there, so don't act surprised.",
  "Spotify's on {query}, so impress me.",
  "{query} is in the search, so keep up.",
];

const OPEN_AR = [
  "فتحت سبوتيفاي، والذوق صار عليك.",
  "سبوتيفاي قدامك، لا تضيع الوقت.",
  "فتحتها، الحين ورّينا وش تسمع.",
  "يلا، سبوتيفاي مفتوح.",
  "فتحت سبوتيفاي قبل لا تكمل.",
  "سبوتيفاي جاهز، الباقي عليك.",
  "تم الفتح، لا تقعد تتفرج.",
  "سبوتيفاي مفتوح، اختار شي يستاهل.",
  "خلاص، سبوتيفاي عندك.",
  "فتحتها، لا تقول بعدين ما لقيت.",
];

const PLAY_AR = [
  "سبوتيفاي مفتوح، اختار شي فيه ذوق.",
  "الموسيقى جاهزة، والاختيار عليك.",
  "فتحت سبوتيفاي، لا تجيب أغاني مملة.",
  "يلا نسمع، بس خلّها عدلة.",
  "سبوتيفاي قدامك، دور أغنية تستاهل.",
  "حاضر، الموسيقى هناك، لا تتفرج.",
  "فتحتها، الحين ما لك عذر.",
  "سبوتيفاي على الأشهر، والذوق عليك.",
  "الموسيقى تنتظر، لا تتأخر.",
  "يلا سبوتيفاي، وخل الذوق يكون حاضر.",
];

const QUERY_AR = [
  "أدور {query}، لا تقول إنك ناسي الاسم.",
  "{query} في سبوتيفاي، الحين.",
  "فتحت سبوتيفاي على {query}.",
  "طلبت {query}، وسبوتيفاي فتح عليها.",
  "خلاص، {query} قدامك في سبوتيفاي.",
  "أدور {query}، والذوق هذا عليك.",
  "سبوتيفاي يفتح على {query}، والباقي ذوقك.",
  "{query}، تم، دور عليها هناك.",
  "حطيت {query} في بحث سبوتيفاي.",
  "{query} جاهزة في سبوتيفاي.",
];

const lastSpotifyLine = new Map<string, number>();

export function resetSpotifyLines(): void {
  lastSpotifyLine.clear();
}

function poolFor(arabic: boolean, intent: SpotifyIntent): string[] {
  if (intent.query) return arabic ? QUERY_AR : QUERY_EN;
  if (intent.kind === "play") return arabic ? PLAY_AR : PLAY_EN;
  return arabic ? OPEN_AR : OPEN_EN;
}

function fillQuery(template: string, query: string): string {
  return template.replaceAll("{query}", query);
}

export function spotifyLine(raw: string, intent: SpotifyIntent, random: () => number = Math.random): string {
  const arabic = hasArabic(raw);
  const pool = poolFor(arabic, intent);
  const key = `${arabic ? "ar" : "en"}:${intent.query ? "query" : intent.kind}`;
  let index = Math.floor(random() * pool.length) % pool.length;
  if (index < 0) index = 0;
  const previous = lastSpotifyLine.get(key);
  if (previous !== undefined && index === previous) index = (index + 1) % pool.length;
  lastSpotifyLine.set(key, index);
  return fillQuery(pool[index] ?? pool[0] ?? "", intent.query);
}

/**
 * Ask the OS to open the Spotify app via a hidden frame, and open the web
 * player in a named tab. Returns false when the browser blocks window.open
 * (typical for a speech-recognition callback, which is not a user gesture).
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
  // A blocked popup is null. Focusing the new tab also hides this page, so
  // visibility is not proof that the desktop app opened — keep the web tab.
  if (!popup || popup.closed) return false;
  try {
    popup.opener = null;
  } catch {
    /* already severed */
  }
  return true;
}
