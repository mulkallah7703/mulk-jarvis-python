/** Energy voice-activity detector. Pure timing logic, no browser APIs. */

export type VadTick = "idle" | "speech" | "endpoint" | "cancel";

export type VadConfig = {
  /** Trailing quiet time that closes an utterance. */
  silenceMs: number;
  /** Shorter than this, a loud blip is dropped instead of sent. */
  minSpeechMs: number;
  /** Force an endpoint so a long monologue cannot hold the mic forever. */
  maxUtteranceMs: number;
  minRms: number;
  multiplier: number;
  /** Open a little under the hold threshold so the first syllable is kept. */
  startFactor: number;
  initialNoise: number;
};

export const DEFAULT_VAD: VadConfig = {
  silenceMs: 800,
  minSpeechMs: 280,
  maxUtteranceMs: 15_000,
  minRms: 0.012,
  multiplier: 2.8,
  startFactor: 0.72,
  initialNoise: 0.015,
};

export type Vad = {
  push(rms: number, dtMs: number): VadTick;
  reset(): void;
  noise(): number;
};

export function createVad(overrides: Partial<VadConfig> = {}): Vad {
  const config: VadConfig = { ...DEFAULT_VAD, ...overrides };
  let noise = config.initialNoise;
  let speaking = false;
  let speechMs = 0;
  let silenceMs = 0;
  let voicedMs = 0;

  const finish = (tick: VadTick): VadTick => {
    speaking = false;
    speechMs = 0;
    silenceMs = 0;
    voicedMs = 0;
    return tick;
  };

  return {
    noise: () => noise,
    reset() {
      speaking = false;
      speechMs = 0;
      silenceMs = 0;
      voicedMs = 0;
    },
    push(rms: number, dtMs: number): VadTick {
      const dt = Math.max(0, Math.min(dtMs, 250));
      if (dt === 0) return speaking ? "speech" : "idle";
      const level = Number.isFinite(rms) ? Math.max(0, rms) : 0;
      const floor = Math.max(config.minRms, noise * config.multiplier);
      const openAt = floor * config.startFactor;
      const holdAt = openAt * 0.65;
      const voiced = level >= (speaking ? holdAt : openAt);

      if (!speaking) {
        if (level < noise) noise = noise * 0.5 + level * 0.5;
        else if (level < floor) noise = noise * 0.98 + level * 0.02;
        if (!voiced) {
          voicedMs = 0;
          return "idle";
        }
        voicedMs += dt;
        if (voicedMs < 40) return "idle";
        speaking = true;
        speechMs = voicedMs;
        silenceMs = 0;
        return "speech";
      }

      speechMs += dt;
      if (voiced) silenceMs = 0;
      else silenceMs += dt;
      if (speechMs >= config.maxUtteranceMs) return finish("endpoint");
      if (silenceMs >= config.silenceMs) {
        const voicedFor = speechMs - silenceMs;
        return finish(voicedFor >= config.minSpeechMs ? "endpoint" : "cancel");
      }
      return "speech";
    },
  };
}
