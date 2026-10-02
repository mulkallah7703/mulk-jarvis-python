import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CAMERA_FALLBACK,
  DETECT_WARMUP,
  FACE_FOLLOW_KEY,
  FACE_HOLD_MS,
  MAX_YAW,
  SLOW_DETECT_MS,
  SLOW_FRAME_LIMIT,
  approach,
  cameraConstraints,
  clearFaceLook,
  faceLook,
  lookAngles,
  lookFromDetection,
  lookFromFace,
  mouseLook,
  readFaceFollowEnabled,
  resolveFaceSample,
  setFaceTarget,
  trackDetectCost,
  warpHome,
  writeFaceFollowEnabled,
} from "./face-follow.ts";

function memory() {
  const data = new Map<string, string>();
  return {
    data,
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
    removeItem(key: string) {
      data.delete(key);
    },
  };
}

describe("face follow", () => {
  it("remembers the opt-in only as an explicit on flag", () => {
    const store = memory();
    assert.equal(readFaceFollowEnabled(store), false);
    writeFaceFollowEnabled(true, store);
    assert.equal(store.data.get(FACE_FOLLOW_KEY), "1");
    assert.equal(readFaceFollowEnabled(store), true);
    writeFaceFollowEnabled(false, store);
    assert.equal(readFaceFollowEnabled(store), false);
  });

  it("turns toward the side of the screen the face occupies", () => {
    const right = lookFromFace(0.2, 0.5, 0);
    const left = lookFromFace(0.8, 0.5, 0);
    const above = lookFromFace(0.5, 0.2, 0);
    assert.ok(right.x > 0.4);
    assert.ok(left.x < -0.4);
    assert.ok(above.y < -0.4);
    assert.equal(lookFromFace(0.5, 0.5, 1).x, 0.2);
    assert.equal(lookFromFace(5, 5, 9).x, -1);
  });

  it("reads pixel boxes and a nose yaw hint", () => {
    const centered = lookFromDetection({ originX: 120, originY: 40, width: 80, height: 80 }, 320, 240);
    assert.ok(centered);
    assert.ok(Math.abs(centered.x) < 0.05);
    const turned = lookFromDetection({ originX: 120, originY: 40, width: 80, height: 80 }, 320, 240, [
      { x: 0.42, y: 0.4 },
      { x: 0.58, y: 0.4 },
      { x: 0.46, y: 0.5, label: "nose" },
    ]);
    assert.ok(turned);
    assert.ok(turned.x > 0);
    const normalized = lookFromDetection({ originX: 0.1, originY: 0.4, width: 0.2, height: 0.2 }, 320, 240);
    assert.ok(normalized);
    assert.ok(normalized.x > 0.3);
    assert.equal(lookFromDetection({ originX: 0, originY: 0, width: 0, height: 10 }, 320, 240), null);
  });

  it("holds the last face briefly, then eases the target back to center", () => {
    const held = resolveFaceSample(1000, 800, null);
    assert.equal(held.update, false);
    assert.equal(held.seen, true);
    const lost = resolveFaceSample(800 + FACE_HOLD_MS + 1, 800, null);
    assert.equal(lost.update, true);
    assert.equal(lost.seen, false);
    const live = resolveFaceSample(10, 0, { x: 0.4, y: -0.2 });
    assert.equal(live.update, true);
    assert.equal(live.x, 0.4);
    setFaceTarget(0.4, -0.2, true);
    assert.equal(faceLook.enabled, true);
    assert.equal(faceLook.x, 0.4);
    setFaceTarget(0, 0, false);
    assert.equal(faceLook.x, 0);
    assert.equal(faceLook.enabled, true);
    clearFaceLook();
    assert.equal(faceLook.enabled, false);
  });

  it("disables only after repeated slow detects past the warmup", () => {
    let samples: number[] = [];
    let warmup = DETECT_WARMUP;
    for (let i = 0; i < DETECT_WARMUP; i += 1) {
      const step = trackDetectCost(samples, 400, warmup);
      samples = step.samples;
      warmup = step.warmupLeft;
      assert.equal(step.disable, false);
    }
    let disabled = false;
    for (let i = 0; i < SLOW_FRAME_LIMIT; i += 1) {
      const step = trackDetectCost(samples, SLOW_DETECT_MS + 5, warmup);
      samples = step.samples;
      warmup = step.warmupLeft;
      disabled = step.disable;
    }
    assert.equal(disabled, true);
    const fast = trackDetectCost(Array(SLOW_FRAME_LIMIT).fill(10), 12, 0);
    assert.equal(fast.disable, false);
  });

  it("requests the camera without a microphone", () => {
    const video = cameraConstraints();
    assert.equal(video.audio, false);
    assert.equal(video.video.facingMode, "user");
    const frame = video.video.frameRate as { ideal: number; max: number };
    assert.ok(frame.ideal >= 15 && frame.ideal <= 20);
    assert.equal(CAMERA_FALLBACK.audio, false);
    assert.equal(CAMERA_FALLBACK.video, true);
  });

  it("lerps and keeps the head turn within a few degrees", () => {
    const mid = approach(0, 1, 180);
    assert.ok(mid > 0.6 && mid < 0.7);
    assert.ok(MAX_YAW < (8 * Math.PI) / 180);
    const idle = mouseLook(-1, -1, 100, 100);
    assert.equal(idle.x, 0);
    const pointer = mouseLook(100, 50, 100, 100);
    assert.ok(pointer.x > 0 && pointer.x < 0.5);
  });

  it("rotates the head toward the user and shifts the eyes a little further", () => {
    const out = { x: 0, y: 0 };
    const chestX = 400;
    const chestY = 400;
    const span = 800;
    const head = { x: 400, y: 220 };
    warpHome(head.x, head.y, 2, chestX, chestY, span, 0, 0, 1, 0, 0, out);
    assert.equal(out.x, head.x);
    assert.equal(out.y, head.y);
    const ang = lookAngles(1, 1);
    warpHome(head.x, head.y, 2, chestX, chestY, span, 1, 1, ang.yawCos, ang.yawSin, ang.pitchSin, out);
    const headX = out.x;
    const headY = out.y;
    assert.ok(headX > head.x);
    assert.ok(headY > head.y);
    warpHome(head.x, head.y, 3, chestX, chestY, span, 1, 1, ang.yawCos, ang.yawSin, ang.pitchSin, out);
    assert.ok(out.x > headX);
    assert.ok(out.y > headY);
    warpHome(head.x, head.y, 4, chestX, chestY, span, 1, 0, ang.yawCos, ang.yawSin, 0, out);
    const starShift = out.x - head.x;
    const headShift = headX - head.x;
    assert.ok(starShift > 0);
    assert.ok(starShift < headShift);
    warpHome(head.x, head.y, 1, chestX, chestY, span, 1, 0, ang.yawCos, ang.yawSin, 0, out);
    assert.ok(out.x - head.x < headShift);
  });
});
