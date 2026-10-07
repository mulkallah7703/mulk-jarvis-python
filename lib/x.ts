/**
 * Local X open/post intents. Matched on the transcript before Gemini
 * so a voice command does not wait on a model round-trip.
 */

import { hasArabic } from "./text.ts";
import { normalize } from "./wake.ts";

export const X_HASHTAGS = ["#mulk_allah_alsadi", "#ملك_الله_السعدي"] as const;
export const X_LIMIT = 280;

export type XIntent = {
  kind: "open" | "post" | "await";
  /** Original wording of the post, before hashtags. Empty for open and await. */
  text: string;
};

export type XTarget = {
  text: string;
  web: string;
  apps: string[];
};

const LEADING_WAKE =
  /^(?:hey kora|hi kora|ya kora|يا كورا|هاي كورا|kora|cora|korra|corra|qora|kura|كورا|قورا)\s+/;
const LEAD =
  /^(?:please|pls|hey|hi|ok|okay|now|can you|could you|would you|لو سمحت|من فضلك|ياخي|يا|ابي|ابغى|ابغي|ودي|خلني|خل)\s+/;
const TRAIL = /\s+(?:please|pls|now|لو سمحت|من فضلك|الحين)$/;

const OPEN_COMMANDS = [
  "open x",
  "open twitter",
  "launch x",
  "launch twitter",
  "start x",
  "افتح x",
  "افتح اكس",
  "افتح تويتر",
  "فتح x",
  "فتح اكس",
  "فتح تويتر",
  "شغل x",
  "شغل اكس",
  "شغل تويتر",
];

/** Longer commands first so "انشر منشور" wins over "انشر". */
const POST_COMMANDS = [
  ["انشر", "منشور", "في", "اكس"],
  ["انشر", "منشور", "على", "اكس"],
  ["انشر", "منشور", "في", "تويتر"],
  ["انشر", "تغريده", "في", "اكس"],
  ["انشر", "تغريده"],
  ["انشر", "منشور"],
  ["انشر", "في", "اكس"],
  ["انشر", "على", "اكس"],
  ["انشر", "في", "تويتر"],
  ["انشر", "على", "تويتر"],
  ["اكتب", "تغريده"],
  ["اكتب", "منشور"],
  ["غرد", "في", "اكس"],
  ["غرد", "على", "اكس"],
  ["post", "a", "tweet"],
  ["post", "on", "x"],
  ["post", "on", "twitter"],
  ["tweet", "on", "x"],
  ["tweet", "on", "twitter"],
  ["غرد"],
  ["tweet"],
  ["انشر"],
  ["افتح", "اكس", "وانشر", "منشور"],
  ["افتح", "اكس", "وانشر", "تغريده"],
  ["افتح", "اكس", "و", "انشر", "منشور"],
  ["افتح", "اكس", "و", "انشر"],
  ["افتح", "اكس", "وانشر"],
  ["افتح", "x", "وانشر", "منشور"],
  ["افتح", "x", "وانشر"],
  ["افتح", "تويتر", "وانشر", "منشور"],
  ["افتح", "تويتر", "وانشر"],
  ["open", "x", "and", "tweet"],
  ["open", "x", "and", "post"],
  ["open", "twitter", "and", "tweet"],
  ["open", "twitter", "and", "post"],
];

function corePhrase(raw: string): string {
  let text = normalize(raw);
  for (let pass = 0; pass < 3; pass += 1) {
    const next = text.replace(LEADING_WAKE, "").trim();
    if (next === text) break;
    text = next;
  }
  for (let pass = 0; pass < 4; pass += 1) {
    const next = text.replace(LEAD, "");
    if (next === text) break;
    text = next;
  }
  return text.replace(TRAIL, "").replace(/\s+/g, " ").trim();
}

function rawPieces(raw: string): { words: string[]; pieces: { index: number; piece: string }[] } {
  const words = raw.trim().split(/\s+/).filter(Boolean);
  const pieces: { index: number; piece: string }[] = [];
  words.forEach((word, index) => {
    for (const piece of normalize(word).split(" ").filter(Boolean)) pieces.push({ index, piece });
  });
  return { words, pieces };
}

