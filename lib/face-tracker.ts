import {
  CAMERA_FALLBACK,
  DETECT_INTERVAL_MS,
  DETECT_WARMUP,
  cameraConstraints,
  clearFaceFollowSlow,
  clearFaceLook,
  faceFollowFailureMessage,
  lookFromDetection,
  markFaceFollowSlow,
  pickBuiltInCamera,
  readFaceCameraId,
  resolveFaceSample,
  setFaceTarget,
  trackDetectCost,
  writeFaceCameraId,
} from "./face-follow.ts";

const VISION_VERSION = "0.10.21";
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VERSION}/wasm`;
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";
const VISION_CJS = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VERSION}/vision_bundle.cjs`;

const FRAME_W = 320;
const FRAME_H = 240;

export const FACE_WORKER_SOURCE = `
self.exports = {};
self.module = { exports: self.exports };
const WASM = ${JSON.stringify(WASM_BASE)};
const MODEL = ${JSON.stringify(MODEL_URL)};
const LIB = ${JSON.stringify(VISION_CJS)};
let detector = null;
let lastTs = -1;
self.onmessage = async (event) => {
  const msg = event.data;
  if (msg.type === "init") {
    try {
      const response = await fetch(LIB);
      if (!response.ok) throw new Error("vision bundle " + response.status);
      (0, eval)(await response.text());
      const fileset = await self.exports.FilesetResolver.forVisionTasks(WASM);
      detector = await self.exports.FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL, delegate: "CPU" },
        runningMode: "VIDEO",
        minDetectionConfidence: 0.5,
      });
      self.postMessage({ type: "ready" });
    } catch (error) {
      self.postMessage({ type: "error", message: String(error && error.message || error) });
    }
    return;
  }
  if (msg.type === "frame" && detector && msg.bitmap) {
    const bitmap = msg.bitmap;
    let timestamp = msg.time || performance.now();
    if (timestamp <= lastTs) timestamp = lastTs + 1;
    lastTs = timestamp;
    const started = performance.now();
    let box = null;
    let keypoints = [];
    try {
      const result = detector.detectForVideo(bitmap, timestamp);
      const detection = result.detections && result.detections[0];
      const raw = detection && detection.boundingBox;
      if (raw && raw.width > 0 && raw.height > 0) {
        box = { originX: raw.originX, originY: raw.originY, width: raw.width, height: raw.height };
      }
      const points = detection && detection.keypoints;
      if (points && points.length) {
        keypoints = points.map((point) => ({ x: point.x, y: point.y, label: point.label }));
      }
    } catch {
      box = null;
    } finally {
      bitmap.close();
    }
    self.postMessage({
      type: "result",
      ms: performance.now() - started,
      box,
      keypoints,
      width: ${FRAME_W},
      height: ${FRAME_H},
    });
    return;
  }
  if (msg.type === "stop") {
    try { if (detector) detector.close(); } catch (error) {}
    self.close();
  }
};
`;

export type FaceTracker = { stop: () => void };

function videoConstraints(deviceId?: string): MediaTrackConstraints | boolean {
  const size = {
    width: { ideal: 320 },
    height: { ideal: 240 },
    frameRate: { ideal: 15, max: 20 },
  };
  if (!deviceId) return { ...cameraConstraints().video };
  return { ...size, deviceId: { exact: deviceId } };
}

async function requestVideo(video: MediaTrackConstraints | boolean): Promise<MediaStream> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("camera unavailable");
  }
  return navigator.mediaDevices.getUserMedia({ audio: false, video });
}

async function openDefaultCamera(): Promise<MediaStream> {
  try {
    return await requestVideo(videoConstraints());
  } catch {
    return await requestVideo(CAMERA_FALLBACK.video);
  }
}

/** Permission first, then labels. Never called on page load. */
async function preferBuiltIn(stream: MediaStream): Promise<MediaStream> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return stream;
  let listed: MediaDeviceInfo[] = [];
  try {
    listed = await navigator.mediaDevices.enumerateDevices();
  } catch {
    return stream;
  }
  const active = stream.getVideoTracks()[0]?.getSettings().deviceId || "";
  const next = pickBuiltInCamera(
    listed.filter((device) => device.kind === "videoinput").map((device) => ({
      deviceId: device.deviceId,
      label: device.label,
    })),
    active,
  );
  if (!next || next === active) return stream;
  for (const track of stream.getTracks()) track.stop();
  try {
    return await requestVideo(videoConstraints(next));
  } catch {
    return openDefaultCamera();
  }
}

async function openCamera(): Promise<MediaStream> {
  const saved = readFaceCameraId();
  let stream: MediaStream;
  if (saved) {
    try {
      stream = await requestVideo(videoConstraints(saved));
    } catch {
      stream = await openDefaultCamera();
    }
  } else {
    stream = await openDefaultCamera();
  }
  stream = await preferBuiltIn(stream);
  const chosen = stream.getVideoTracks()[0]?.getSettings().deviceId || "";
  if (chosen) writeFaceCameraId(chosen);
  return stream;
}

