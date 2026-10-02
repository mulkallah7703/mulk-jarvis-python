"use client";

import { useEffect, useRef } from "react";
import {
  approach,
  faceLook,
  lookAngles,
  MAX_PITCH,
  MAX_YAW,
  mouseLook,
  warpHome,
} from "@/lib/face-follow";
import {
  awakenAge,
  easeOutCubic,
  INTRO_MS,
  isIntroSkipped,
  PULSE_MS,
  rippleBand,
  tintFor,
  tintParticle,
} from "@/lib/presentation";
import { noteWaveLevel, sampleSpeechLevel, waveOffsetAt } from "@/lib/speech-level";
import type { OrbState } from "./orb-state";

const DOT = 2;
const JITTER = 0.9;
const SHIMMER = 0.35;
const SCAN_SPEED = 0.00045;
const MOUSE_R = 70;
const MOUSE_F = 5;
const RETURN = 0.08;
const PORTRAIT_SRC = "/kora-portrait-v2.webp";
const PITCH_SHIFT = 0.12;
/** Navy matches the reference backdrop so keyed pixels composite back to the same color. */
const NAVY_TOP = "rgb(1,26,56)";
const NAVY_BOTTOM = "rgb(3,10,24)";

type Particles = {
  hx: Float32Array;
  hy: Float32Array;
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  r: Uint8Array;
  g: Uint8Array;
  b: Uint8Array;
  ph: Float32Array;
  kind: Uint8Array;
  sz: Uint8Array;
  sx: Float32Array;
  sy: Float32Array;
};

type Props = {
  mode?: OrbState;
  energy?: number;
};

function isGoldPixel(r: number, g: number, b: number): boolean {
  return r > 150 && g > 120 && b > 70 && b < 200 && r + g > b * 2.1 && Math.abs(r - g) < 55;
}

/** Drop the reference's navy field. Bright and blue detail stays fully opaque and unshifted. */
function keyNavy(image: ImageData): void {
  const d = image.data;
  const w = image.width;
  const h = image.height;
  const tol = 30;
  const soft = 14;
  for (let y = 0; y < h; y++) {
    const t = h <= 1 ? 0 : y / (h - 1);
    const br = 1 + 2 * t;
    const bg = 26 - 16 * t;
    const bb = 56 - 32 * t;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = (row + x) * 4;
      const r = d[i] ?? 0;
      const g = d[i + 1] ?? 0;
      const b = d[i + 2] ?? 0;
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (lum > 36 || b > 80) {
        d[i + 3] = 255;
        continue;
      }
      const dist = Math.hypot(r - br, g - bg, b - bb);
      if (dist <= tol) d[i + 3] = 0;
      else if (dist >= tol + soft) d[i + 3] = 255;
      else d[i + 3] = ((dist - tol) / soft) * 255;
    }
  }
}

