import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createVad } from "./vad.ts";
import { downsample, encodeWav, speechToWav } from "./wav.ts";

const fast = {
  silenceMs: 800,
  minSpeechMs: 280,
  maxUtteranceMs: 1500,
  minRms: 0.01,
  multiplier: 2.8,
  startFactor: 0.72,
  initialNoise: 0.01,
};

describe("energy vad", () => {
  it("ignores a quiet room", () => {
    const vad = createVad(fast);
    for (let step = 0; step < 10; step += 1) assert.equal(vad.push(0.002, 100), "idle");
  });

  it("drops a short blip instead of sending it", () => {
    const vad = createVad(fast);
    assert.equal(vad.push(0.2, 100), "speech");
    let last = "speech";
    for (let step = 0; step < 8; step += 1) last = vad.push(0.001, 100);
    assert.equal(last, "cancel");
  });

  it("endpoints after speech and the silence hang", () => {
    const vad = createVad(fast);
    assert.equal(vad.push(0.2, 100), "speech");
    assert.equal(vad.push(0.2, 200), "speech");
    let last = "speech";
    for (let step = 0; step < 8; step += 1) last = vad.push(0.001, 100);
    assert.equal(last, "endpoint");
  });

  it("closes a long utterance at the max length", () => {
    const vad = createVad(fast);
    let last = "idle";
    for (let step = 0; step < 15; step += 1) last = vad.push(0.2, 100);
    assert.equal(last, "endpoint");
  });

  it("does not open on noise that sits under the adapted floor", () => {
    const vad = createVad({ ...fast, initialNoise: 0.05, minRms: 0.01 });
    for (let step = 0; step < 8; step += 1) assert.equal(vad.push(0.08, 100), "idle");
    assert.equal(vad.push(0.3, 100), "speech");
  });
});

describe("wav", () => {
  it("writes a mono PCM header and the sample count", () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -1]), 16_000);
    assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
    assert.equal(String.fromCharCode(...wav.slice(8, 12)), "WAVE");
    assert.equal(wav.length, 44 + 6);
  });

  it("downsamples to 16 kHz before upload", () => {
    const input = new Float32Array(4800);
    input.fill(0.25);
    const reduced = downsample(input, 48_000, 16_000);
    assert.equal(reduced.length, 1600);
    const wav = speechToWav(input, 48_000);
    assert.equal(wav.length, 44 + 1600 * 2);
  });
});
