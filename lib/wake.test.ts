import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cleanTranscript } from "./text.ts";
import { isStopPhrase, matchWake } from "./wake.ts";

describe("wake word", () => {
  it("keeps the command spoken with the wake word", () => {
    const hit = matchWake("Hey Mulk, what time is it?");
    assert.ok(hit);
    assert.equal(hit.remainder, "what time is it?");
  });

  it("treats the full name as only a wake", () => {
    const hit = matchWake("Mulk Allah Alsadi");
    assert.ok(hit);
    assert.equal(hit.remainder, "");
  });

  it("matches Arabic wake phrases", () => {
    for (const phrase of ["ملك", "مُلْك", "ملك الله", "مولك"]) {
      const hit = matchWake(phrase);
      assert.ok(hit, phrase);
      assert.equal(hit.remainder, "", phrase);
    }
  });

  it("keeps an Arabic command after the wake", () => {
    const short = matchWake("ملك كم الساعة");
    assert.ok(short);
    assert.equal(short.remainder, "كم الساعة");
    const named = matchWake("ملك الله، كم الساعة؟");
    assert.ok(named);
    assert.equal(named.remainder, "كم الساعة؟");
  });

  it("ignores lookalikes", () => {
    assert.equal(matchWake("the milk is cold"), null);
    assert.equal(matchWake("المملكة العربية"), null);
    assert.equal(matchWake("hello there"), null);
  });

  it("accepts the malk mishear", () => {
    const hit = matchWake("malk tell me a joke");
    assert.ok(hit);
    assert.equal(hit.remainder, "tell me a joke");
  });
});

describe("stop phrases", () => {
  it("matches whole utterances only", () => {
    assert.equal(isStopPhrase("Stop Jarvis!"), true);
    assert.equal(isStopPhrase("please stop jarvis"), true);
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
