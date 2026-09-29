import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  WAVE_BINS,
  WAVE_SCALE,
  noteWaveLevel,
  pushRawWave,
  resetWaveHistory,
  sampleSpeechLevel,
  waveOffsetAt,
} from "./speech-level.ts";

describe("scrolling waveform", () => {
  it("enters new loudness on the right and keeps older loudness on the left", () => {
    resetWaveHistory();
    for (let i = 0; i < WAVE_BINS; i += 1) pushRawWave(0);
    for (let i = 0; i < 12; i += 1) pushRawWave(1);
    assert.ok(waveOffsetAt(0) < 1);
    assert.ok(waveOffsetAt(0.8) < 1);
    assert.ok(waveOffsetAt(1) > WAVE_SCALE * 0.9);
    assert.ok(waveOffsetAt(0.97) > WAVE_SCALE * 0.5);
  });

  it("interpolates between neighboring samples", () => {
    resetWaveHistory();
    for (let i = 0; i < WAVE_BINS; i += 1) pushRawWave(i / (WAVE_BINS - 1));
    const left = waveOffsetAt(0);
    const right = waveOffsetAt(1);
    const mid = waveOffsetAt(0.5);
    assert.ok(left < 1);
    assert.ok(right > WAVE_SCALE * 0.95);
    assert.ok(Math.abs(mid - WAVE_SCALE * 0.5) < 2);
  });

  it("stays nearly flat when idle and much taller while speech is loud", () => {
    resetWaveHistory();
    let now = 1_000;
    for (let i = 0; i < WAVE_BINS + 8; i += 1) {
      noteWaveLevel("idle", now, 1);
      now += 20;
    }
    const idle = waveOffsetAt(1);
    resetWaveHistory();
    now = 1_000;
    for (let i = 0; i < WAVE_BINS + 8; i += 1) {
      noteWaveLevel("speaking", now, 1);
      now += 20;
    }
    const loud = waveOffsetAt(1);
    resetWaveHistory();
    now = 1_000;
    for (let i = 0; i < WAVE_BINS + 8; i += 1) {
      noteWaveLevel("speaking", now, 0);
      now += 20;
    }
    const quiet = waveOffsetAt(1);
    assert.ok(idle < 2);
    assert.ok(quiet < 2);
    assert.ok(loud > 24);
  });

  it("keeps the listening fallback gentler than real speech", () => {
    resetWaveHistory();
    let now = 5_000;
    for (let i = 0; i < WAVE_BINS + 8; i += 1) {
      noteWaveLevel("listening", now, 1);
      now += 20;
    }
    const listening = waveOffsetAt(1);
    assert.ok(listening > 1.5);
    assert.ok(listening < 8);
  });

  it("reports silence when no clip is bound", () => {
    assert.equal(sampleSpeechLevel(), 0);
  });
});
