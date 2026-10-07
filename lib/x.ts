/**
 * Local X open/post intents. Matched on the transcript before Gemini
 * so a voice command does not wait on a model round-trip.
 */

import { hasArabic } from "./text.ts";
import { normalize, stripAddress } from "./wake.ts";

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
  ["افتح", "اكس", "و", "انشر", "تغريده"],
  ["افتح", "اكس", "و", "انشر"],
  ["افتح", "اكس", "وانشر"],
  ["افتح", "اكس", "and", "انشر", "منشور"],
  ["افتح", "اكس", "and", "انشر"],
  ["افتح", "اكس", "انشر", "منشور"],
  ["افتح", "اكس", "انشر", "تغريده"],
  ["افتح", "اكس", "انشر"],
  ["افتح", "x", "وانشر", "منشور"],
  ["افتح", "x", "وانشر"],
  ["افتح", "x", "انشر", "منشور"],
  ["افتح", "x", "انشر"],
  ["افتح", "تويتر", "وانشر", "منشور"],
  ["افتح", "تويتر", "وانشر"],
  ["افتح", "تويتر", "انشر", "منشور"],
  ["افتح", "تويتر", "انشر"],
  ["open", "x", "and", "tweet"],
  ["open", "x", "and", "post"],
  ["open", "twitter", "and", "tweet"],
  ["open", "twitter", "and", "post"],
  ["open", "x", "tweet"],
  ["open", "x", "post"],
  ["open", "twitter", "tweet"],
  ["open", "twitter", "post"],
  ["open", "x", "and"],
  ["open", "twitter", "and"],
  ["افتح", "اكس", "و"],
  ["افتح", "اكس", "سوي", "نشر", "منشور"],
  ["افتح", "اكس", "و", "سوي", "نشر", "منشور"],
  ["افتح", "اكس", "سوي", "نشر"],
  ["افتح", "اكس", "و", "سوي", "نشر"],
  ["سوي", "نشر", "منشور"],
  ["سوي", "لي", "نشر", "منشور"],
  ["سوي", "نشر"],
  ["سوي", "لي", "نشر"],
  ["سو", "نشر", "منشور"],
  ["سو", "نشر"],
  ["سوي", "منشور"],
  ["اعمل", "نشر", "منشور"],
  ["اعمل", "منشور"],
];

/**
 * Speech-to-text swaps "and"/"اكس" and sometimes glues "افتح إكس" into one word.
 * Each token expands to one or more command tokens.
 */
function expandToken(piece: string): string[] {
  if (piece === "android" || piece === "اندرويد") return ["and"];
  if (piece === "عكس" || piece === "عاكس" || piece === "عكسي") return ["اكس"];
  if (piece === "افتحك" || piece === "افتحكس" || piece === "افتحاكس" || piece === "افتحاك") return ["افتح", "اكس"];
  if (piece === "وسوي") return ["و", "سوي"];
  return [piece];
}

function corePhrase(raw: string): string {
  const text = stripAddress(normalize(raw)).replace(TRAIL, "");
  return text.split(" ").filter(Boolean).flatMap(expandToken).join(" ");
}

