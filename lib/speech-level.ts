import type { OrbState } from "@/components/orb-state";

type CaptureAudio = HTMLAudioElement & {
  captureStream?: () => MediaStream;
};

let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let timeData: Uint8Array<ArrayBuffer> | null = null;
let active = 0;

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
      analyser.smoothingTimeConstant = 0.72;
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
  for (let i = 0; i < timeData.length; i += 1) {
    const v = ((timeData[i] ?? 128) - 128) / 128;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / timeData.length) * 4);
}

export function waveMotion(mode: OrbState, level: number): { amp: number; speed: number } {
  const loud = Math.max(0, Math.min(1, level));
  if (mode === "speaking") return { amp: 18 + loud * 24, speed: 0.004 + loud * 0.006 };
  if (mode === "listening") return { amp: 8, speed: 0.0018 };
  if (mode === "thinking") return { amp: 4, speed: 0.001 };
  return { amp: 0.8, speed: 0.00025 };
}
