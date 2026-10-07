import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { matchSpotify } from "./spotify.ts";
import {
  X_HASHTAGS,
  X_LIMIT,
  composePost,
  matchX,
  resetXLines,
  xDraftLine,
  xLine,
  xPermissionLine,
  xPostedLine,
  xTarget,
} from "./x.ts";

const SAMPLE = "السلام عليكم ورحمة الله وبركاته";

describe("x intents", () => {
  it("opens X from Arabic, English, and mixed phrasing", () => {
    for (const phrase of ["افتح إكس", "افتح X", "افتح اكس", "open X", "Open X.", "kora open X", "افتح تويتر", "please open twitter"]) {
      const intent = matchX(phrase);
      assert.ok(intent, phrase);
      assert.equal(intent.kind, "open", phrase);
      assert.equal(intent.text, "", phrase);
      const target = xTarget(intent);
      assert.equal(target.web, "https://x.com", phrase);
      assert.deepEqual(target.apps, ["twitter://", "x://"], phrase);
      assert.equal(matchSpotify(phrase), null, phrase);
    }
  });

  it("keeps the post text and appends the fixed hashtags once", () => {
    for (const phrase of [`انشر منشور ${SAMPLE}`, `انشر ${SAMPLE}`, `tweet ${SAMPLE}`, `كورا انشر منشور ${SAMPLE}`]) {
      const intent = matchX(phrase);
      assert.ok(intent, phrase);
      assert.equal(intent.kind, "post", phrase);
      assert.equal(intent.text, SAMPLE, phrase);
      const target = xTarget(intent);
      assert.equal(target.text, `${SAMPLE} ${X_HASHTAGS[0]} ${X_HASHTAGS[1]}`);
      assert.equal(target.web, `https://x.com/compose/post?text=${encodeURIComponent(target.text)}`);
      assert.equal(target.apps[0]?.startsWith("twitter://post?message="), true);
      assert.equal(target.apps[1]?.startsWith("x://post?text="), true);
    }
  });

  it("posts when open and publish are in the same utterance", () => {
    for (const phrase of [
      `افتح إكس وانشر ${SAMPLE}`,
      `افتح X وانشر منشور ${SAMPLE}`,
      `open X and tweet ${SAMPLE}`,
      "open twitter and post hello there",
    ]) {
      const intent = matchX(phrase);
      assert.ok(intent, phrase);
      assert.equal(intent.kind, "post", phrase);
      assert.equal(intent.text.includes("#"), false, phrase);
    }
    const mixed = "مرحبا أنا ملك الله السعدي";
    for (const phrase of [
      `افتح اكس انشر منشور ${SAMPLE}`,
      `افتح إكس انشر ${SAMPLE}`,
      `open x and post ${mixed}`,
      `open x android post ${mixed}`,
      `Open X android tweet ${mixed}`,
    ]) {
      const intent = matchX(phrase);
      assert.ok(intent, phrase);
      assert.equal(intent.kind, "post", phrase);
      const expected = phrase.includes(SAMPLE) ? SAMPLE : mixed;
      assert.equal(intent.text, expected, phrase);
      const target = xTarget(intent);
      assert.equal(target.text, `${expected} ${X_HASHTAGS[0]} ${X_HASHTAGS[1]}`, phrase);
      assert.equal(target.web.startsWith("https://x.com/compose/post?text="), true, phrase);
    }
    assert.equal(matchX(`افتح إكس وانشر ${SAMPLE}`)?.text, SAMPLE);
    assert.equal(matchX("open twitter and post hello there")?.text, "hello there");
    assert.equal(matchX("افتح إكس")?.kind, "open");
    assert.equal(matchX("open x")?.kind, "open");
    for (const phrase of ["افتح إكس وانشر", "open X and tweet", "افتح إكس و انشر"]) {
      assert.equal(matchX(phrase)?.kind, "await", phrase);
    }
  });

  it("asks for the text when the command has no post yet", () => {
    for (const phrase of ["tweet", "انشر منشور", "انشر", "غرد", "post a tweet"]) {
      const intent = matchX(phrase);
      assert.ok(intent, phrase);
      assert.equal(intent.kind, "await", phrase);
      assert.equal(xTarget(intent).web, "https://x.com");
    }
  });

  it("does not duplicate hashtags and keeps them inside 280 characters", () => {
    const tagged = composePost(`${SAMPLE} ${X_HASHTAGS[0]} ${X_HASHTAGS[1]}`);
    assert.equal(tagged, `${SAMPLE} ${X_HASHTAGS[0]} ${X_HASHTAGS[1]}`);
    const upper = composePost(`Hello ${X_HASHTAGS[0].toUpperCase()}`);
    assert.equal(upper.endsWith(`${X_HASHTAGS[0]} ${X_HASHTAGS[1]}`), true);
    assert.equal(upper.includes(X_HASHTAGS[0].toUpperCase()), false);

    const long = composePost("ا".repeat(400));
    assert.equal(long.length <= X_LIMIT, true);
    assert.equal(long.endsWith(`${X_HASHTAGS[0]} ${X_HASHTAGS[1]}`), true);
    assert.equal(long.includes("…"), true);
  });

  it("rotates a short masculine confirmation", () => {
    const cases = [
      { raw: "open X", kind: "open" as const },
      { raw: "tweet hello", kind: "post" as const },
      { raw: "tweet", kind: "await" as const },
      { raw: "افتح إكس", kind: "open" as const },
      { raw: `انشر ${SAMPLE}`, kind: "post" as const },
      { raw: "انشر منشور", kind: "await" as const },
    ];
    for (const item of cases) {
      resetXLines();
      const intent = matchX(item.raw);
      assert.ok(intent, item.raw);
      assert.equal(intent.kind, item.kind, item.raw);
      const seen = new Set<string>();
      let previous = "";
      for (let index = 0; index < 24; index += 1) {
        const line = xLine(item.raw, intent, () => index / 24);
        assert.equal((line.match(/[.!?؟]/g) || []).length, 1, line);
        assert.equal(/جاهزة|قلتِ|أنشري/.test(line), false, line);
        assert.notEqual(line, previous);
        previous = line;
        seen.add(line);
      }
      assert.ok(seen.size >= 8 && seen.size <= 10, `${item.raw} ${seen.size}`);
    }
    resetXLines();
    const posted = xPostedLine("انشر سلام", "https://x.com/i/web/status/1", () => 0);
    assert.equal(posted.endsWith("https://x.com/i/web/status/1"), true);
    assert.equal(/جاهزة/.test(posted), false);
    resetXLines();
    const permission = xPermissionLine("انشر سلام", () => 0);
    assert.match(permission, /Access Token/);
    assert.match(permission, /Read and Write/);
    assert.equal((permission.match(/[.!?؟]/g) || []).length, 1, permission);
    assert.equal(/جاهزة|قلتِ|أنشري/.test(permission), false);
    resetXLines();
    const draft = xDraftLine(`افتح اكس انشر منشور ${SAMPLE}`, () => 0);
    assert.match(draft, /نشر|Post/);
    assert.equal(/تم النشر|Published/.test(draft), false);
    assert.equal((draft.match(/[.!?؟]/g) || []).length, 1, draft);
  });

  it("leaves ordinary sentences to Gemini", () => {
    for (const phrase of ["what is x", "open the xbox", "I might tweet later", "وش رايك في إكس", "كم الساعة", "play music"]) {
      assert.equal(matchX(phrase), null, phrase);
    }
  });
});
