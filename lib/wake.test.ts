import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cleanTranscript } from "./text.ts";
import { isStopPhrase, matchWake } from "./wake.ts";

describe("wake word", () => {
  it("keeps the command spoken with the wake word", () => {
    const hit = matchWake("kora what time is it");
    assert.ok(hit);
    assert.equal(hit.remainder, "what time is it");
    const hey = matchWake("Hey Kora, what time is it?");
    assert.ok(hey);
    assert.equal(hey.remainder, "what time is it?");
  });

  it("matches transcription variants", () => {
    for (const phrase of ["hey cora", "hi kora", "korra", "corra", "qora", "kura", "كورا", "قورا", "كُورا", "يا كورا", "هاي كورا", "كورة", "يا كورة"]) {
      const hit = matchWake(phrase);
      assert.ok(hit, phrase);
      assert.equal(hit.remainder, "", phrase);
    }
  });

  it("keeps an Arabic command after the wake", () => {
    const short = matchWake("كورا وش الوقت");
    assert.ok(short);
    assert.equal(short.remainder, "وش الوقت");
    const named = matchWake("يا كورا، وش الوقت؟");
    assert.ok(named);
    assert.equal(named.remainder, "وش الوقت؟");
    const heard = matchWake("كورة افتح عكس");
    assert.ok(heard);
    assert.equal(heard.remainder, "افتح عكس");
  });

  it("ignores the old wake word and lookalikes", () => {
    assert.equal(matchWake("mulk"), null);
    assert.equal(matchWake("ملك"), null);
    assert.equal(matchWake("Mulk Allah"), null);
    assert.equal(matchWake("core"), null);
    assert.equal(matchWake("corner office"), null);
    assert.equal(matchWake("chorus"), null);
    assert.equal(matchWake("hello there"), null);
  });
});

describe("stop phrases", () => {
  it("matches whole utterances only", () => {
    assert.equal(isStopPhrase("Stop Jarvis!"), true);
    assert.equal(isStopPhrase("please stop jarvis"), true);
    assert.equal(isStopPhrase("stop kora"), true);
    assert.equal(isStopPhrase("توقف كورا"), true);
    assert.equal(isStopPhrase("goodbye"), true);
    assert.equal(isStopPhrase("توقف"), true);
    assert.equal(isStopPhrase("توقف؟"), true);
    assert.equal(isStopPhrase("مع السلامة"), true);
    assert.equal(isStopPhrase("stop the music"), false);
    assert.equal(isStopPhrase("mulk what is the stop jarvis about"), false);
  });
});

describe("transcript cleanup", () => {
  it("drops silence junk and keeps real questions", () => {
    assert.equal(cleanTranscript("Thanks for watching."), "");
    assert.equal(cleanTranscript("[music]"), "");
    assert.equal(cleanTranscript("اشتركوا في القناة"), "");
    assert.equal(cleanTranscript("What time is it?"), "What time is it?");
  });
});
