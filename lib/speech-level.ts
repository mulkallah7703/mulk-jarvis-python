import type { OrbState } from "@/components/orb-state";

const SAMPLE_MS = 1000 / 60;
export const WAVE_BINS = 120;
export const WAVE_SCALE = 52;

let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let timeData: Uint8Array<ArrayBuffer> | null = null;
let active = 0;
let playback: { stop: () => void } | null = null;

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
  if (mode === "speaking") {
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.0034);
    const pulse2 = 0.5 + 0.5 * Math.sin(now * 0.0013 + 1.1);
    const floor = 0.5 + 0.35 * pulse * pulse2;
    const live = Math.max(0, Math.min(1, speechLevel));
    return Math.max(live, floor);
  }
  // No second microphone stream: arm() releases its getUserMedia tracks
  // before speech recognition starts, and holding another stream can steal
  // the mic from Chrome/Edge recognition. Listening uses a low traveling ripple.
  if (mode === "listening") {
    const a = 0.5 + 0.5 * Math.sin(now * 0.0023);
    const b = 0.5 + 0.5 * Math.sin(now * 0.00081 + 1.4);
    return 0.18 + 0.14 * a * b;
  }
  return 0.02 + 0.012 * (0.5 + 0.5 * Math.sin(now * 0.00032));
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

function ensureGraph(): AnalyserNode | null {
  if (!audioCtx) return null;
  if (!analyser) {
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.35;
    analyser.connect(audioCtx.destination);
    timeData = new Uint8Array(new ArrayBuffer(analyser.fftSize));
  }
  return analyser;
}

export function primeWaveAudio(): void {
  if (typeof window === "undefined" || !window.AudioContext) return;
  if (!audioCtx) audioCtx = new window.AudioContext();
  void audioCtx.resume();
  ensureGraph();
}

export function stopSpeechPlayback(): void {
  const current = playback;
  playback = null;
  current?.stop();
}

function watchStop(shouldStop: () => boolean, stop: () => void): () => void {
  const timer = window.setInterval(() => {
    if (!shouldStop()) return;
    window.clearInterval(timer);
    stop();
  }, 60);
  return () => window.clearInterval(timer);
}

function startNode(
  node: AudioBufferSourceNode | MediaElementAudioSourceNode,
  audio: HTMLAudioElement | null,
  shouldStop: () => boolean,
): Promise<boolean> {
  const nodeAnalyser = ensureGraph();
  if (!audioCtx || !nodeAnalyser) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const clear = watchStop(shouldStop, () => halt(false));
    const halt = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clear();
      active = Math.max(0, active - 1);
      if (playback?.stop === haltStop) playback = null;
      try {
        node.disconnect();
      } catch {
        /* already disconnected */
      }
      if (audio) {
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
      }
      resolve(ok);
    };
    const haltStop = () => {
      if (audio) audio.pause();
      if ("stop" in node) {
        try {
          node.stop();
        } catch {
          /* not started */
        }
      }
      halt(false);
    };
    playback = { stop: haltStop };
    node.connect(nodeAnalyser);
    active += 1;
    if (audio) {
      audio.onended = () => halt(true);
      audio.onerror = () => halt(false);
      audio.play().then(() => undefined, () => halt(false));
      return;
    }
    const bufferNode = node as AudioBufferSourceNode;
    bufferNode.onended = () => halt(true);
    try {
      bufferNode.start();
    } catch {
      halt(false);
    }
  });
}

export function playSpeechBlob(blob: Blob, shouldStop: () => boolean): Promise<boolean> {
  stopSpeechPlayback();
  primeWaveAudio();
  if (!audioCtx) return Promise.resolve(false);
  const ctx = audioCtx;
  return ctx.resume().catch(() => undefined).then(async () => {
    if (shouldStop()) return false;
    try {
      const bytes = await blob.arrayBuffer();
      if (shouldStop()) return false;
      const decoded = await ctx.decodeAudioData(bytes);
      if (shouldStop()) return false;
      const source = ctx.createBufferSource();
      source.buffer = decoded;
      return startNode(source, null, shouldStop);
    } catch {
      return playElement(blob, shouldStop);
    }
  });
}

function playElement(blob: Blob, shouldStop: () => boolean): Promise<boolean> {
  if (!audioCtx) return Promise.resolve(false);
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  let source: MediaElementAudioSourceNode;
  try {
    source = audioCtx.createMediaElementSource(audio);
  } catch {
    URL.revokeObjectURL(url);
    return Promise.resolve(false);
  }
  return startNode(source, audio, shouldStop).finally(() => URL.revokeObjectURL(url));
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
