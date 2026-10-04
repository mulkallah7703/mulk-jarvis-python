import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { chatLang, recentReplies, systemPrompt } from "./server/settings.ts";
import { quotaPhrase, utteranceLang } from "./text.ts";

describe("voice prompt", () => {
  it("keeps Gulf dialect, forbids a repeated reply, and leaves the clock private", () => {
    const prompt = systemPrompt(new Date("2026-10-04T09:00:00Z"), {
      lang: "ar",
      replies: ["On it.", "Already handled."],
    });
    assert.match(prompt, /وش، ايش، الحين/);
    assert.match(prompt, /He just spoke Gulf Arabic/);
    assert.match(prompt, /Do not reuse this wording: On it\. \|\| Already handled\./);
    assert.match(prompt, /Clock: .+ Asia\/Riyadh\.$/);
    assert.ok(prompt.indexOf("On it.") < prompt.lastIndexOf("Clock:"));
  });

  it("reads a short language hint and the last four replies", () => {
    assert.equal(chatLang({ lang: "Mixed" }), "mixed");
    assert.equal(chatLang({ lang: "ar-SA" }), "ar-sa");
    assert.equal(chatLang({ lang: "javascript:alert" }), "");
    assert.deepEqual(
      recentReplies([
        { role: "assistant", content: "one" },
        { role: "user", content: "again" },
        { role: "assistant", content: "two" },
        { role: "assistant", content: "three" },
        { role: "assistant", content: "four" },
        { role: "assistant", content: "five" },
        { role: "user", content: "now" },
      ]),
      ["two", "three", "four", "five"],
    );
  });
});

describe("utterance language", () => {
  it("detects Gulf, English, mixed, and romanized Arabic", () => {
    assert.equal(utteranceLang("وش أخبارك", "ar"), "ar");
    assert.equal(utteranceLang("what time is it", "en"), "en");
    assert.equal(utteranceLang("وش رايك in English", "ar"), "mixed");
    assert.equal(utteranceLang("wish akhbarak", "ar"), "ar");
    assert.equal(quotaPhrase("ar", "hello"), "خلصت حصة Gemini المجانية اليوم. فعّل الفوترة وأرد عليك زين.");
    assert.match(quotaPhrase("en", "وش"), /Turn on billing/);
    assert.match(quotaPhrase("mixed", ""), /فعّل الفوترة/);
  });
});
