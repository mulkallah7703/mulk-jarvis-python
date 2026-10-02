/** On-device face follow. Video never leaves the browser. */

export const FACE_FOLLOW_KEY = "kora-face-follow";
export const FACE_FOLLOW_SLOW_KEY = "kora-face-follow-slow";
export const DETECT_INTERVAL_MS = 56;
export const SLOW_DETECT_MS = 70;
export const SLOW_FRAME_LIMIT = 8;
export const DETECT_WARMUP = 3;
export const FACE_HOLD_MS = 350;
export const LOOK_TAU_MS = 180;
export const MAX_YAW = (6 * Math.PI) / 180;
export const MAX_PITCH = (4 * Math.PI) / 180;

export type Look = { x: number; y: number };

export type FaceBox = {
  originX: number;
  originY: number;
  width: number;
  height: number;
};

export type FacePoint = { x: number; y: number; label?: string };

/** Latest target written by the tracker. The canvas lerps toward it. */
export const faceLook = {
  enabled: false,
  seen: false,
  x: 0,
  y: 0,
};

export function clampLook(value: number): number {
  if (value > 1) return 1;
  if (value < -1) return -1;
  if (Number.isNaN(value)) return 0;
  return value;
}

export function setFaceTarget(x: number, y: number, seen: boolean): void {
  faceLook.enabled = true;
  faceLook.seen = seen;
  faceLook.x = seen ? clampLook(x) : 0;
  faceLook.y = seen ? clampLook(y) : 0;
}

export function clearFaceLook(): void {
  faceLook.enabled = false;
  faceLook.seen = false;
  faceLook.x = 0;
  faceLook.y = 0;
}

type KeyValueStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function browserStore(kind: "localStorage" | "sessionStorage"): KeyValueStore | null {
  try {
    if (typeof window === "undefined") return null;
    return window[kind];
  } catch {
    return null;
  }
}