type WorkerResult = {
  type: string;
  ms?: number;
  message?: string;
  box?: { originX: number; originY: number; width: number; height: number } | null;
  keypoints?: { x: number; y: number; label?: string }[];
  width?: number;
  height?: number;
};

/**
 * Starts a local-only camera. Detection runs in a worker so the hologram frame
 * loop is not blocked. The stream is video only so speech recognition keeps the microphone.
 */
export async function startFaceTracker(
  video: HTMLVideoElement,
  hooks?: { onFail?: (message: string) => void },
): Promise<FaceTracker> {
  clearFaceFollowSlow();
  const stream = await openCamera();
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();

  const workerUrl = URL.createObjectURL(new Blob([FACE_WORKER_SOURCE], { type: "text/javascript" }));
  const worker = new Worker(workerUrl);
  const scratch = document.createElement("canvas");
  scratch.width = FRAME_W;
  scratch.height = FRAME_H;
  const gfx = scratch.getContext("2d", { alpha: false });
  if (!gfx) {
    worker.terminate();
    URL.revokeObjectURL(workerUrl);
    for (const track of stream.getTracks()) track.stop();
    throw new Error("canvas unavailable");
  }

  let stopped = false;
  let timer = 0;
  let frameCallback = 0;
  let lastSeenAt = 0;
  let lastDetect = 0;
  let inflight = false;
  let costs: number[] = [];
  let warmup = DETECT_WARMUP;
  const videoWithFrames = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: () => void) => number;
    cancelVideoFrameCallback?: (handle: number) => void;
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.clearTimeout(timer);
    if (frameCallback && videoWithFrames.cancelVideoFrameCallback) {
      videoWithFrames.cancelVideoFrameCallback(frameCallback);
    }
    worker.postMessage({ type: "stop" });
    worker.terminate();
    URL.revokeObjectURL(workerUrl);
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
    clearFaceLook();
  };

  const applyResult = (message: WorkerResult) => {
    inflight = false;
    if (stopped) return;
    if (message.type === "error") {
      stop();
      hooks?.onFail?.(faceFollowFailureMessage(new Error(message.message || "face model failed")));
      return;
    }
    const cost = trackDetectCost(costs, message.ms ?? 0, warmup);
    costs = cost.samples;
    warmup = cost.warmupLeft;
    if (cost.disable) {
      markFaceFollowSlow();
      stop();
      hooks?.onFail?.(faceFollowFailureMessage(new Error("slow")));
      return;
    }
    const live = message.box
      ? lookFromDetection(message.box, message.width || FRAME_W, message.height || FRAME_H, message.keypoints)
      : null;
    const sample = resolveFaceSample(performance.now(), lastSeenAt, live);
    lastSeenAt = sample.lastSeenAt;
    if (sample.update) setFaceTarget(sample.x, sample.y, sample.seen);
  };

  worker.onmessage = (event: MessageEvent<WorkerResult>) => {
    const message = event.data;
    if (message.type === "ready") return;
    applyResult(message);
  };
  worker.onerror = () => {
    if (stopped) return;
    stop();
    hooks?.onFail?.(faceFollowFailureMessage(new Error("worker failed")));
  };

  const ready = new Promise<void>((resolve, reject) => {
    const onReady = (event: MessageEvent<WorkerResult>) => {
      if (event.data.type === "ready") {
        worker.removeEventListener("message", onReady);
        resolve();
      } else if (event.data.type === "error") {
        worker.removeEventListener("message", onReady);
        reject(new Error(event.data.message || "face model failed"));
      }
    };
    worker.addEventListener("message", onReady);
    worker.postMessage({ type: "init" });
  });
  let timeoutId = 0;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error("face model timed out")), 20000);
  });
  try {
    await Promise.race([ready, timeout]);
  } catch (error) {
    stop();
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }

  const grab = async () => {
    if (stopped || inflight || video.readyState < 2 || video.videoWidth < 2) return;
    inflight = true;
    const scale = Math.min(FRAME_W / video.videoWidth, FRAME_H / video.videoHeight);
    const dw = video.videoWidth * scale;
    const dh = video.videoHeight * scale;
    gfx.fillStyle = "#000";
    gfx.fillRect(0, 0, FRAME_W, FRAME_H);
    gfx.drawImage(video, (FRAME_W - dw) / 2, (FRAME_H - dh) / 2, dw, dh);
    try {
      const bitmap = await createImageBitmap(scratch);
      if (stopped) {
        bitmap.close();
        inflight = false;
        return;
      }
      worker.postMessage({ type: "frame", bitmap, time: performance.now() }, [bitmap]);
    } catch {
      inflight = false;
    }
  };

  const schedule = () => {
    if (stopped) return;
    if (videoWithFrames.requestVideoFrameCallback) {
      frameCallback = videoWithFrames.requestVideoFrameCallback(() => {
        if (stopped) return;
        const now = performance.now();
        if (now - lastDetect >= DETECT_INTERVAL_MS) {
          lastDetect = now;
          void grab();
        }
        schedule();
      });
      return;
    }
    timer = window.setTimeout(() => {
      lastDetect = performance.now();
      void grab();
      schedule();
    }, DETECT_INTERVAL_MS);
  };

  schedule();
  return { stop };
}
