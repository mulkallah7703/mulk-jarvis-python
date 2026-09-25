"use client";

import { useEffect, useRef } from "react";
import type { OrbState } from "./orb-state";

const STEP = 3;
const MIN_BRIGHT = 18;
const DOT = 2;
const JITTER = 0.9;
const SHIMMER = 0.35;
const SCAN_SPEED = 0.00045;
const MOUSE_R = 70;
const MOUSE_F = 5;
const RETURN = 0.08;
const PORTRAIT_SRC = "/jarvis-portrait.png";

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
    const mouse = { x: -9999, y: -9999 };
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const img = new Image();
    img.decoding = "async";

    const onMove = (e: MouseEvent) => {
      if (!W || !H) return;
      const rect = canvas.getBoundingClientRect();
      const scale = Math.min(rect.width / W, rect.height / H);
      const ox = (rect.width - W * scale) / 2;
      const oy = (rect.height - H * scale) / 2;
      mouse.x = (e.clientX - rect.left - ox) / scale;
      mouse.y = (e.clientY - rect.top - oy) / scale;
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

    img.onload = () => {
      if (!alive) return;
      W = img.naturalWidth;
      H = img.naturalHeight;
      canvas.width = W;
      canvas.height = H;

      const off = document.createElement("canvas");
      off.width = W;
      off.height = H;
      const octx = off.getContext("2d", { willReadFrequently: true });
      if (!octx) return;
      octx.drawImage(img, 0, 0);
      const src = octx.getImageData(0, 0, W, H).data;

      const px: number[] = [];
      const py: number[] = [];
      const pr: number[] = [];
      const pg: number[] = [];
      const pb: number[] = [];
      const ph: number[] = [];
      for (let y = 0; y < H; y += STEP) {
        for (let x = 0; x < W; x += STEP) {
          const i = (y * W + x) * 4;
          const r = src[i];
          const g = src[i + 1];
          const b = src[i + 2];
          if (Math.max(r, g, b) < MIN_BRIGHT) continue;
          px.push(x);
          py.push(y);
          pr.push(r);
          pg.push(g);
          pb.push(b);
          ph.push(Math.random() * Math.PI * 2);
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

    img.src = PORTRAIT_SRC;
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
      img.onload = null;
      img.src = "";
      particles = null;
      buf = null;
      data32 = null;
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