export function readFaceFollowEnabled(storage: KeyValueStore | null = browserStore("localStorage")): boolean {
  try {
    return storage?.getItem(FACE_FOLLOW_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeFaceFollowEnabled(on: boolean, storage: KeyValueStore | null = browserStore("localStorage")): void {
  try {
    if (!storage) return;
    if (on) storage.setItem(FACE_FOLLOW_KEY, "1");
    else storage.removeItem(FACE_FOLLOW_KEY);
  } catch {
    /* private mode */
  }
}

export function faceFollowTooSlow(storage: KeyValueStore | null = browserStore("sessionStorage")): boolean {
  try {
    return storage?.getItem(FACE_FOLLOW_SLOW_KEY) === "1";
  } catch {
    return false;
  }
}

export function markFaceFollowSlow(storage: KeyValueStore | null = browserStore("sessionStorage")): void {
  try {
    storage?.setItem(FACE_FOLLOW_SLOW_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function clearFaceFollowSlow(storage: KeyValueStore | null = browserStore("sessionStorage")): void {
  try {
    storage?.removeItem(FACE_FOLLOW_SLOW_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Unmirrored camera: a person on the right of the screen is at a small image x.
 * Positive x turns the hologram toward screen-right. Positive y tilts it downward.
 * Yaw is a small mix so a turned head still nudges the look when the face is centered.
 */
export function lookFromFace(boxX: number, boxY: number, yawHint = 0): Look {
  const posX = (0.5 - boxX) * 2;
  const posY = (boxY - 0.5) * 2;
  return {
    x: clampLook(posX * 0.8 + clampLook(yawHint) * 0.2),
    y: clampLook(posY),
  };
}

function normCoord(value: number, span: number, pixelSpace: boolean): number {
  return pixelSpace ? value / span : value;
}

export function lookFromDetection(box: FaceBox, frameW: number, frameH: number, keypoints?: FacePoint[]): Look | null {
  if (frameW < 2 || frameH < 2 || box.width <= 0 || box.height <= 0) return null;
  const pixelSpace = box.width > 2 || box.originX > 1.5 || box.originY > 1.5;
  const boxX = normCoord(box.originX + box.width / 2, frameW, pixelSpace);
  const boxY = normCoord(box.originY + box.height / 2, frameH, pixelSpace);
  let yaw = 0;
  const points = keypoints ?? [];
  if (points.length >= 3) {
    const nose = points.find((point) => point.label?.toLowerCase().includes("nose")) ?? points[2];
    const eyeA = points[0];
    const eyeB = points[1];
    if (nose && eyeA && eyeB) {
      const noseN = nose.x > 1.5 ? nose.x / frameW : nose.x;
      const eyeAx = eyeA.x > 1.5 ? eyeA.x / frameW : eyeA.x;
      const eyeBx = eyeB.x > 1.5 ? eyeB.x / frameW : eyeB.x;
      const mid = (eyeAx + eyeBx) / 2;
      const eyeSpan = Math.max(0.02, Math.abs(eyeBx - eyeAx));
      yaw = clampLook((mid - noseN) / eyeSpan);
    }
  }
  return lookFromFace(boxX, boxY, yaw);
}

export function resolveFaceSample(
  now: number,
  lastSeenAt: number,
  live: Look | null,
): { x: number; y: number; seen: boolean; lastSeenAt: number; update: boolean } {
  if (live) return { x: live.x, y: live.y, seen: true, lastSeenAt: now, update: true };
  if (lastSeenAt > 0 && now - lastSeenAt <= FACE_HOLD_MS) {
    return { x: 0, y: 0, seen: true, lastSeenAt, update: false };
  }
  return { x: 0, y: 0, seen: false, lastSeenAt: 0, update: true };
}

export function trackDetectCost(
  samples: number[],
  ms: number,
  warmupLeft: number,
): { samples: number[]; disable: boolean; warmupLeft: number } {
  if (warmupLeft > 0) return { samples, disable: false, warmupLeft: warmupLeft - 1 };
  const next = samples.length >= SLOW_FRAME_LIMIT ? samples.slice(1) : samples.slice();
  next.push(ms);
  const disable = next.length >= SLOW_FRAME_LIMIT && next.every((sample) => sample > SLOW_DETECT_MS);
  return { samples: next, disable, warmupLeft: 0 };
}

export function approach(current: number, target: number, dt: number, tau = LOOK_TAU_MS): number {
  const step = 1 - Math.exp(-Math.max(0, dt) / tau);
  return current + (target - current) * step;
}

/** Subtle desktop pointer parallax used only while the camera is off. */
export function mouseLook(mx: number, my: number, width: number, height: number): Look {
  if (width < 2 || height < 2 || mx < 0 || my < 0) return { x: 0, y: 0 };
  return {
    x: clampLook((mx / width - 0.5) * 2) * 0.35,
    y: clampLook((my / height - 0.5) * 2) * 0.22,
  };
}

export function lookAngles(followX: number, followY: number): { yawCos: number; yawSin: number; pitchSin: number } {
  const yaw = followX * MAX_YAW;
  const pitch = followY * MAX_PITCH;
  return { yawCos: Math.cos(yaw), yawSin: Math.sin(yaw), pitchSin: Math.sin(pitch) };
}

export function cameraConstraints(): { audio: false; video: MediaTrackConstraints } {
  return {
    audio: false,
    video: {
      facingMode: "user",
      width: { ideal: 320 },
      height: { ideal: 240 },
      frameRate: { ideal: 15, max: 20 },
    },
  };
}

export const CAMERA_FALLBACK: { audio: false; video: true } = { audio: false, video: true };

/**
 * Parallax warp of one home position. Stars stay shallow. Eyes pick up an extra shift.
 * `out` is reused by the frame loop so this allocates nothing.
 */
export function warpHome(
  hx: number,
  hy: number,
  kind: number,
  chestX: number,
  chestY: number,
  span: number,
  followX: number,
  followY: number,
  yawCos: number,
  yawSin: number,
  pitchSin: number,
  out: { x: number; y: number },
): void {
  if (kind === 4) {
    out.x = hx + followX * span * 0.012;
    out.y = hy + followY * span * 0.008;
    return;
  }
  const dx = hx - chestX;
  const dy = hy - chestY;
  let depth = 0.5;
  if (kind === 1) depth = 0.22;
  else if (kind === 3) depth = 1;
  else if (kind === 2) depth = 0.82;
  else {
    const dist = Math.hypot(dx, dy);
    depth = 0.42 + 0.38 * (1 - Math.min(1, dist / Math.max(1, span)));
  }
  out.x = chestX + dx * yawCos - dy * yawSin * depth;
  out.y = hy + pitchSin * depth * span * 0.16 + dx * yawSin * depth * 0.08;
  if (kind === 3) {
    out.x += followX * span * 0.01;
    out.y += followY * span * 0.006;
  }
}