export default function ParticleHologram({ mode = "idle", energy = 0 }: Props) {
  const backRef = useRef<HTMLCanvasElement>(null);
  const frontRef = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(mode);
  const energyRef = useRef(energy);
  modeRef.current = mode;
  energyRef.current = energy;

  useEffect(() => {
    const backCanvas = backRef.current;
    const frontCanvas = frontRef.current;
    if (!backCanvas || !frontCanvas) return;

    const maybeBack = backCanvas.getContext("2d", { alpha: false });
    const maybeFront = frontCanvas.getContext("2d", { alpha: true });
    if (!maybeBack || !maybeFront) return;
    const back: CanvasRenderingContext2D = maybeBack;
    const front: CanvasRenderingContext2D = maybeFront;
    back.imageSmoothingEnabled = true;
    back.imageSmoothingQuality = "high";

    let W = 0;
    let H = 0;
    let N = 0;
    let buf: ImageData | null = null;
    let data32: Uint32Array | null = null;
    let particles: Particles | null = null;
    let raf = 0;
    let alive = true;
    let src: Uint8ClampedArray | null = null;
    let keyed: HTMLCanvasElement | null = null;
    let tintLayer: HTMLCanvasElement | null = null;
    let tintCtx: CanvasRenderingContext2D | null = null;
    let imgW = 0;
    let imgH = 0;
    let ox = 0;
    let oy = 0;
    let side = 0;
    let builtKey = "";
    let backdrop: CanvasGradient | null = null;
    let backdropKey = "";
    const mouse = { x: -9999, y: -9999 };
    const color = { r: 0, g: 0, b: 0 };
    let tintR = 120;
    let tintG = 186;
    let tintB = 255;
    let tintAmt = 0;
    let lastT = 0;
    let chestX = 0;
    let chestY = 0;
    let span = 1;
    let lookX = 0;
    let lookY = 0;
    const warpOut = { x: 0, y: 0 };
    const introT0 = performance.now();
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const finePointer =
      typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches;

    const img = new Image();
    img.decoding = "async";

    const onMove = (e: MouseEvent) => {
      if (!W || !H) return;
      const rect = backCanvas.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * W;
      mouse.y = ((e.clientY - rect.top) / rect.height) * H;
    };
    const onLeave = () => {
      mouse.x = mouse.y = -9999;
    };

    function paintBackdrop() {
      const key = `${W}:${H}:${oy}:${side}`;
      if (key !== backdropKey || !backdrop) {
        backdropKey = key;
        const gradient = back.createLinearGradient(0, oy, 0, oy + Math.max(1, side));
        gradient.addColorStop(0, NAVY_TOP);
        gradient.addColorStop(1, NAVY_BOTTOM);
        backdrop = gradient;
      }
      back.fillStyle = backdrop;
      back.fillRect(0, 0, W, H);
    }

    function stick(hx: number, hy: number) {
      const pitch = Math.sin(lookY * MAX_PITCH) * span * PITCH_SHIFT;
      const yaw = lookX * MAX_YAW;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const dx = hx - chestX;
      const dy = hy + pitch - chestY;
      warpOut.x = chestX + dx * c - dy * s;
      warpOut.y = chestY + dx * s + dy * c;
    }

    function plot(x: number, y: number, r: number, g: number, b: number, size: number, alpha: number) {
      if (!data32 || alpha < 8) return;
      const xi = x | 0;
      const yi = y | 0;
      const dot = size > 1 ? size : 1;
      const pix = (alpha << 24) | (b << 16) | (g << 8) | r;
      for (let dy = 0; dy < dot; dy++) {
        const yy = yi + dy;
        if (yy < 0 || yy >= H) continue;
        const row = yy * W;
        for (let dx = 0; dx < dot; dx++) {
          const xx = xi + dx;
          if (xx < 0 || xx >= W) continue;
          data32[row + xx] = pix;
        }
      }
    }

    function preparePlate(pulsing: boolean, pulseU: number): HTMLCanvasElement | null {
      if (!keyed || !tintLayer || !tintCtx) return keyed;
      const needTint = tintAmt > 0.02;
      const needPulse = pulsing;
      if (!needTint && !needPulse) return keyed;
      const tctx = tintCtx;
      tctx.setTransform(1, 0, 0, 1, 0, 0);
      tctx.globalCompositeOperation = "source-over";
      tctx.globalAlpha = 1;
      tctx.clearRect(0, 0, imgW, imgH);
      tctx.drawImage(keyed, 0, 0);
      tctx.globalCompositeOperation = "source-atop";
      if (needTint) {
        tctx.globalAlpha = Math.min(0.16, tintAmt * 0.14);
        tctx.fillStyle = `rgb(${tintR | 0},${tintG | 0},${tintB | 0})`;
        tctx.fillRect(0, 0, imgW, imgH);
      }
      if (needPulse) {
        const cx = imgW * 0.5;
        const cy = imgH * 0.56;
        const rad = imgW * (0.16 + pulseU * 0.62);
        const glow = tctx.createRadialGradient(cx, cy, rad * 0.12, cx, cy, rad);
        glow.addColorStop(0, "rgb(186,220,255)");
        glow.addColorStop(1, "rgba(186,220,255,0)");
        tctx.globalAlpha = (reduced ? 0.1 : 0.16) * (1 - pulseU);
        tctx.fillStyle = glow;
        tctx.fillRect(0, 0, imgW, imgH);
        if (pulseU < 0.42) {
          const flash = Math.sin(Math.min(1, pulseU / 0.16) * Math.PI);
          tctx.globalAlpha = flash * (reduced ? 0.16 : 0.32);
          const eyes: [number, number][] = [
            [0.408, 0.283],
            [0.535, 0.275],
          ];
          for (const [ex, ey] of eyes) {
            const gx = ex * imgW;
            const gy = ey * imgH;
            const er = imgW * 0.045;
            const eg = tctx.createRadialGradient(gx, gy, 0, gx, gy, er);
            eg.addColorStop(0, "rgb(255,255,255)");
            eg.addColorStop(1, "rgba(255,255,255,0)");
            tctx.fillStyle = eg;
            tctx.beginPath();
            tctx.arc(gx, gy, er, 0, Math.PI * 2);
            tctx.fill();
          }
        }
      }
      tctx.globalAlpha = 1;
      tctx.globalCompositeOperation = "source-over";
      return tintLayer;
    }

    function drawPortrait(plate: HTMLCanvasElement, intro: number, warping: boolean) {
      back.save();
      back.globalAlpha = intro;
      if (warping) {
        const pitch = Math.sin(lookY * MAX_PITCH) * span * PITCH_SHIFT;
        back.translate(chestX, chestY);
        back.rotate(lookX * MAX_YAW);
        back.translate(-chestX, -chestY + pitch);
      }
      back.drawImage(plate, ox, oy, side, side);
      back.restore();
    }

    function frame(t: number) {
      if (!alive || !particles || !buf || !data32 || !keyed) return;
      const p = particles;
      const st = modeRef.current;
      const energyNow = energyRef.current;
      const dt = lastT ? Math.min(64, t - lastT) : 16;
      lastT = t;
      const target = tintFor(st);
      const blend = 1 - Math.exp(-dt / 160);
      tintAmt += (target.amount - tintAmt) * blend;
      tintR += (target.r - tintR) * blend;
      tintG += (target.g - tintG) * blend;
      tintB += (target.b - tintB) * blend;
      const intro = reduced || isIntroSkipped() ? 1 : easeOutCubic((t - introT0) / INTRO_MS);
      const forming = intro < 1;
      const age = awakenAge(t);
      const pulsing = age >= 0 && age < PULSE_MS;
      const pulseU = pulsing ? age / PULSE_MS : 0;
      const scanMul = st === "thinking" ? 2.4 : st === "speaking" ? 1.8 : 1;
      const jitterMul =
        (st === "listening" ? 1.35 : st === "thinking" ? 1.2 : 1) * (1 + energyNow * 0.8);
      const shimmerMul = st === "listening" ? 1.4 : st === "speaking" ? 1.25 : 1;
      const ampMul = st === "speaking" ? 1.15 : st === "thinking" ? 1.08 : 1;
      const flickerChance = st === "speaking" ? 0.04 : 0.01;
      const scan = ((t * SCAN_SPEED * scanMul) % 1.6) - 0.3;
      const flicker = Math.random() < flickerChance ? 0.75 : 1.0;
      const R2 = MOUSE_R * MOUSE_R;
      const jitter = reduced ? 0 : JITTER * jitterMul;
      const shimmer = SHIMMER * shimmerMul;
      noteWaveLevel(st, t, sampleSpeechLevel());
      let targetX = 0;
      let targetY = 0;
      if (!reduced && !forming) {
        if (faceLook.enabled) {
          targetX = faceLook.x;
          targetY = faceLook.y;
        } else if (finePointer) {
          const pointer = mouseLook(mouse.x, mouse.y, W, H);
          targetX = pointer.x;
          targetY = pointer.y;
        }
      }
      lookX = approach(lookX, targetX, dt);
      lookY = approach(lookY, targetY, dt);
      const warping = !forming && !reduced && (Math.abs(lookX) > 0.004 || Math.abs(lookY) > 0.004);
      let yawCos = 1;
      let yawSin = 0;
      let pitchSin = 0;
      if (warping) {
        const angles = lookAngles(lookX, lookY);
        yawCos = angles.yawCos;
        yawSin = angles.yawSin;
        pitchSin = angles.pitchSin;
      }

      paintBackdrop();
      data32.fill(0);
      const portraitRight = ox + side;
      const portraitBottom = oy + side;

      for (let i = 0; i < N; i++) {
        const kind = p.kind[i] ?? 0;
        if (forming) {
          p.x[i] = p.sx[i] + (p.hx[i] - p.sx[i]) * intro;
          p.y[i] = p.sy[i] + (p.hy[i] - p.sy[i]) * intro;
          p.vx[i] = 0;
          p.vy[i] = 0;
        } else {
          const dx = p.x[i] - mouse.x;
          const dy = p.y[i] - mouse.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < R2 && d2 > 0.01) {
            const d = Math.sqrt(d2);
            const f = ((1 - d / MOUSE_R) * MOUSE_F) / d;
            p.vx[i] += dx * f;
            p.vy[i] += dy * f;
          }
          p.vx[i] += (p.hx[i] - p.x[i]) * RETURN;
          p.vy[i] += (p.hy[i] - p.y[i]) * RETURN;
          p.vx[i] *= 0.82;
          p.vy[i] *= 0.82;
          p.x[i] += p.vx[i];
          p.y[i] += p.vy[i];
        }

        const ph = p.ph[i] + t * 0.003;
        let jx = Math.sin(ph) * jitter * (kind === 2 || kind === 3 ? 0.45 : 1);
        let jy = Math.cos(ph * 1.3) * jitter * (kind === 2 || kind === 3 ? 0.45 : 1);
        if (kind === 1) {
          const amp = waveOffsetAt(p.hx[i] / W);
          const homeX = p.hx[i] ?? 0;
          const homeY = p.hy[i] ?? 0;
          const onPortrait = homeX > ox && homeX < portraitRight && homeY > oy && homeY < portraitBottom;
          jy += Math.sin(ph * 1.7) * amp * (onPortrait ? 0.28 : 1);
        }
        let pulseGlow = 0;
        if (pulsing) {
          const rdx = p.hx[i] - chestX;
          const rdy = p.hy[i] - chestY;
          const dist = Math.hypot(rdx, rdy);
          pulseGlow = rippleBand(dist, pulseU * span * 0.75, span * 0.045) * (1 - pulseU);
          if (!reduced && dist > 1 && kind !== 2 && kind !== 3) {
            const push = pulseGlow * 7;
            jx += (rdx / dist) * push;
            jy += (rdy / dist) * push;
          }
        }

        const baseR = p.r[i] ?? 0;
        const baseG = p.g[i] ?? 0;
        const baseB = p.b[i] ?? 0;
        if (tintAmt > 0.012 && kind !== 2 && kind !== 3) {
          tintParticle(baseR, baseG, baseB, kind, tintR, tintG, tintB, tintAmt, color);
        } else if (tintAmt > 0.012) {
          tintParticle(baseR, baseG, baseB, kind, tintR, tintG, tintB, tintAmt * 0.45, color);
        } else {
          color.r = baseR;
          color.g = baseG;
          color.b = baseB;
        }
        if (pulsing && kind === 3 && pulseU < 0.42) {
          const flash = Math.sin(Math.min(1, pulseU / 0.16) * Math.PI);
          color.r = Math.min(255, color.r + 210 * flash);
          color.g = Math.min(255, color.g + 220 * flash);
          color.b = Math.min(255, color.b + 255 * flash);
        }

        let drawX = p.x[i] + jx;
        let drawY = p.y[i] + jy;
        if (warping) {
          const homeX = p.hx[i] ?? 0;
          const homeY = p.hy[i] ?? 0;
          if (kind === 1 || kind === 4) {
            warpHome(homeX, homeY, kind, chestX, chestY, span, lookX, lookY, yawCos, yawSin, pitchSin, warpOut);
          } else {
            stick(homeX, homeY);
            if (kind === 3) {
              warpOut.x += lookX * span * 0.008;
              warpOut.y += lookY * span * 0.006;
            }
          }
          drawX += warpOut.x - homeX;
          drawY += warpOut.y - homeY;
        }

        let alpha = 255;
        let rr = color.r;
        let gg = color.g;
        let bb = color.b;
        let size = p.sz[i] || DOT;
        if (kind === 4) {
          if (drawX > ox && drawX < portraitRight && drawY > oy && drawY < portraitBottom) continue;
          const tw = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(ph * 1.7));
          alpha = Math.min(255, 220 * tw * (forming ? 0.35 + 0.65 * intro : 1)) | 0;
          size = p.sz[i] || 1;
        } else if (kind === 2 || kind === 3) {
          const tw = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(ph * 2.1));
          alpha = Math.min(255, (kind === 3 ? 210 : 140) * tw) | 0;
          if (forming) alpha = (alpha * (0.35 + 0.65 * intro)) | 0;
        } else if (kind === 1) {
          const homeX = p.hx[i] ?? 0;
          const homeY = p.hy[i] ?? 0;
          const onPortrait = homeX > ox && homeX < portraitRight && homeY > oy && homeY < portraitBottom;
          if (onPortrait) {
            alpha = 90;
            size = 1;
          }
          let a = 0.92 + Math.sin(ph * 2.1) * shimmer * 0.35;
          const rel = p.hy[i] / H - scan;
          if (rel > -0.05 && rel < 0.05) a += 0.28 * (1 - Math.abs(rel) / 0.05);
          a *= flicker * ampMul;
          if (forming) a *= 0.35 + 0.65 * intro;
          if (pulseGlow) a += pulseGlow * (reduced ? 0.35 : 0.7);
          if (a > 1.35) a = 1.35;
          rr = Math.min(255, color.r * a) | 0;
          gg = Math.min(255, color.g * a) | 0;
          bb = Math.min(255, color.b * a) | 0;
        } else {
          let a = 0.92 + Math.sin(ph * 2.1) * shimmer * 0.35;
          const rel = p.hy[i] / H - scan;
          if (rel > -0.05 && rel < 0.05) a += 0.28 * (1 - Math.abs(rel) / 0.05);
          a *= flicker * ampMul;
          if (forming) a *= 0.35 + 0.65 * intro;
          if (pulseGlow) a += pulseGlow * (reduced ? 0.35 : 0.7);
          if (a > 1.35) a = 1.35;
          rr = Math.min(255, color.r * a) | 0;
          gg = Math.min(255, color.g * a) | 0;
          bb = Math.min(255, color.b * a) | 0;
        }
        plot(drawX, drawY, rr, gg, bb, size, alpha);
      }

      back.globalAlpha = 1;
      const plate = preparePlate(pulsing, pulseU);
      if (plate) drawPortrait(plate, intro, warping);
      front.putImageData(buf, 0, 0);
      raf = requestAnimationFrame(frame);
    }

    const quality = () => {
      const cssW = Math.max(1, window.innerWidth);
      const cssH = Math.max(1, window.innerHeight);
      const wide = cssW > cssH * 1.12;
      const dpr = Math.min(window.devicePixelRatio || 1, wide ? 1.35 : 1.75);
      const area = cssW * cssH;
      let bw = Math.round(cssW * dpr);
      let bh = Math.round(cssH * dpr);
      const capLong = wide ? 1680 : 1120;
      const fit = Math.min(1, capLong / Math.max(bw, bh));
      bw = Math.max(320, Math.round(bw * fit));
      bh = Math.max(320, Math.round(bh * fit));
      let sparkStep = 3;
      if (area < 480_000) sparkStep = 4;
      if ((navigator.hardwareConcurrency || 4) <= 2) sparkStep += 1;
      const portrait = Math.min(bw, bh);
      return {
        bw,
        bh,
        side: portrait,
        ox: (bw - portrait) / 2,
        oy: (bh - portrait) / 2,
        sparkStep,
        wide,
      };
    };

    const build = () => {
      if (!alive || !src || !imgW || !imgH || !keyed) return;
      const spec = quality();
      const key = `${spec.bw}:${spec.bh}:${spec.sparkStep}:${spec.wide ? 1 : 0}`;
      if (key === builtKey && particles) return;
      builtKey = key;
      cancelAnimationFrame(raf);

      W = spec.bw;
      H = spec.bh;
      ox = spec.ox;
      oy = spec.oy;
      side = spec.side;
      backCanvas.width = W;
      backCanvas.height = H;
      frontCanvas.width = W;
      frontCanvas.height = H;
      back.imageSmoothingEnabled = true;
      back.imageSmoothingQuality = "high";
      chestX = ox + side * 0.5;
      chestY = oy + side * 0.56;
      span = side;
      backdrop = null;
      const scale = side / imgW;
      const px: number[] = [];
      const py: number[] = [];
      const pr: number[] = [];
      const pg: number[] = [];
      const pb: number[] = [];
      const ph: number[] = [];
      const pk: number[] = [];
      const psz: number[] = [];
      const edgeSeeds: { x: number; y: number; r: number; g: number; b: number; sz: number }[] = [];
      const cap = spec.wide ? 16000 : 8000;

      const lumOf = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const pushWorld = (
        x: number,
        y: number,
        r: number,
        g: number,
        b: number,
        kind: number,
        sz: number,
      ) => {
        if (px.length >= cap || y < 1 || x < 0 || y >= H - 1 || x >= W) return;
        px.push(x);
        py.push(y);
        pr.push(r);
        pg.push(g);
        pb.push(b);
        ph.push(Math.random() * Math.PI * 2);
        pk.push(kind);
        psz.push(sz);
      };

      const starCount = Math.min(spec.wide ? 900 : 340, Math.round((W * H) / (spec.wide ? 2800 : 4200)));
      for (let i = 0; i < starCount; i += 1) {
        const hot = Math.random() > 0.9;
        pushWorld(
          Math.random() * W,
          Math.random() * H,
          hot ? 210 + Math.random() * 45 : 30 + Math.random() * 40,
          hot ? 225 + Math.random() * 30 : 70 + Math.random() * 50,
          hot ? 235 + Math.random() * 20 : 140 + Math.random() * 70,
          4,
          hot ? 2 : 1,
        );
      }

      const step = spec.sparkStep;
      for (let y = 0; y < imgH; y += 1) {
        const ny = y / imgH;
        for (let x = 0; x < imgW; x += 1) {
          if (px.length >= cap - 2000) break;
          const nx = x / imgW;
          const i = (y * imgW + x) * 4;
          const r = src[i] ?? 0;
          const g = src[i + 1] ?? 0;
          const b = src[i + 2] ?? 0;
          const lum = lumOf(r, g, b);
          const gold = isGoldPixel(r, g, b);
          const leftEye = nx > 0.385 && nx < 0.47 && ny > 0.25 && ny < 0.325;
          const rightEye = nx > 0.5 && nx < 0.6 && ny > 0.245 && ny < 0.32;
          const eye = (leftEye || rightEye) && lum > 165;
          if (eye) {
            if ((x + y) % 2 !== 0) continue;
            pushWorld(ox + x * scale, oy + y * scale, r, g, b, 3, 1);
            continue;
          }
          if (gold) {
            if ((x & 1) !== 0 || (y & 1) !== 0) continue;
            pushWorld(ox + x * scale, oy + y * scale, r, g, b, 2, 1);
            continue;
          }
          const head = ny < 0.46;
          if (head && lum > 205 && b > 150 && x % step === 0 && y % step === 0) {
            pushWorld(ox + x * scale, oy + y * scale, r, g, b, 2, 1);
            continue;
          }
          if (!head && lum > 78 && lum < 210 && b > 90 && x % (step + 3) === 0 && y % (step + 3) === 0) {
            pushWorld(ox + x * scale, oy + y * scale, r, g, b, 2, 1);
          }
          if (ny > 0.58 && ny < 0.98 && lum > 88 && b > 100 && b > r + 12 && x % step === 0 && y % step === 0) {
            const wx = ox + x * scale;
            const wy = oy + y * scale;
            const rel = (wx - ox) / side;
            if ((rel < 0.42 || rel > 0.58) && edgeSeeds.length < 4000) {
              edgeSeeds.push({ x: wx, y: wy, r, g, b, sz: lum > 150 ? 2 : 1 });
            }
            pushWorld(wx, wy, r, g, b, 1, lum > 160 ? 2 : 1);
          }
        }
      }

      const extendStrip = (dir: number) => {
        const strip = edgeSeeds.filter((seed) => (dir < 0 ? seed.x < ox + side * 0.42 : seed.x > ox + side * 0.58));
        if (strip.length < 8) return;
        let minX = strip[0]?.x ?? 0;
        let maxX = minX;
        for (const seed of strip) {
          if (seed.x < minX) minX = seed.x;
          if (seed.x > maxX) maxX = seed.x;
        }
        const reach = dir < 0 ? Math.max(1, minX) : Math.max(1, W - maxX);
        for (const seed of strip) {
          for (let copy = 0; copy < 3; copy += 1) {
            const near = Math.pow(Math.random(), 0.65);
            if (Math.random() > 0.55 + 0.45 * near) continue;
            const nx = (dir < 0 ? minX - (1 - near) * reach : maxX + (1 - near) * reach) + (Math.random() - 0.5) * 18;
            const ny = seed.y + (Math.random() - 0.5) * 16;
            const dim = (0.72 + 0.28 * near) * (0.8 + Math.random() * 0.35);
            pushWorld(
              nx,
              ny,
              Math.min(255, seed.r * dim),
              Math.min(255, seed.g * dim),
              Math.min(255, seed.b * dim),
              1,
              Math.random() > 0.88 ? Math.min(3, seed.sz + 1) : seed.sz,
            );
          }
        }
      };
      if (ox > 8) extendStrip(-1);
      if (W - (ox + side) > 8) extendStrip(1);

      N = px.length;
      const formed = reduced || isIntroSkipped() || easeOutCubic((performance.now() - introT0) / INTRO_MS) >= 1;
      const sx = new Float32Array(N);
      const sy = new Float32Array(N);
      const xs = new Float32Array(N);
      const ys = new Float32Array(N);
      for (let i = 0; i < N; i += 1) {
        sx[i] = Math.random() * W;
        sy[i] = Math.random() * H;
        xs[i] = formed ? (px[i] ?? 0) : (sx[i] ?? 0);
        ys[i] = formed ? (py[i] ?? 0) : (sy[i] ?? 0);
      }
      particles = {
        hx: Float32Array.from(px),
        hy: Float32Array.from(py),
        x: xs,
        y: ys,
        vx: new Float32Array(N),
        vy: new Float32Array(N),
        r: Uint8Array.from(pr),
        g: Uint8Array.from(pg),
        b: Uint8Array.from(pb),
        ph: Float32Array.from(ph),
        kind: Uint8Array.from(pk),
        sz: Uint8Array.from(psz),
        sx,
        sy,
      };
      buf = front.createImageData(W, H);
      data32 = new Uint32Array(buf.data.buffer);
      raf = requestAnimationFrame(frame);
    };

    img.onload = () => {
      if (!alive) return;
      imgW = img.naturalWidth;
      imgH = img.naturalHeight;
      const off = document.createElement("canvas");
      off.width = imgW;
      off.height = imgH;
      const octx = off.getContext("2d", { willReadFrequently: true });
      if (!octx) return;
      octx.drawImage(img, 0, 0);
      const image = octx.getImageData(0, 0, imgW, imgH);
      src = new Uint8ClampedArray(image.data);
      keyNavy(image);
      octx.putImageData(image, 0, 0);
      keyed = off;
      tintLayer = document.createElement("canvas");
      tintLayer.width = imgW;
      tintLayer.height = imgH;
      tintCtx = tintLayer.getContext("2d");
      build();
    };

    let resizeTimer = 0;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        if (alive) build();
      }, 160);
    };

    img.src = PORTRAIT_SRC;
    backCanvas.addEventListener("mousemove", onMove);
    backCanvas.addEventListener("mouseleave", onLeave);
    window.addEventListener("resize", onResize);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.clearTimeout(resizeTimer);
      backCanvas.removeEventListener("mousemove", onMove);
      backCanvas.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("resize", onResize);
      img.onload = null;
      img.src = "";
      particles = null;
      buf = null;
      data32 = null;
      src = null;
      keyed = null;
      tintLayer = null;
      tintCtx = null;
    };
  }, []);

  return (
    <>
      <canvas
        ref={backRef}
        id="hologram"
        className="jarvis-hologram-canvas"
        aria-hidden="true"
      />
      <canvas
        ref={frontRef}
        className="jarvis-hologram-canvas hologram-sparks"
        aria-hidden="true"
      />
    </>
  );
}
