"use client";

import { useEffect, useRef } from "react";
import { approach, faceLook, lookAngles, mouseLook, warpHome } from "@/lib/face-follow";
import { awakenAge, easeOutCubic, INTRO_MS, isIntroSkipped, PULSE_MS, rippleBand, tintFor, tintParticle } from "@/lib/presentation";
import { noteWaveLevel, sampleSpeechLevel, waveOffsetAt } from "@/lib/speech-level";
import type { OrbState } from "./orb-state";

const DOT = 2;
const JITTER = 0.9;
const SHIMMER = 0.35;
const SCAN_SPEED = 0.00045;
const MOUSE_R = 70;
const MOUSE_F = 5;
const RETURN = 0.08;
const PORTRAIT_SRC = "/kora-portrait.webp";

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

export default function ParticleHologram({ mode = "idle", energy = 0 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(mode);
  const energyRef = useRef(energy);
  modeRef.current = mode;
  energyRef.current = energy;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const maybeCtx = canvas.getContext("2d", { alpha: false });
    if (!maybeCtx) return;
    const gfx: CanvasRenderingContext2D = maybeCtx;

    let W = 0;
    let H = 0;
    let N = 0;
    let buf: ImageData | null = null;
    let data32: Uint32Array | null = null;
    let particles: Particles | null = null;
    let raf = 0;
    let alive = true;
    let src: Uint8ClampedArray | null = null;
    let imgW = 0;
    let imgH = 0;
    let builtKey = "";
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
      const rect = canvas.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * W;
      mouse.y = ((e.clientY - rect.top) / rect.height) * H;
    };
    const onLeave = () => {
      mouse.x = mouse.y = -9999;
    };

    function plot(
      x: number,
      y: number,
      r: number,
      g: number,
      b: number,
      size: number,
    ) {
      if (!data32) return;
      const xi = x | 0;
      const yi = y | 0;
      const dot = size > 1 ? size : 1;
      for (let dy = 0; dy < dot; dy++) {
        const yy = yi + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = 0; dx < dot; dx++) {
          const xx = xi + dx;
          if (xx < 0 || xx >= W) continue;
          data32[yy * W + xx] = (255 << 24) | (b << 16) | (g << 8) | r;
        }
      }
    }

    function frame(t: number) {
      if (!alive || !particles || !buf || !data32) return;
      data32.fill(0xff000000);
      const p = particles;
      const st = modeRef.current;
      const energy = energyRef.current;
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
        (st === "listening" ? 1.35 : st === "thinking" ? 1.2 : 1) * (1 + energy * 0.8);
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

      for (let i = 0; i < N; i++) {
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
        let jx = Math.sin(ph) * jitter;
        let jy = Math.cos(ph * 1.3) * jitter;
        if (p.kind[i] === 1) {
          const amp = waveOffsetAt(p.hx[i] / W);
          jy += Math.sin(p.ph[i] * 1.7) * amp;
        }
        let pulseGlow = 0;
        if (pulsing) {
          const rdx = p.hx[i] - chestX;
          const rdy = p.hy[i] - chestY;
          const dist = Math.hypot(rdx, rdy);
          pulseGlow = rippleBand(dist, pulseU * span * 0.75, span * 0.045) * (1 - pulseU);
          if (!reduced && dist > 1) {
            const push = pulseGlow * 7;
            jx += (rdx / dist) * push;
            jy += (rdy / dist) * push;
          }
        }
        let a = 1.25 - shimmer * 0.5 + Math.sin(ph * 2.1) * shimmer * 0.5;
        const rel = p.hy[i] / H - scan;
        if (rel > -0.05 && rel < 0.05) a += 0.6 * (1 - Math.abs(rel) / 0.05);
        a *= flicker * ampMul;
        if (forming) a *= 0.35 + 0.65 * intro;
        if (pulseGlow) a += pulseGlow * (reduced ? 0.55 : 1.35);
        if (a > 2.2) a = 2.2;

        const baseR = p.r[i] ?? 0;
        const baseG = p.g[i] ?? 0;
        const baseB = p.b[i] ?? 0;
        if (tintAmt > 0.012) {
          tintParticle(baseR, baseG, baseB, p.kind[i] ?? 0, tintR, tintG, tintB, tintAmt, color);
        } else {
          color.r = baseR;
          color.g = baseG;
          color.b = baseB;
        }
        if (pulsing && p.kind[i] === 3 && pulseU < 0.42) {
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
          warpHome(homeX, homeY, p.kind[i] ?? 0, chestX, chestY, span, lookX, lookY, yawCos, yawSin, pitchSin, warpOut);
          drawX += warpOut.x - homeX;
          drawY += warpOut.y - homeY;
        }
        plot(
          drawX,
          drawY,
          Math.min(255, color.r * a) | 0,
          Math.min(255, color.g * a) | 0,
          Math.min(255, color.b * a) | 0,
          p.sz[i] || DOT,
        );
      }
      gfx.putImageData(buf, 0, 0);
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
      let faceStep = 2;
      let bodyStep = 3;
      if (area < 480_000) {
        faceStep = 3;
        bodyStep = 4;
      }
      if ((navigator.hardwareConcurrency || 4) <= 2) {
        faceStep += 1;
        bodyStep += 1;
      }
      const side = Math.min(bw, bh);
      return {
        bw,
        bh,
        side,
        ox: (bw - side) / 2,
        oy: (bh - side) / 2,
        faceStep,
        bodyStep,
        wide,
      };
    };

    const build = () => {
      if (!alive || !src || !imgW || !imgH) return;
      const { bw, bh, side, ox, oy, faceStep, bodyStep, wide } = quality();
      const key = `${bw}:${bh}:${faceStep}:${bodyStep}:${wide ? 1 : 0}`;
      if (key === builtKey && particles) return;
      builtKey = key;
      cancelAnimationFrame(raf);

      W = bw;
      H = bh;
      canvas.width = bw;
      canvas.height = bh;
      chestX = ox + side * 0.5;
      chestY = oy + side * 0.56;
      span = side;
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
      const cap = wide ? 48000 : 24000;
      const seen = new Uint8Array(imgW * imgH);
      const mask = new Uint8Array(imgW * imgH);
      for (let y = 0; y < imgH; y += 1) {
        for (let x = 0; x < imgW; x += 1) {
          const i = (y * imgW + x) * 4;
          const r = src[i] ?? 0;
          const g = src[i + 1] ?? 0;
          const b = src[i + 2] ?? 0;
          if ((b > 95 && 0.2126 * r + 0.7152 * g + 0.0722 * b > 48)) mask[y * imgW + x] = 1;
        }
      }
      const stride = imgW + 1;
      const pref = new Int32Array(stride * (imgH + 1));
      for (let y = 1; y <= imgH; y += 1) {
        let row = 0;
        const srcRow = (y - 1) * imgW;
        const prev = (y - 1) * stride;
        const cur = y * stride;
        for (let x = 1; x <= imgW; x += 1) {
          row += mask[srcRow + x - 1] ?? 0;
          pref[cur + x] = (pref[prev + x] ?? 0) + row;
        }
      }
      const density = (x: number, y: number, rad: number) => {
        const x0 = Math.max(0, x - rad);
        const y0 = Math.max(0, y - rad);
        const x1 = Math.min(imgW, x + rad + 1);
        const y1 = Math.min(imgH, y + rad + 1);
        const sum =
          (pref[y1 * stride + x1] ?? 0) -
          (pref[y0 * stride + x1] ?? 0) -
          (pref[y1 * stride + x0] ?? 0) +
          (pref[y0 * stride + x0] ?? 0);
        return sum / ((x1 - x0) * (y1 - y0));
      };
      const pushWorld = (
        x: number,
        y: number,
        r: number,
        g: number,
        b: number,
        kind: number,
        sz: number,
      ) => {
        if (px.length >= cap || y < 2 || x < 0 || y >= bh - 2 || x >= bw) return;
        px.push(x);
        py.push(y);
        pr.push(r);
        pg.push(g);
        pb.push(b);
        ph.push(Math.random() * Math.PI * 2);
        pk.push(kind);
        psz.push(sz);
      };
      const push = (x: number, y: number, r: number, g: number, b: number) => {
        const slot = y * imgW + x;
        if (seen[slot]) return;
        seen[slot] = 1;
        const ny = y / imgH;
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const gold = r > 140 && g > 70 && b < 170 && r > b + 20;
        const loose = ny > 0.6 && ny < 0.985 && !gold && lum > 42 && density(x, y, 7) < 0.3;
        if (loose) {
          const sz = lum > 150 ? 2 : 1;
          const wx = ox + x * scale;
          const wy = oy + y * scale;
          const rel = (wx - ox) / side;
          if ((rel < 0.4 || rel > 0.6) && edgeSeeds.length < 5000) {
            edgeSeeds.push({ x: wx, y: wy, r, g, b, sz });
          }
          pushWorld(wx, wy, r, g, b, 1, sz);
          return;
        }
        const nx = x / imgW;
        const eye = ny > 0.19 && ny < 0.29 && nx > 0.37 && nx < 0.56;
        const head = ny < 0.42;
        pushWorld(ox + x * scale, oy + y * scale, r, g, b, eye ? 3 : head ? 2 : 0, DOT);
      };
      const lumOf = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const isGold = (r: number, g: number, b: number) => r > 140 && g > 70 && b < 170 && r > b + 20;
      const isFigure = (r: number, g: number, b: number) => b > 95 && lumOf(r, g, b) > 48;

      const starCount = Math.min(wide ? 1600 : 520, Math.round((bw * bh) / (wide ? 1600 : 2800)));
      for (let i = 0; i < starCount; i += 1) {
        const hot = Math.random() > 0.88;
        pushWorld(
          Math.random() * bw,
          Math.random() * bh,
          hot ? 170 + Math.random() * 70 : 30 + Math.random() * 35,
          hot ? 200 + Math.random() * 40 : 80 + Math.random() * 50,
          200 + Math.random() * 55,
          4,
          hot ? 2 : 1,
        );
      }

      for (let y = 0; y < imgH; y += 1) {
        const ny = y / imgH;
        const faceRow = ny > 0.03 && ny < 0.47;
        const bodyRow = ny >= 0.42 && ny < 0.98;
        for (let x = 0; x < imgW; x += 1) {
          const nx = x / imgW;
          const face = faceRow && nx > 0.18 && nx < 0.82;
          const step = face ? faceStep : bodyRow ? bodyStep : 8;
          if (y % step !== 0 || x % step !== 0) continue;
          const i = (y * imgW + x) * 4;
          const r = src[i] ?? 0;
          const g = src[i + 1] ?? 0;
          const b = src[i + 2] ?? 0;
          if (!isFigure(r, g, b) && !isGold(r, g, b)) continue;
          push(x, y, r, g, b);
        }
      }
      for (let y = 2; y < imgH - 2; y += 4) {
        for (let x = 2; x < imgW - 2; x += 4) {
          const i = (y * imgW + x) * 4;
          const r = src[i] ?? 0;
          const g = src[i + 1] ?? 0;
          const b = src[i + 2] ?? 0;
          const lum = lumOf(r, g, b);
          if (lum < 42 || lum > 95 || isFigure(r, g, b)) continue;
          const n =
            lumOf(src[(y * imgW + x - 2) * 4] ?? 0, src[(y * imgW + x - 2) * 4 + 1] ?? 0, src[(y * imgW + x - 2) * 4 + 2] ?? 0) +
            lumOf(src[(y * imgW + x + 2) * 4] ?? 0, src[(y * imgW + x + 2) * 4 + 1] ?? 0, src[(y * imgW + x + 2) * 4 + 2] ?? 0) +
            lumOf(src[((y - 2) * imgW + x) * 4] ?? 0, src[((y - 2) * imgW + x) * 4 + 1] ?? 0, src[((y - 2) * imgW + x) * 4 + 2] ?? 0) +
            lumOf(src[((y + 2) * imgW + x) * 4] ?? 0, src[((y + 2) * imgW + x) * 4 + 1] ?? 0, src[((y + 2) * imgW + x) * 4 + 2] ?? 0);
          if (lum * 4 <= n + 60) continue;
          push(x, y, r, g, b);
        }
      }
      for (let y = 0; y < imgH; y += 1) {
        if (y < imgH * 0.34 || y > imgH * 0.72) continue;
        for (let x = 0; x < imgW; x += 1) {
          const nx = x / imgW;
          if (nx < 0.3 || nx > 0.72) continue;
          const i = (y * imgW + x) * 4;
          const r = src[i] ?? 0;
          const g = src[i + 1] ?? 0;
          const b = src[i + 2] ?? 0;
          if (!isGold(r, g, b)) continue;
          push(x, y, r, g, b);
        }
      }

      const extendStrip = (dir: number) => {
        const strip = edgeSeeds.filter((seed) => (dir < 0 ? seed.x < ox + side * 0.4 : seed.x > ox + side * 0.6));
        if (strip.length < 8) return;
        let minX = strip[0]?.x ?? 0;
        let maxX = minX;
        for (const seed of strip) {
          if (seed.x < minX) minX = seed.x;
          if (seed.x > maxX) maxX = seed.x;
        }
        const reach = dir < 0 ? Math.max(1, minX) : Math.max(1, bw - maxX);
        for (const seed of strip) {
          for (let copy = 0; copy < 3; copy += 1) {
            const near = Math.pow(Math.random(), 0.65);
            if (Math.random() > 0.5 + 0.5 * near) continue;
            const nx = (dir < 0 ? minX - (1 - near) * reach : maxX + (1 - near) * reach) + (Math.random() - 0.5) * 20;
            const ny = seed.y + (Math.random() - 0.5) * 18;
            const spark = 0.78 + Math.random() * 0.4;
            const dim = (0.7 + 0.3 * near) * spark;
            pushWorld(
              nx,
              ny,
              Math.min(255, seed.r * dim),
              Math.min(255, seed.g * dim),
              Math.min(255, seed.b * dim),
              1,
              Math.random() > 0.86 ? Math.min(3, seed.sz + 1) : seed.sz,
            );
          }
        }
      };
      if (ox > 8) extendStrip(-1);
      if (bw - (ox + side) > 8) extendStrip(1);

      N = px.length;
      const formed = reduced || isIntroSkipped() || easeOutCubic((performance.now() - introT0) / INTRO_MS) >= 1;
      const sx = new Float32Array(N);
      const sy = new Float32Array(N);
      const x = new Float32Array(N);
      const y = new Float32Array(N);
      for (let i = 0; i < N; i += 1) {
        sx[i] = Math.random() * bw;
        sy[i] = Math.random() * bh;
        x[i] = formed ? (px[i] ?? 0) : (sx[i] ?? 0);
        y[i] = formed ? (py[i] ?? 0) : (sy[i] ?? 0);
      }
      particles = {
        hx: Float32Array.from(px),
        hy: Float32Array.from(py),
        x,
        y,
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
      buf = gfx.createImageData(W, H);
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
      src = octx.getImageData(0, 0, imgW, imgH).data;
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
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);
    window.addEventListener("resize", onResize);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.clearTimeout(resizeTimer);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("resize", onResize);
      img.onload = null;
      img.src = "";
      particles = null;
      buf = null;
      data32 = null;
      src = null;
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      id="hologram"
      className="jarvis-hologram-canvas"
      aria-hidden="true"
    />
  );
}
