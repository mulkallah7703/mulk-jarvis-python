import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { asksForClock, withoutUnaskedClock } from "./text.ts";

describe("unasked clock", () => {
  it("drops a trailing date and timezone when nobody asked", () => {
    const answer = withoutUnaskedClock(
      "what is the capital of Japan",
      "Tokyo. Tue 29 Sept, 19:20 Asia/Riyadh",
    );
    assert.equal(answer, "Tokyo.");
    assert.equal(withoutUnaskedClock("وش لون السماء", "زرقاء. Asia/Riyadh"), "زرقاء.");
  });

  it("keeps the clock when the question asks for it", () => {
    const time = "It's 19:20 in Riyadh. Tue 29 Sept, 19:20 Asia/Riyadh";
    assert.equal(withoutUnaskedClock("what time is it", time), time);
    assert.equal(withoutUnaskedClock("كم الساعة", time), time);
    assert.ok(asksForClock("where am I"));
    assert.equal(asksForClock("name an ocean"), false);
  });
});