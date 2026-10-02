let ctx: AudioContext | null = null;
let muted = false;
let armed = false;
let chimeUntil = 0;
const live: { stop: () => void }[] = [];

function ensure(): AudioContext | null {
  if (typeof window === "undefined" || !window.AudioContext) return null;
  if (!ctx) ctx = new window.AudioContext();
  return ctx;
}

export function armUiSounds(): void {
  armed = true;
  const audio = ensure();
  if (audio && audio.state !== "running") void audio.resume();
}

export function setUiSoundsMuted(next: boolean): void {
  muted = next;
  if (next) stopUiSounds();
}

export function stopUiSounds(): void {
  chimeUntil = 0;
  const nodes = live.splice(0, live.length);
  for (const node of nodes) node.stop();
}

function tone(audio: AudioContext, freq: number, delay: number, dur: number, peak: number): void {
  const t0 = audio.currentTime + delay;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + 0.018);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
  const handle = {
    stop: () => {
      try {
        osc.stop();
      } catch {
        /* already stopped */
      }
      try {
        osc.disconnect();
        gain.disconnect();
      } catch {
        /* already disconnected */
      }
    },
  };
  live.push(handle);
  osc.onended = () => {
    const index = live.indexOf(handle);
    if (index >= 0) live.splice(index, 1);
  };
}

function ready(): AudioContext | null {
  if (!armed || muted) return null;
  const audio = ensure();
  if (!audio || audio.state === "suspended") return null;
  return audio;
}

export function playWakeChime(): void {
  const audio = ready();
  if (!audio) return;
  chimeUntil = performance.now() + 280;
  tone(audio, 523.25, 0, 0.16, 0.035);
  tone(audio, 659.25, 0.07, 0.15, 0.028);
  tone(audio, 783.99, 0.13, 0.14, 0.022);
}

export function playReplyBlip(): void {
  if (performance.now() < chimeUntil) return;
  const audio = ready();
  if (!audio) return;
  tone(audio, 1480, 0, 0.045, 0.02);
}
