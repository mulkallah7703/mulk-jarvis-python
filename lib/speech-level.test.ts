import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sampleSpeechLevel, waveMotion } from "./speech-level.ts";

describe("wave motion", () => {
  it("stays nearly still when idle and flows harder while speaking", () => {
    const idle = waveMotion("idle", 0);
    const listening = waveMotion("listening", 0);
    const quiet = waveMotion("speaking", 0);
    const loud = waveMotion("speaking", 1);
    assert.ok(idle.amp < 2);
    assert.ok(listening.amp > idle.amp);
    assert.ok(listening.speed > idle.speed);
    assert.ok(quiet.amp > listening.amp * 1.5);
    assert.ok(loud.amp > quiet.amp);
    assert.ok(loud.speed > quiet.speed);
  });

  it("clamps a wild analyser level", () => {
    const hi = waveMotion("speaking", 8);
    const lo = waveMotion("speaking", -3);
    assert.equal(hi.amp, waveMotion("speaking", 1).amp);
    assert.equal(lo.amp, waveMotion("speaking", 0).amp);
  });

  it("reports silence when no clip is bound", () => {
    assert.equal(sampleSpeechLevel(), 0);
  });
});