function rawPieces(raw: string): { words: string[]; pieces: { index: number; piece: string }[] } {
  const words = raw.trim().split(/\s+/).filter(Boolean);
  const pieces: { index: number; piece: string }[] = [];
  words.forEach((word, index) => {
    for (const piece of normalize(word).split(" ").filter(Boolean)) {
      for (const expanded of expandToken(piece)) pieces.push({ index, piece: expanded });
    }
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
  "X refused the app permission, so set Read and Write in the Developer Portal, and the draft is open.",
  "The app still needs Read and Write in the Developer Portal, and the draft is open.",
  "Check Read and Write on the app in the Developer Portal, and the draft is open.",
  "X blocked the write permission, so fix it in the Developer Portal, and press Post on the draft.",
  "The Developer Portal app needs Read and Write, and the draft is already open.",
  "Permission is missing in the Developer Portal, so set Read and Write, and the draft is open.",
  "X said the app cannot write, so set Read and Write in the Developer Portal.",
  "The write permission is off in the Developer Portal, and the draft is open.",
  "Set Read and Write for the app in the Developer Portal, and the draft is open.",
  "X refused the app, so the Developer Portal needs Read and Write, and the draft is open.",
];

const DUPLICATE_EN = [
  "That exact text is already on X.",
  "X already has this post.",
  "I posted this text before, so it is already on X.",
  "Same words, and X already has them.",
  "No second copy, because this text is already on X.",
  "X kept the first one, and this text is already up.",
  "This post is already on X.",
  "I am not posting a duplicate, because X already has it.",
  "The same text is already live on X.",
  "X refused a copy, because this text is already there.",
];

const LIMITED_EN = [
  "The X posting allowance is used, so the draft is open.",
  "X is out of posting credits, so the draft is open.",
  "The write allowance is spent, so the draft is open.",
  "X stopped the extra post, so the draft is open.",
  "No posting credit left, so the draft is open.",
  "X hit its posting limit, so the draft is open.",
  "The allowance is gone, so the draft is open.",
  "X will not take another post right now, so the draft is open.",
  "Posting credit is empty, so the draft is open.",
  "X paused direct posts, so the draft is open.",
];

const DRAFT_EN = [
  "The draft is open on X, so press Post.",
  "X is open on the post, so hit Post.",
  "The hashtags are in the draft, so press Post.",
  "I opened X on your words, so press Post.",
  "The composer is ready, so hit Post.",
  "X has the draft, so press Post.",
  "Your text is in X, so hit Post.",
  "The post is waiting in X, so press Post.",
  "Opened X with the hashtags, so hit Post.",
  "The draft is up on X, so press Post.",
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
  "إكس رفض صلاحية التطبيق، وفي Developer Portal خلّه Read and Write، والمسودة مفتوحة.",
  "التطبيق يبي Read and Write في Developer Portal، والمسودة مفتوحة.",
  "شيك Read and Write للتطبيق في Developer Portal، والمسودة قدامك.",
  "إكس قافل الكتابة على التطبيق، عدلها في Developer Portal، والمسودة مفتوحة.",
  "صلاحية التطبيق في Developer Portal لازم تكون Read and Write.",
  "الكتابة مقفلة من Developer Portal، خلّها Read and Write، والمسودة مفتوحة.",
  "إكس قال التطبيق ما يكتب، عدل Read and Write في Developer Portal.",
  "صلاحية التطبيق ناقصة في Developer Portal، والمسودة مفتوحة.",
  "في Developer Portal خل التطبيق Read and Write، والمسودة مفتوحة.",
  "إكس رفض التطبيق، وDeveloper Portal يبي Read and Write.",
];

const DUPLICATE_AR = [
  "هذا النص موجود على إكس من قبل.",
  "نشرته قبل، والنص نفسه على إكس.",
  "إكس عنده هذا الكلام من قبل.",
  "ما أكرر نفس النص، وهو أصلا على إكس.",
  "النسخة الأولى على إكس، وهذا نفس الكلام.",
  "هذا المنشور طالع من قبل على إكس.",
  "إكس رافض التكرار، لأن النص موجود.",
  "نفس الكلام منشور على إكس.",
  "ما في نسخة ثانية، والنص على إكس.",
  "هذا النص طلع قبل شوي على إكس.",
];

const LIMITED_AR = [
  "حصة النشر على إكس خلصت، والمسودة مفتوحة.",
  "رصيد النشر على إكس خلص، والمسودة قدامك.",
  "إكس وقف الزيادة، والمسودة مفتوحة.",
  "ما في رصيد نشر زيادة، والمسودة مفتوحة.",
  "حد النشر على إكس وصل، والمسودة مفتوحة.",
  "إكس ما يقبل منشور زيادة الحين، والمسودة مفتوحة.",
  "رصيد الكتابة خلص، والمسودة في إكس.",
  "الحصة خلصت على إكس، والمسودة مفتوحة.",
  "إكس أوقف النشر المباشر، والمسودة مفتوحة.",
  "ما قدر يكمل النشر من الرصيد، والمسودة مفتوحة.",
];

const DRAFT_AR = [
  "المسودة في إكس، اضغط نشر.",
  "إكس مفتوح على الكلام، اضغط نشر.",
  "الهاشتاقات في المسودة، اضغط Post.",
  "فتحت إكس على المنشور، اضغط نشر.",
  "الكلام جاهز في إكس، اضغط Post.",
  "المسودة قدامك، اضغط نشر.",
  "إكس فاتح على النص، اضغط Post.",
  "حطيت المنشور في إكس، اضغط نشر.",
  "الهاشتاق في الأخير، اضغط نشر.",
  "إكس مفتوح على المسودة، اضغط Post.",
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

function poolFor(
  arabic: boolean,
  kind: "open" | "compose" | "ask" | "posted" | "failed" | "permissions" | "draft" | "duplicate" | "limited",
): string[] {
  if (kind === "ask") return arabic ? ASK_AR : ASK_EN;
  if (kind === "compose") return arabic ? COMPOSE_AR : COMPOSE_EN;
  if (kind === "posted") return arabic ? POSTED_AR : POSTED_EN;
  if (kind === "failed") return arabic ? FAILED_AR : FAILED_EN;
  if (kind === "permissions") return arabic ? PERMISSION_AR : PERMISSION_EN;
  if (kind === "draft") return arabic ? DRAFT_AR : DRAFT_EN;
  if (kind === "duplicate") return arabic ? DUPLICATE_AR : DUPLICATE_EN;
  if (kind === "limited") return arabic ? LIMITED_AR : LIMITED_EN;
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

/** Spoken when the composer is open and the direct post did not land. */
export function xDraftLine(raw: string, random: () => number = Math.random): string {
  const arabic = spokenArabic(raw);
  return pickLine(`${arabic ? "ar" : "en"}:draft`, poolFor(arabic, "draft"), random);
}

/** Spoken only when X says the app itself cannot write. */
export function xPermissionLine(raw: string, random: () => number = Math.random): string {
  const arabic = spokenArabic(raw);
  return pickLine(`${arabic ? "ar" : "en"}:permissions`, poolFor(arabic, "permissions"), random);
}

export function xDuplicateLine(raw: string, random: () => number = Math.random): string {
  const arabic = spokenArabic(raw);
  return pickLine(`${arabic ? "ar" : "en"}:duplicate`, poolFor(arabic, "duplicate"), random);
}

export function xLimitedLine(raw: string, random: () => number = Math.random): string {
  const arabic = spokenArabic(raw);
  return pickLine(`${arabic ? "ar" : "en"}:limited`, poolFor(arabic, "limited"), random);
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
