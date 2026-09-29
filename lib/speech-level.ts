import type { OrbState } from "@/components/orb-state";

type CaptureAudio = HTMLAudioElement & {
  captureStream?: () => MediaStream;
};

const SAMPLE_MS = 1000 / 60;
export const WAVE_BINS = 120;
export const WAVE_SCALE = 38;

let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let timeData: Uint8Array<ArrayBuffer> | null = null;
let active = 0;

const history = new Float32Array(WAVE_BINS);
let smoothed = 0;
let lastSampleAt = 0;

export function resetWaveHistory(): void {
  history.fill(0);
  smoothed = 0;
  lastSampleAt = 0;
}

export function pushRawWave(level: number): void {
  const value = Math.max(0, Math.min(1, level));
  history.copyWithin(0, 1);
  history[WAVE_BINS - 1] = value;
}

function levelFor(mode: OrbState, now: number, speechLevel: number): number {
  if (mode === "speaking") return Math.max(0, Math.min(1, speechLevel));
  // No second microphone stream: arm() releases its getUserMedia tracks
  // before speech recognition starts, and holding another stream can steal
  // the mic from Chrome/Edge recognition. Listening uses a low traveling ripple.
  if (mode === "listening") {
    const a = 0.5 + 0.5 * Math.sin(now * 0.0023);
    const b = 0.5 + 0.5 * Math.sin(now * 0.00081 + 1.4);
    return 0.06 + 0.08 * a * b;
  }
  return 0.015 + 0.01 * (0.5 + 0.5 * Math.sin(now * 0.00032));
}

export function noteWaveLevel(mode: OrbState, now: number, speechLevel: number): void {
  const target = levelFor(mode, now, speechLevel);
  smoothed += (target - smoothed) * 0.45;
  if (lastSampleAt === 0) {
    lastSampleAt = now;
    pushRawWave(smoothed);
    return;
  }
  let steps = 0;
  while (now - lastSampleAt >= SAMPLE_MS && steps < 3) {
    pushRawWave(smoothed);
    lastSampleAt += SAMPLE_MS;
    steps += 1;
  }
}

export function waveOffsetAt(xNorm: number): number {
  const u = Math.max(0, Math.min(1, xNorm));
  const pos = u * (WAVE_BINS - 1);
  const i = pos | 0;
  const f = pos - i;
  const smooth = f * f * (3 - 2 * f);
  const a = history[i] ?? 0;
  const b = history[Math.min(WAVE_BINS - 1, i + 1)] ?? a;
  return (a + (b - a) * smooth) * WAVE_SCALE;
}

export function bindSpeechLevel(audio: HTMLAudioElement): () => void {
  const capture = (audio as CaptureAudio).captureStream;
  if (typeof capture !== "function") return () => {};
  const Ctx = window.AudioContext;
  if (!Ctx) return () => {};
  try {
    if (!audioCtx) audioCtx = new Ctx();
    void audioCtx.resume();
    const stream = capture.call(audio);
    const source = audioCtx.createMediaStreamSource(stream);
    if (!analyser) {
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.35;
      timeData = new Uint8Array(new ArrayBuffer(analyser.fftSize));
    }
    source.connect(analyser);
    active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active = Math.max(0, active - 1);
      try {
        source.disconnect();
      } catch {
        /* already disconnected */
      }
    };
  } catch {
    return () => {};
  }
}

export function sampleSpeechLevel(): number {
  if (!analyser || !timeData || active === 0) return 0;
  analyser.getByteTimeDomainData(timeData);
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < timeData.length; i += 1) {
    const v = Math.abs(((timeData[i] ?? 128) - 128) / 128);
    sum += v * v;
    if (v > peak) peak = v;
  }
  const rms = Math.sqrt(sum / timeData.length);
  return Math.min(1, Math.max(rms * 3.4, peak * 0.8));
}
