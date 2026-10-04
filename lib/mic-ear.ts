import { createVad, type VadTick } from "./vad.ts";
import { speechToWav } from "./wav.ts";

export type Ear = {
  pause: () => void;
  resume: () => void;
  stop: () => void;
  /** True until a user gesture lets the audio graph run. */
  suspended: () => boolean;
};

const PREROLL_S = 0.35;

function audioContext(): AudioContext {
  const host = window as unknown as { webkitAudioContext?: typeof AudioContext };
  const Ctor = window.AudioContext || host.webkitAudioContext;
  if (!Ctor) throw new Error("no-audio-context");
  return new Ctor();
}

function concat(parts: Float32Array[]): Float32Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Keeps an audio-only microphone stream and cuts utterances with the energy VAD.
 * Web Speech is not started while this stream is open.
 */
export function openEar(stream: MediaStream, onUtterance: (blob: Blob) => void): Ear {
  const ctx = audioContext();
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(2048, 1, 1);
  const mute = ctx.createGain();
  mute.gain.value = 0;
  const vad = createVad();
  const rate = ctx.sampleRate || 48_000;
  const prerollN = Math.max(1, Math.floor(rate * PREROLL_S));
  const ring = new Float32Array(prerollN);
  let ringPos = 0;
  let ringFull = false;
  let capturing: Float32Array[] | null = null;
  let captured = 0;
  let paused = false;
  let stopped = false;
  let last = performance.now();
  const maxSamples = Math.floor(rate * 16);

  const snapshotPreroll = (): Float32Array => {
    if (!ringFull) return ring.slice(0, ringPos);
    const out = new Float32Array(prerollN);
    const tail = prerollN - ringPos;
    out.set(ring.subarray(ringPos), 0);
    out.set(ring.subarray(0, ringPos), tail);
    return out;
  };

  const pushRing = (samples: Float32Array) => {
    for (let index = 0; index < samples.length; index += 1) {
      ring[ringPos] = samples[index] ?? 0;
      ringPos += 1;
      if (ringPos >= prerollN) {
        ringPos = 0;
        ringFull = true;
      }
    }
  };

  const clearCapture = () => {
    capturing = null;
    captured = 0;
    ringPos = 0;
    ringFull = false;
    ring.fill(0);
    vad.reset();
  };

  const emit = (tick: VadTick) => {
    if ((tick === "endpoint" || tick === "cancel") && capturing) {
      const parts = capturing;
      capturing = null;
      captured = 0;
      if (tick === "endpoint") {
        const wav = speechToWav(concat(parts), rate);
        const audio = new ArrayBuffer(wav.byteLength);
        new Uint8Array(audio).set(wav);
        onUtterance(new Blob([audio], { type: "audio/wav" }));
      }
    }
  };

  processor.onaudioprocess = (event) => {
    if (stopped || paused) return;
    const input = event.inputBuffer.getChannelData(0);
    const copy = new Float32Array(input.length);
    copy.set(input);
    let sum = 0;
    for (let index = 0; index < copy.length; index += 1) sum += (copy[index] ?? 0) * (copy[index] ?? 0);
    const rms = Math.sqrt(sum / Math.max(1, copy.length));
    const now = performance.now();
    const dt = now - last;
    last = now;
    const tick = vad.push(rms, dt);
    if (tick === "speech" && !capturing) capturing = [snapshotPreroll()];
    if (capturing && (tick === "speech" || tick === "endpoint")) {
      capturing.push(copy);
      captured += copy.length;
    }
    pushRing(copy);
    if (captured >= maxSamples) {
      emit("endpoint");
      return;
    }
    emit(tick);
  };

  source.connect(processor);
  processor.connect(mute);
  mute.connect(ctx.destination);
  void ctx.resume();

  return {
    suspended: () => ctx.state === "suspended",
    pause() {
      paused = true;
      clearCapture();
    },
    resume() {
      paused = false;
      last = performance.now();
      void ctx.resume();
    },
    stop() {
      stopped = true;
      clearCapture();
      try {
        processor.disconnect();
        source.disconnect();
        mute.disconnect();
      } catch {
        /* already torn down */
      }
      void ctx.close();
    },
  };
}
