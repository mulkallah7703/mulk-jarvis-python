import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  INTRO_MS,
  PULSE_MS,
  TINT_MS,
  awakenAge,
  easeOutCubic,
  hudRingCount,
  hudStateLabel,
  hudTone,
  isIntroSkipped,
  resetAwakenForTests,
  resetIntroForTests,
  rippleBand,
  skipIntro,
  tintFor,
  tintParticle,
  triggerAwaken,
} from "./presentation.ts";

describe("presentation", () => {
  it("eases the intro over about 2.2 seconds and finishes at 1", () => {
    assert.ok(INTRO_MS >= 2000 && INTRO_MS <= 2500);
    assert.equal(easeOutCubic(0), 0);
    assert.ok(easeOutCubic(0.5) > 0.5);
    assert.equal(easeOutCubic(1), 1);
    assert.equal(easeOutCubic(2), 1);
    assert.equal(TINT_MS, 400);
    assert.equal(PULSE_MS, 1000);
  });

  it("keeps idle on the original color, shifts listening toward teal, and gold toward a soft gold", () => {
    const idle = tintFor("idle");
    const listening = tintFor("listening");
    const speaking = tintFor("speaking");
    assert.equal(idle.amount, 0);
    assert.ok(listening.g > listening.r && listening.b > 160);
    assert.ok(speaking.r > speaking.b && speaking.g > 140);
    const out = { r: 0, g: 0, b: 0 };
    tintParticle(40, 80, 180, 0, listening.r, listening.g, listening.b, listening.amount, out);
    assert.ok(out.g > 80);
    assert.ok(out.b > 160);
    const face = { r: 0, g: 0, b: 0 };
    tintParticle(40, 80, 180, 2, speaking.r, speaking.g, speaking.b, speaking.amount, face);
    const body = { r: 0, g: 0, b: 0 };
    tintParticle(40, 80, 180, 0, speaking.r, speaking.g, speaking.b, speaking.amount, body);
    assert.ok(Math.abs(face.b - 180) < Math.abs(body.b - 180));
    const gold = { r: 0, g: 0, b: 0 };
    tintParticle(210, 150, 60, 0, listening.r, listening.g, listening.b, listening.amount, gold);
    assert.ok(gold.r > 180);
    assert.ok(gold.b < 100);
  });

  it("labels the hud and simplifies rings on a phone width", () => {
    assert.equal(hudTone("speaking", "session"), "speaking");
    assert.equal(hudTone("listening", "session"), "listening");
    assert.equal(hudTone("listening", "wake"), "idle");
    assert.equal(hudStateLabel("listening", "session"), "LISTENING");
    assert.equal(hudStateLabel("speaking", "session"), "SPEAKING");
    assert.equal(hudStateLabel("listening", "wake"), "IDLE");
    assert.equal(hudRingCount(1440), 4);
    assert.equal(hudRingCount(390), 2);
  });

  it("skips the intro once and starts a one second wake pulse", () => {
    resetIntroForTests();
    assert.equal(isIntroSkipped(), false);
    skipIntro();
    skipIntro();
    assert.equal(isIntroSkipped(), true);
    resetAwakenForTests();
    assert.equal(awakenAge(1000), -1);
    triggerAwaken(500);
    assert.equal(awakenAge(500), 0);
    assert.equal(awakenAge(1500), 1000);
    const mid = rippleBand(40, 40, 12);
    const far = rippleBand(80, 40, 12);
    assert.ok(mid > 0.9);
    assert.ok(far < mid);
  });
});