function skipPrefix(raw: string, phrase: string): { words: string[]; pieces: { index: number; piece: string }[]; start: number } | null {
  const text = corePhrase(raw);
  const tokens = text.split(" ").filter(Boolean);
  const command = phrase.split(" ").filter(Boolean);
  if (command.length === 0 || tokens.length < command.length) return null;
  if (!command.every((part, index) => tokens[index] === part)) return null;
  const aligned = rawPieces(raw);
  let seen = 0;
  let start = 0;
  for (const piece of aligned.pieces) {
    if (seen >= command.length) break;
    if (piece.piece === command[seen]) {
      seen += 1;
      start = piece.index + 1;
    }
  }
  if (seen < command.length) return null;
  return { ...aligned, start };
}

function originalRest(raw: string, command: string[]): string {
  const skipped = skipPrefix(raw, command.join(" "));
  if (!skipped) return "";
  return skipped.words
    .slice(skipped.start)
    .join(" ")
    .replace(/^[؟?!.،,\s]+/u, "")
    .replace(/[؟?!.،,\s]+$/u, "")
    .trim();
}

function commandAtStart(text: string, command: string[]): boolean {
  const tokens = text.split(" ").filter(Boolean);
  return command.length > 0 && command.every((part, index) => tokens[index] === part);
}

export function matchX(raw: string): XIntent | null {
  const text = corePhrase(raw);
  if (!text || text.length > 2000) return null;
  if (OPEN_COMMANDS.includes(text)) return { kind: "open", text: "" };

  const sorted = [...POST_COMMANDS].sort((a, b) => b.length - a.length);
  for (const command of sorted) {
    if (!commandAtStart(text, command)) continue;
    const tokens = text.split(" ").filter(Boolean);
    const rest = tokens.slice(command.length).join(" ").trim();
    if (!rest) return { kind: "await", text: "" };
    const body = originalRest(raw, command);
    if (!body) return { kind: "await", text: "" };
    return { kind: "post", text: body };
  }
  return null;
}

function stripHashtag(body: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return body.replace(new RegExp(escaped, "giu"), " ");
}

/** Append the fixed hashtags and keep the whole post within 280 characters. */
export function composePost(text: string): string {
  const tags = X_HASHTAGS.join(" ");
  let body = X_HASHTAGS.reduce((current, tag) => stripHashtag(current, tag), text);
  body = body.replace(/\s+/g, " ").trim();
  const maxBody = X_LIMIT - tags.length - 1;
  if (body.length > maxBody) {
    const budget = Math.max(0, maxBody - 1);
    body = body.slice(0, budget).trimEnd();
    if (body) body = `${body}…`;
  }
  const tweet = body ? `${body} ${tags}` : tags;
  return tweet.length <= X_LIMIT ? tweet : tags;
}

export function xTarget(intent: XIntent): XTarget {
  if (intent.kind !== "post") {
    return { text: "", web: "https://x.com", apps: ["twitter://", "x://"] };
  }
  const text = composePost(intent.text);
  const encoded = encodeURIComponent(text);
  return {
    text,
    web: `https://x.com/compose/post?text=${encoded}`,
    apps: [`twitter://post?message=${encoded}`, `x://post?text=${encoded}`],
  };
}

const OPEN_EN = [
  "X is open, so don't just stare.",
  "X is up, and the timeline can wait.",
  "I opened X already, so keep up.",
  "X is open, so make it worth the scroll.",
  "X is ready, so don't hover.",
  "Opened X, and the rest is on you.",
  "X is open, so impress me.",
  "Fine, X is open.",
  "X is up, so don't blame me for the feed.",
  "There, X, before you even finished asking.",
];

const COMPOSE_EN = [
  "X is open on the post, hashtags included.",
  "The post is in X, and the hashtags are on it.",
  "I put it in X, hashtags and all.",
  "X is ready with the post and the hashtags.",
  "The draft is in X, so send it.",
  "Opened X on your words, hashtags attached.",
  "The post is waiting in X, hashtags included.",
  "X has the post, and the hashtags stay.",
  "There, the post is in X with the hashtags.",
  "I opened the composer, hashtags included.",
];

const ASK_EN = [
  "Alright, what's the post?",
  "Say the post, and I'll put it up.",
  "What's going on X?",
  "Give me the words.",
  "I'm listening, so say the post.",
  "The post, now.",
  "Tell me what to publish.",
  "Go on, what's the text?",
  "Ready, so what's the post?",
  "Say it, and I'll open X.",
];

