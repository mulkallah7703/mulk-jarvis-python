import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { coalesceTail, feedSpeech, isTinySpeech, speechLang, type SpeechQueue } from "./text.ts";

const empty = (): SpeechQueue => ({ sent: false, held: "" });

describe("speech chunks", () => {
  it("speaks the first sentence immediately", () => {
    const fed = feedSpeech(empty(), ["قاعد أنتظرك تعطين أوردر يحرك الشغل."], false);
    assert.deepEqual(fed.emit, ["قاعد أنتظرك تعطين أوردر يحرك الشغل."]);
    assert.equal(fed.queue.held, "");
    assert.equal(fed.queue.sent, true);
  });

  it("glues a short Arabic ending onto the previous sentence", () => {
    const fed = feedSpeech(empty(), ["قاعد أنتظرك تعطين أوردر يحرك الشغل.", "وش عندك؟"], true);
    assert.equal(fed.emit.length, 1);
    assert.match(fed.emit[0] ?? "", /يحرك الشغل\. وش عندك؟$/);
    assert.equal(isTinySpeech("وش عندك؟"), true);
    assert.equal(isTinySpeech("؟"), true);
  });

  it("holds a later sentence until the reply finishes, then keeps its language context", () => {
    const first = feedSpeech(empty(), ["قاعد أنتظرك تعطين أوردر يحرك الشغل."], false);
    const held = feedSpeech(first.queue, ["وش عندك؟"], false);
    assert.deepEqual(held.emit, []);
    assert.equal(held.queue.held, "وش عندك؟");
    const done = feedSpeech(held.queue, [], true, "");
    assert.deepEqual(done.emit, ["وش عندك؟"]);
  });

  it("drops a punctuation-only tail instead of speaking it alone", () => {
    const first = feedSpeech(empty(), ["قاعد أنتظرك تعطين أوردر يحرك الشغل."], false);
    const done = feedSpeech(first.queue, [], true, "؟");
    assert.deepEqual(done.emit, []);
    assert.deepEqual(coalesceTail(["قاعد أنتظرك تعطين أوردر يحرك الشغل.", "؟"]), [
      "قاعد أنتظرك تعطين أوردر يحرك الشغل. ؟",
    ]);
  });

  it("locks the reply language instead of the tiny chunk", () => {
    assert.equal(speechLang("OK", "ar"), "ar");
    assert.equal(speechLang("وش عندك؟", undefined), "ar");
    assert.equal(speechLang("Good morning", "en"), "en");
    assert.equal(speechLang("Good morning", undefined), "en");
  });
});
