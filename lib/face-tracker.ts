import {
  CAMERA_FALLBACK,
  DETECT_INTERVAL_MS,
  DETECT_WARMUP,
  cameraConstraints,
  clearFaceFollowSlow,
  clearFaceLook,
  lookFromDetection,
  markFaceFollowSlow,
  resolveFaceSample,
  setFaceTarget,
  trackDetectCost,
} from "@/lib/face-follow";

const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

type Detector = {
  detectForVideo: (
    frame: HTMLVideoElement,
    timestamp: number,
  ) => {
    detections: {
      boundingBox?: { originX: number; originY: number; width: number; height: number };
      keypoints?: { x: number; y: number; label?: string }[];
    }[];
  };
  close: () => void;
};

export type FaceTracker = { stop: () => void };

export async function cameraAlreadyGranted(): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return false;
    const status = await navigator.permissions.query({ name: "camera" as PermissionName });
    return status.state === "granted";
  } catch {
    return false;
  }
}

async function openCamera(): Promise<MediaStream> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("camera unavailable");
  }
  try {
    return await navigator.mediaDevices.getUserMedia(cameraConstraints());
  } catch {
    return await navigator.mediaDevices.getUserMedia(CAMERA_FALLBACK);
  }
}

/**
 * Starts a local-only camera and a lazily loaded face detector.
 * The stream is video only so speech recognition keeps the microphone.
 */
export async function startFaceTracker(
  video: HTMLVideoElement,
  hooks?: { onSlow?: () => void },
): Promise<FaceTracker> {
  clearFaceFollowSlow();
  const stream = await openCamera();
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();

  const vision = await import("@mediapipe/tasks-vision");
  const fileset = await vision.FilesetResolver.forVisionTasks(WASM_BASE);
  const detector = (await vision.FaceDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
    runningMode: "VIDEO",
    minDetectionConfidence: 0.5,
  })) as Detector;

  let stopped = false;
  let timer = 0;
  let frameCallback = 0;
  let lastSeenAt = 0;
  let lastTimestamp = -1;
  let lastDetect = 0;
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
    try {
      detector.close();
    } catch {
      /* already closed */
    }
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
    clearFaceLook();
  };

  const detect = () => {
    if (stopped || video.readyState < 2) return;
    const now = performance.now();
    let timestamp = now;
    if (timestamp <= lastTimestamp) timestamp = lastTimestamp + 1;
    lastTimestamp = timestamp;
    const started = performance.now();
    let live: { x: number; y: number } | null = null;
    try {
      const result = detector.detectForVideo(video, timestamp);
      const detection = result.detections[0];
      if (detection?.boundingBox) {
        live = lookFromDetection(
          detection.boundingBox,
          video.videoWidth || video.clientWidth || 1,
          video.videoHeight || video.clientHeight || 1,
          detection.keypoints,
        );
      }
    } catch {
      live = null;
    }
    const cost = trackDetectCost(costs, performance.now() - started, warmup);
    costs = cost.samples;
    warmup = cost.warmupLeft;
    if (cost.disable) {
      markFaceFollowSlow();
      stop();
      hooks?.onSlow?.();
      return;
    }
    const sample = resolveFaceSample(now, lastSeenAt, live);
    lastSeenAt = sample.lastSeenAt;
    if (sample.update) setFaceTarget(sample.x, sample.y, sample.seen);
  };

  const schedule = () => {
    if (stopped) return;
    if (videoWithFrames.requestVideoFrameCallback) {
      frameCallback = videoWithFrames.requestVideoFrameCallback(() => {
        if (stopped) return;
        const now = performance.now();
        if (now - lastDetect >= DETECT_INTERVAL_MS) {
          lastDetect = now;
          detect();
        }
        schedule();
      });
      return;
    }
    timer = window.setTimeout(() => {
      lastDetect = performance.now();
      detect();
      schedule();
    }, DETECT_INTERVAL_MS);
  };

  schedule();
  return { stop };
}