const POSTED_EN = [
  "Posted on X.",
  "It's up on X.",
  "Done, the post is on X.",
  "Published, and the link is here.",
  "X has it.",
  "Sent, so here's the post.",
  "The post is live on X.",
  "There, it's on X.",
  "Published on X.",
  "Done, X took the post.",
];

const PERMISSION_EN = [
  "Regenerate the Access Token with Read and Write, and X is open.",
  "The token cannot write, so regenerate the Access Token with Read and Write.",
  "X refused the token, so regenerate the Access Token with Read and Write.",
  "That Access Token is read-only, so regenerate it with Read and Write.",
  "Direct post needs a new Access Token with Read and Write.",
  "Writing is off, so regenerate the Access Token with Read and Write.",
  "I opened X, and the Access Token still needs Read and Write.",
  "Renew the Access Token with Read and Write, then try the post again.",
  "The Access Token must be regenerated with Read and Write.",
  "X blocked the write, so regenerate the Access Token with Read and Write.",
];

const FAILED_EN = [
  "I couldn't post it directly, so X is open.",
  "Direct post failed, so I opened X.",
  "X refused the direct post, so the composer is open.",
  "No direct post, so X is open for you.",
  "The API missed, so I opened X instead.",
  "Couldn't send it straight, so X is open.",
  "Direct publish failed, so finish it in X.",
  "I opened X, since the direct post did not land.",
  "X is open, because the direct post failed.",
  "The post did not send, so X is open.",
];

const OPEN_AR = [
  "فتحت إكس، لا تتفرج.",
  "إكس قدامك الحين.",
  "يلا، إكس مفتوح.",
  "فتحت إكس قبل لا تكمل.",
  "إكس جاهز، الباقي عليك.",
  "تم الفتح، لا تقعد تتفرج.",
  "خلاص، إكس عندك.",
  "فتحتها، الحين ورّينا.",
  "إكس مفتوح، لا تضيع الوقت.",
  "حاضر، فتحت إكس.",
];

const COMPOSE_AR = [
  "فتحت إكس على المنشور، والهاشتاق في الأخير.",
  "المنشور جاهز في إكس، والهاشتاقات ثابتة.",
  "حطيت كلامك في إكس، والهاشتاق موجود.",
  "يلا، إكس فاتح على المنشور.",
  "تم، المنشور في إكس ومعاه الهاشتاق.",
  "فتحت النشر، والهاشتاقات في الأخير.",
  "إكس قدامك، والكلام جاهز.",
  "خلاص، المنشور مكتوب في إكس.",
  "الحين إكس مفتوح على كلامك.",
  "الهاشتاقات في آخر المنشور، وإكس مفتوح.",
];

const ASK_AR = [
  "تمام، قل المنشور الحين.",
  "وش تبي أنشر؟",
  "قل الكلام، وأنا أنشره.",
  "يلا، وش المنشور؟",
  "أعطني النص الحين.",
  "تمام، قل لي المنشور.",
  "وش أكتب في إكس؟",
  "قل اللي تبيه، والحين.",
  "جاهز، وش أنشر؟",
  "أرسل النص، وأنا أكمل.",
];

const POSTED_AR = [
  "تم النشر على إكس.",
  "نشرته، شيك الرابط.",
  "خلاص، المنشور طلع على إكس.",
  "نشرت كلامك على إكس.",
  "تم، المنشور في إكس.",
  "طلع المنشور، وهذا الرابط.",
  "نشرته الحين على إكس.",
  "خلاص، إكس استلم المنشور.",
  "تم الإرسال على إكس.",
  "يلا، المنشور صار على إكس.",
];

const PERMISSION_AR = [
  "جدد Access Token بخيار Read and Write، وإكس مفتوح.",
  "التوكن ما يكتب، جدد Access Token مع Read and Write.",
  "إكس رفض التوكن، جدده بصلاحية Read and Write.",
  "الصلاحية قراءة بس، جدد Access Token مع Read and Write.",
  "النشر وقف، جدد Access Token وخياره Read and Write.",
  "ما قدرت أنشر لأن الكتابة مقفلة، جدد Access Token.",
  "فتحت إكس، وجدد Access Token بصلاحية Read and Write.",
  "التوكن ناقص كتابة، جدده من البوابة مع Read and Write.",
  "جدد Access Token مع Read and Write، وبعدها أنشر.",
  "إكس قافل الكتابة، جدد Access Token بخيار Read and Write.",
];

