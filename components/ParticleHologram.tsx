"use client";

import { useEffect, useRef } from "react";
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
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
    ) {
      if (!data32) return;
      const xi = x | 0;
      const yi = y | 0;
      for (let dy = 0; dy < DOT; dy++) {
        const yy = yi + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = 0; dx < DOT; dx++) {
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
      const scanMul = st === "thinking" ? 2.4 : st === "speaking" ? 1.8 : 1;
      const jitterMul =
        (st === "listening" ? 1.35 : st === "thinking" ? 1.2 : 1) * (1 + energy * 0.8);
      const shimmerMul = st === "listening" ? 1.4 : st === "speaking" ? 1.25 : 1;
      const ampMul = st === "speaking" ? 1.15 : st === "thinking" ? 1.08 : 1;
      const flickerChance = st === "speaking" ? 0.04 : 0.01;
      const scan = ((t * SCAN_SPEED * scanMul) % 1.6) - 0.3;
      const flicker = Math.random() < flickerChance ? 0.75 : 1.0;
      const R2 = MOUSE_R * MOUSE_R;
      const jitter = JITTER * jitterMul;
      const shimmer = SHIMMER * shimmerMul;

      for (let i = 0; i < N; i++) {
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

        const ph = p.ph[i] + t * 0.003;
        const jx = Math.sin(ph) * jitter;
        const jy = Math.cos(ph * 1.3) * jitter;
        let a = 1.25 - shimmer * 0.5 + Math.sin(ph * 2.1) * shimmer * 0.5;
        const rel = p.hy[i] / H - scan;
        if (rel > -0.05 && rel < 0.05) a += 0.6 * (1 - Math.abs(rel) / 0.05);
        a *= flicker * ampMul;
        if (a > 1.6) a = 1.6;

        plot(
          p.x[i] + jx,
          p.y[i] + jy,
          Math.min(255, p.r[i] * a) | 0,
          Math.min(255, p.g[i] * a) | 0,
          Math.min(255, p.b[i] * a) | 0,
        );
      }
      gfx.putImageData(buf, 0, 0);
      raf = requestAnimationFrame(frame);
    }

    function paintStatic() {
      if (!particles || !buf || !data32) return;
      data32.fill(0xff000000);
      const p = particles;
      for (let i = 0; i < N; i++) {
        plot(p.hx[i], p.hy[i], p.r[i], p.g[i], p.b[i]);
      }
      gfx.putImageData(buf, 0, 0);
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
      const scale = side / imgW;
      const px: number[] = [];
      const py: number[] = [];
      const pr: number[] = [];
      const pg: number[] = [];
      const pb: number[] = [];
      const ph: number[] = [];
      const cap = wide ? 48000 : 24000;
      const seen = new Uint8Array(imgW * imgH);
      const pushWorld = (x: number, y: number, r: number, g: number, b: number) => {
        if (px.length >= cap || y < 0 || x < 0 || y >= bh || x >= bw) return;
        px.push(x);
        py.push(y);
        pr.push(r);
        pg.push(g);
        pb.push(b);
        ph.push(Math.random() * Math.PI * 2);
      };
      const push = (x: number, y: number, r: number, g: number, b: number) => {
        const slot = y * imgW + x;
        if (seen[slot]) return;
        seen[slot] = 1;
        pushWorld(ox + x * scale, oy + y * scale, r, g, b);
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

      if (wide) {
        const spacing = Math.max(4, bodyStep + 1);
        const y0 = oy + side * 0.7;
        const y1 = oy + side * 0.97;
        for (let x = 0; x < bw; x += spacing) {
          const rel = (x - ox) / side;
          if (rel > 0.36 && rel < 0.64) continue;
          const crest = 0.5 + 0.5 * Math.sin(x * 0.018);
          const ridge = 0.28 + crest * 0.42;
          for (let y = y0; y < y1; y += spacing) {
            const ny = (y - y0) / (y1 - y0);
            const band = Math.exp(-((ny - ridge) * (ny - ridge)) / 0.018);
            if (band < 0.22 && Math.random() > 0.12) continue;
            const glow = 0.28 + band * 0.72;
            pushWorld(x, y, 18 + glow * 90, 90 + glow * 120, 170 + glow * 80);
          }
        }
      }

      N = px.length;
      particles = {
        hx: Float32Array.from(px),
        hy: Float32Array.from(py),
        x: Float32Array.from(px),
        y: Float32Array.from(py),
        vx: new Float32Array(N),
        vy: new Float32Array(N),
        r: Uint8Array.from(pr),
        g: Uint8Array.from(pg),
        b: Uint8Array.from(pb),
        ph: Float32Array.from(ph),
      };
      buf = gfx.createImageData(W, H);
      data32 = new Uint32Array(buf.data.buffer);
      if (reduced) paintStatic();
      else raf = requestAnimationFrame(frame);
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
