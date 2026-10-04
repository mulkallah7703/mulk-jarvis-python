/** On-device face follow. Video never leaves the browser. */

export const FACE_FOLLOW_KEY = "kora-face-follow";
export const FACE_FOLLOW_SLOW_KEY = "kora-face-follow-slow";
export const FACE_CAMERA_KEY = "kora-face-camera";
export const DETECT_INTERVAL_MS = 56;
export const SLOW_DETECT_MS = 280;
export const SLOW_FRAME_LIMIT = 8;
export const DETECT_WARMUP = 3;
export const FACE_HOLD_MS = 350;
export const LOOK_TAU_MS = 180;
export const MAX_YAW = (12 * Math.PI) / 180;
export const MAX_PITCH = (6 * Math.PI) / 180;
/** Critically damped look spring, rad/s. Settles in about a fifth of a second. */
export const LOOK_OMEGA = 16;
/** Look units inside this band ease to center instead of twitching. */
export const LOOK_DEADZONE = 0.03;

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

export function readFaceCameraId(storage: KeyValueStore | null = browserStore("localStorage")): string {
  try {
    return storage?.getItem(FACE_CAMERA_KEY)?.trim() || "";
  } catch {
    return "";
  }
}

export function writeFaceCameraId(deviceId: string, storage: KeyValueStore | null = browserStore("localStorage")): void {
  try {
    if (!storage || !deviceId) return;
    storage.setItem(FACE_CAMERA_KEY, deviceId);
  } catch {
    /* private mode */
  }
}

/** Phone Link and other virtual cameras that Windows tries to wake. */
export function isLinkedCamera(label: string): boolean {
  return /phone|virtual|windows virtual camera|connected[-\s]?camera|\blink\b/i.test(label);
}

export function pickBuiltInCamera(
  devices: { deviceId: string; label: string }[],
  activeId: string,
): string {
  const usable = devices.filter((device) => device.deviceId && !isLinkedCamera(device.label));
  if (usable.length === 0) return activeId;
  if (activeId && usable.some((device) => device.deviceId === activeId)) return activeId;
  const integrated = usable.find((device) => /integrated|built-?in|facetime|truevision/i.test(device.label));
  return (integrated ?? usable[0]).deviceId;
}

export function faceFollowFailureMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error || "");
  if (/notallowed|permission|denied/i.test(text)) return "Allow the camera to follow.";
  if (/slow/i.test(text)) return "Camera follow is too slow on this device.";
  if (/timed out|model|vision|wasm|worker/i.test(text)) return "Camera follow couldn't load. Try again.";
  return "Camera follow couldn't start.";
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

export type SpringState = { x: number; v: number };

/** Continuous dead zone. Values inside `zone` become 0; 1 stays 1. */
export function lookDeadZone(value: number, zone = LOOK_DEADZONE): number {
  const mag = Math.abs(value);
  if (!(mag > zone) || Number.isNaN(value)) return 0;
  const scaled = (mag - zone) / (1 - zone);
  const clamped = scaled > 1 ? 1 : scaled;
  return value > 0 ? clamped : -clamped;
}

/**
 * Exact critically damped step toward `target` (ζ = 1). No overshoot from rest,
 * stable at uneven frame times.
 */
export function springStep(state: SpringState, target: number, dtMs: number, omega = LOOK_OMEGA): number {
  const t = Math.min(0.05, Math.max(0, dtMs) / 1000);
  const u0 = state.x - target;
  if (t === 0) return state.x;
  if (Math.abs(u0) < 1e-4 && Math.abs(state.v) < 1e-3) {
    state.x = target;
    state.v = 0;
    return target;
  }
  const decay = Math.exp(-omega * t);
  const b = state.v + omega * u0;
  state.v = (state.v - omega * b * t) * decay;
  state.x = target + (u0 + b * t) * decay;
  return state.x;
}

/** Tiny pointer nudge while the camera is off. Same head turn, much smaller. */
export function mouseLook(mx: number, my: number, width: number, height: number): Look {
  if (width < 2 || height < 2 || mx < 0 || my < 0) return { x: 0, y: 0 };
  return {
    x: clampLook((mx / width - 0.5) * 2) * 0.14,
    y: clampLook((my / height - 0.5) * 2) * 0.08,
  };
}