const FAILED_AR = [
  "ما قدرت أنشره مباشرة، فتحت إكس.",
  "النشر المباشر ما تم، وإكس مفتوح.",
  "ما راح مباشرة، ففتحت إكس.",
  "الإرسال المباشر فشل، وإكس قدامك.",
  "ما نزل مباشرة، ففتحت إكس.",
  "إكس مفتوح، لأن النشر المباشر ما تم.",
  "حاولت أنشره وما تم، ففتحت إكس.",
  "النشر المباشر متعثر، وإكس فاتح.",
  "ما قدرت أرسله مباشرة، كمله في إكس.",
  "فتحت إكس، والإرسال المباشر ما تم.",
];

const lastXLine = new Map<string, number>();

export function resetXLines(): void {
  lastXLine.clear();
}

function poolFor(arabic: boolean, kind: "open" | "compose" | "ask" | "posted" | "failed" | "permissions"): string[] {
  if (kind === "ask") return arabic ? ASK_AR : ASK_EN;
  if (kind === "compose") return arabic ? COMPOSE_AR : COMPOSE_EN;
  if (kind === "posted") return arabic ? POSTED_AR : POSTED_EN;
  if (kind === "failed") return arabic ? FAILED_AR : FAILED_EN;
  if (kind === "permissions") return arabic ? PERMISSION_AR : PERMISSION_EN;
  return arabic ? OPEN_AR : OPEN_EN;
}

function pickLine(key: string, pool: string[], random: () => number): string {
  let index = Math.floor(random() * pool.length) % pool.length;
  if (index < 0) index = 0;
  const previous = lastXLine.get(key);
  if (previous !== undefined && index === previous) index = (index + 1) % pool.length;
  lastXLine.set(key, index);
  return pool[index] ?? pool[0] ?? "";
}

function spokenArabic(raw: string, text = ""): boolean {
  return hasArabic(`${raw} ${text}`);
}

export function xLine(raw: string, intent: XIntent, random: () => number = Math.random): string {
  const arabic = spokenArabic(raw, intent.text);
  const kind = intent.kind === "await" ? "ask" : intent.kind === "post" ? "compose" : "open";
  return pickLine(`${arabic ? "ar" : "en"}:${kind}`, poolFor(arabic, kind), random);
}

export function xPostedLine(raw: string, url: string, random: () => number = Math.random): string {
  const arabic = spokenArabic(raw, url);
  const line = pickLine(`${arabic ? "ar" : "en"}:posted`, poolFor(arabic, "posted"), random);
  return url ? `${line} ${url}` : line;
}

export function xFailedLine(raw: string, random: () => number = Math.random): string {
  const arabic = spokenArabic(raw);
  return pickLine(`${arabic ? "ar" : "en"}:failed`, poolFor(arabic, "failed"), random);
}

/** Spoken when X answers 401 or 403: the user token cannot write. */
export function xPermissionLine(raw: string, random: () => number = Math.random): string {
  const arabic = spokenArabic(raw);
  return pickLine(`${arabic ? "ar" : "en"}:permissions`, poolFor(arabic, "permissions"), random);
}

/**
 * Ask the OS to open the X app via hidden frames, and open the web page in a
 * named tab. Returns false when the browser blocks window.open.
 */
export function launchX(target: XTarget): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  for (const uri of target.apps) {
    try {
      const frame = document.createElement("iframe");
      frame.hidden = true;
      frame.setAttribute("aria-hidden", "true");
      frame.style.cssText = "display:none;width:0;height:0;border:0";
      frame.src = uri;
      document.body.append(frame);
      window.setTimeout(() => frame.remove(), 2000);
    } catch {
      /* the protocol handler is best-effort */
    }
  }
  let popup: Window | null = null;
  try {
    popup = window.open(target.web, "kora-x");
  } catch {
    popup = null;
  }
  if (!popup || popup.closed) return false;
  try {
    popup.opener = null;
  } catch {
    /* already severed */
  }
  return true;
}
