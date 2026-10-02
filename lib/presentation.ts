import type { OrbState } from "@/components/orb-state";

export const INTRO_MS = 2200;
export const TINT_MS = 400;
export const PULSE_MS = 1000;

const TEAL = { r: 0, g: 214, b: 204 };
const GOLD = { r: 232, g: 186, b: 96 };

export function easeOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - (1 - x) ** 3;
}

export function tintFor(mode: OrbState): { r: number; g: number; b: number; amount: number } {
  if (mode === "listening") return { r: TEAL.r, g: TEAL.g, b: TEAL.b, amount: 0.46 };
  if (mode === "speaking") return { r: GOLD.r, g: GOLD.g, b: GOLD.b, amount: 0.36 };
  return { r: 120, g: 186, b: 255, amount: 0 };
}

export function tintParticle(
  r: number,
  g: number,
  b: number,
  kind: number,
  tintR: number,
  tintG: number,
  tintB: number,
  amount: number,
  out: { r: number; g: number; b: number },
): void {
  let amt = amount;
  const gold = r > 140 && g > 70 && b < 170 && r > b + 20;
  if (kind === 2 || kind === 3) amt *= 0.22;
  else if (gold) amt *= 0.12;
  else if (kind !== 1) amt *= 0.82;
  out.r = (r + (tintR - r) * amt) | 0;
  out.g = (g + (tintG - g) * amt) | 0;
  out.b = (b + (tintB - b) * amt) | 0;
}

export function rippleBand(dist: number, radius: number, width: number): number {
  const d = dist - radius;
  const w = Math.max(1, width);
  return Math.exp(-(d * d) / (w * w));
}

export function hudTone(phase: string, mode: string): "idle" | "listening" | "speaking" {
  if (phase === "speaking") return "speaking";
  if (phase === "listening" && mode === "session") return "listening";
  return "idle";
}

export function hudStateLabel(phase: string, mode: string): string {
  if (phase === "speaking") return "SPEAKING";
  if (phase === "thinking") return "THINKING";
  if (phase === "muted") return "MUTED";
  if (phase === "listening" && mode === "session") return "LISTENING";
  return "IDLE";
}

export function hudRingCount(width: number): number {
  return width < 720 ? 2 : 4;
}

let introSkipped = false;
const skipListeners = new Set<() => void>();

export function isIntroSkipped(): boolean {
  return introSkipped;
}

export function skipIntro(): void {
  if (introSkipped) return;
  introSkipped = true;
  for (const listener of skipListeners) listener();
}

export function onIntroSkip(listener: () => void): () => void {
  if (introSkipped) listener();
  skipListeners.add(listener);
  return () => skipListeners.delete(listener);
}

export function resetIntroForTests(): void {
  introSkipped = false;
  skipListeners.clear();
}

let pulseAt = 0;

export function triggerAwaken(now = typeof performance !== "undefined" ? performance.now() : Date.now()): void {
  pulseAt = now;
}

export function awakenAge(now: number): number {
  if (!pulseAt) return -1;
  return now - pulseAt;
}

export function resetAwakenForTests(): void {
  pulseAt = 0;
}