export function lookAngles(followX: number, followY: number): {
  yawCos: number;
  yawSin: number;
  pitchCos: number;
  pitchSin: number;
} {
  const yaw = followX * MAX_YAW;
  const pitch = followY * MAX_PITCH;
  return {
    yawCos: Math.cos(yaw),
    yawSin: Math.sin(yaw),
    pitchCos: Math.cos(pitch),
    pitchSin: Math.sin(pitch),
  };
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

/** Portrait-square location of the face, the neck pivot, and the head ellipsoid. */
export const HEAD_NX = 0.49;
export const HEAD_NY = 0.23;
export const NECK_NY = 0.39;
const HEAD_RX = 0.145;
const HEAD_RY = 0.155;
const EYE_SHIFT_X = 0.012;
const EYE_SHIFT_Y = 0.007;
const EYE_Y = 0.245;
const EYE_LEFT = 0.43;
const EYE_RIGHT = 0.53;

function smooth01(value: number): number {
  const t = value <= 0 ? 0 : value >= 1 ? 1 : value;
  return t * t * (3 - 2 * t);
}

function smoothFalloff(dist: number, inner: number, outer: number): number {
  if (dist <= inner) return 1;
  if (dist >= outer) return 0;
  return 1 - smooth01((dist - inner) / (outer - inner));
}

/**
 * 1 on the face and hair, easing off through the neck, 0 on the shoulders and torso.
 * Wave sparks and background stars never turn.
 */
export function headWeight(nx: number, ny: number, kind = 2): number {
  if (kind === 1 || kind === 4) return 0;
  const ellipse = Math.hypot((nx - HEAD_NX) / HEAD_RX, (ny - HEAD_NY) / HEAD_RY);
  let weight = smoothFalloff(ellipse, 0.7, 1.45);
  if (ny > 0.33) weight *= smoothFalloff(ny, 0.33, 0.45);
  return weight;
}

/** Soft mask over the two eyes so a gaze offset does not tear the cheeks. */
export function eyeGaze(nx: number, ny: number): number {
  const vertical = smoothFalloff(Math.abs(ny - EYE_Y), 0.018, 0.06);
  if (vertical <= 0) return 0;
  const spread = 0.0032;
  const left = Math.exp(-((nx - EYE_LEFT) * (nx - EYE_LEFT)) / spread);
  const right = Math.exp(-((nx - EYE_RIGHT) * (nx - EYE_RIGHT)) / spread);
  const lobe = left > right ? left : right;
  return vertical * lobe;
}

/**
 * Head-only yaw/pitch. Depth comes from a head ellipsoid, nudged by luminance so
 * bright features sit forward. Perspective is applied as a delta from the rest
 * pose, so a centered look does not resize the figure. `out` is reused by the frame loop.
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
  pitchCos: number,
  pitchSin: number,
  out: { x: number; y: number },
  lum = 0.55,
): void {
  if (span < 2 || kind === 1 || kind === 4) {
    out.x = hx;
    out.y = hy;
    return;
  }
  const ox = chestX - span * 0.5;
  const oy = chestY - span * 0.56;
  const nx = (hx - ox) / span;
  const ny = (hy - oy) / span;
  const weight = headWeight(nx, ny, kind);
  if (weight < 0.004) {
    out.x = hx;
    out.y = hy;
    return;
  }

  const pivotX = ox + span * HEAD_NX;
  const pivotY = oy + span * NECK_NY;
  const x = hx - pivotX;
  const y = pivotY - hy;
  const rx = span * 0.12;
  const ry = span * 0.145;
  const ex = (hx - (ox + span * HEAD_NX)) / rx;
  const ey = ((oy + span * HEAD_NY) - hy) / ry;
  const radial = ex * ex + ey * ey;
  const bulge = radial < 1 ? Math.sqrt(1 - radial) : 0;
  const lumT = lum < 0 ? 0 : lum > 1 ? 1 : lum;
  const z = span * 0.1 * bulge * (0.75 + 0.45 * lumT);

  const x1 = x * yawCos + z * yawSin;
  const z1 = -x * yawSin + z * yawCos;
  const y2 = y * pitchCos - z1 * pitchSin;
  const z2 = -y * pitchSin + z1 * pitchCos;

  const focal = span * 3.2;
  const safe = span * 0.45;
  const restDen = focal - z > safe ? focal - z : safe;
  const rotDen = focal - z2 > safe ? focal - z2 : safe;
  const restPersp = focal / restDen;
  const rotPersp = focal / rotDen;
  let dx = (x1 * rotPersp - x * restPersp) * weight;
  let dy = ((y2 * rotPersp - y * restPersp) * weight);
  if (kind === 3) {
    const gaze = eyeGaze(nx, ny);
    dx += followX * span * EYE_SHIFT_X * weight * gaze;
    dy -= followY * span * EYE_SHIFT_Y * weight * gaze;
  }
  out.x = hx + dx;
  out.y = hy - dy;
}
