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

const THINK_YAW = (15 * Math.PI) / 180;
const THINK_PERIOD = 3000;
const IDLE_YAW = (1.7 * Math.PI) / 180;
const LISTEN_ROLL = (2.6 * Math.PI) / 180;

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
  depth: Float32Array;
  head: Float32Array;
};

type Pose = {
  depth: Float32Array;
  head: Float32Array;
  headCx: number;
  headCy: number;
  zAmp: number;
};

function buildPose(
  hx: Float32Array,
  hy: Float32Array,
  rr: Uint8Array,
  gg: Uint8Array,
  bb: Uint8Array,
  n: number,
  width: number,
  height: number,
): Pose {
  const cellSize = 20;
  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  const bright = new Float32Array(cols * rows);
  const cell = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const cx = Math.min(cols - 1, (hx[i] / cellSize) | 0);
    const cy = Math.min(rows - 1, (hy[i] / cellSize) | 0);
    const id = cy * cols + cx;
    cell[i] = id;
    const lit = rr[i] > gg[i] ? (rr[i] > bb[i] ? rr[i] : bb[i]) : gg[i] > bb[i] ? gg[i] : bb[i];
    bright[id] += lit;
  }
  const ranked = Float32Array.from(bright);
  ranked.sort();
  const threshold = ranked[Math.floor(ranked.length * 0.9)] || 1;
  const label = new Int16Array(bright.length);
  label.fill(-1);
  const stack: number[] = [];
  let bestLabel = -1;
  let bestSize = 0;
  let nextLabel = 0;
  for (let start = 0; start < bright.length; start++) {
    if (bright[start] < threshold || label[start] !== -1) continue;
    const mark = nextLabel;
    nextLabel += 1;
    let size = 0;
    stack.push(start);
    label[start] = mark;
    while (stack.length) {
      const id = stack.pop() as number;
      size += 1;
      const cx = id % cols;
      const cy = (id / cols) | 0;
      if (cx > 0) {
        const left = id - 1;
        if (bright[left] >= threshold && label[left] === -1) {
          label[left] = mark;
          stack.push(left);
        }
      }
      if (cx + 1 < cols) {
        const right = id + 1;
        if (bright[right] >= threshold && label[right] === -1) {
          label[right] = mark;
          stack.push(right);
        }
      }
      if (cy > 0) {
        const up = id - cols;
        if (bright[up] >= threshold && label[up] === -1) {
          label[up] = mark;
          stack.push(up);
        }
      }
      if (cy + 1 < rows) {
        const down = id + cols;
        if (bright[down] >= threshold && label[down] === -1) {
          label[down] = mark;
          stack.push(down);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestLabel = mark;
    }
  }
  const depth = new Float32Array(n);
  const head = new Float32Array(n);
  let headCx = width * 0.5;
  let headCy = height * 0.38;
  let headRx = width * 0.12;
  let headRy = height * 0.2;
  if (bestSize > 8) {
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    for (let i = 0; i < n; i++) {
      if (label[cell[i]] !== bestLabel) continue;
      const x = hx[i];
      const y = hy[i];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const bodyH = Math.max(1, maxY - minY);
    const chinY = minY + bodyH * 0.5;
    let sx = 0;
    let sy = 0;
    let sn = 0;
    for (let i = 0; i < n; i++) {
      if (label[cell[i]] !== bestLabel || hy[i] > chinY) continue;
      sx += hx[i];
      sy += hy[i];
      sn += 1;
    }
    if (sn > 20) {
      headCx = sx / sn;
      headCy = sy / sn;
      let varX = 0;
      let varY = 0;
      for (let i = 0; i < n; i++) {
        if (label[cell[i]] !== bestLabel || hy[i] > chinY) continue;
        const dx = hx[i] - headCx;
        const dy = hy[i] - headCy;
        varX += dx * dx;
        varY += dy * dy;
      }
      headRx = Math.min(width * 0.22, Math.max(40, Math.sqrt(varX / sn) * 1.7));
      headRy = Math.min(height * 0.38, Math.max(40, Math.sqrt(varY / sn) * 1.7));
    }
    const fadeH = bodyH * 0.18;
    for (let i = 0; i < n; i++) {
      if (label[cell[i]] !== bestLabel) continue;
      const x = hx[i];
      const y = hy[i];
      const ndx = (x - headCx) / headRx;
      const ndy = (y - headCy) / headRy;
      const ell = ndx * ndx + ndy * ndy;
      let influence = 0;
      if (y <= chinY) {
        const edge = Math.abs(ndx);
        influence = edge <= 1.08 ? 1 : Math.max(0, 1 - (edge - 1.08) / 0.45);
      } else {
        influence = Math.max(0, 1 - (y - chinY) / fadeH) * 0.14;
      }
      head[i] = influence;
      if (ell < 1 && y <= chinY) depth[i] = (1 - ell) ** 0.55;
    }
  }
  return { depth, head, headCx, headCy, zAmp: headRx * 1.7 };
}

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
    let headCx = 0;
    let headCy = 0;
    let zAmp = 0;
    const blend = { turn: 0, listen: 0, speak: 0, last: 0 };
    const mouse = { x: -9999, y: -9999 };
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const motion = reduced ? 0.22 : 1;

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
      const jitter = JITTER * jitterMul * (reduced ? 0.35 : 1);
      const shimmer = SHIMMER * shimmerMul * (reduced ? 0.4 : 1);
      const dt = blend.last ? Math.min(48, t - blend.last) : 16;
      blend.last = t;
      const ease = 1 - Math.exp(-dt / 420);
      blend.turn += ((st === "thinking" ? 1 : 0) - blend.turn) * ease;
      blend.listen += ((st === "listening" ? 1 : 0) - blend.listen) * ease;
      blend.speak += ((st === "speaking" ? 1 : 0) - blend.speak) * ease;
      const yawThink = Math.sin((t * Math.PI * 2) / THINK_PERIOD) * THINK_YAW;
      const yawIdle = Math.sin(t * 0.00062) * IDLE_YAW;
      const yaw = (yawIdle * (1 - blend.turn) + yawThink * blend.turn) * motion;
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);
      const yawScale = cosY - 1;
      const zPush = zAmp * sinY;
      const roll = blend.listen * Math.sin(t * 0.00115) * LISTEN_ROLL * motion;
      const cosR = Math.cos(roll);
      const sinR = Math.sin(roll);
      const nod = blend.speak * Math.sin(t * 0.0082) * 3.4 * motion;
      const breathe = Math.sin(t * 0.00125) * 1.2 * motion;

      for (let i = 0; i < N; i++) {
        const mx = p.x[i] - mouse.x;
        const my = p.y[i] - mouse.y;
        const d2 = mx * mx + my * my;
        if (d2 < R2 && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const f = ((1 - d / MOUSE_R) * MOUSE_F) / d;
          p.vx[i] += mx * f;
          p.vy[i] += my * f;
        }
        const influence = p.head[i];
        const lx = p.hx[i] - headCx;
        const ly = p.hy[i] - headCy;
        const lead = p.depth[i] * zPush + influence * zAmp * 0.34 * sinY;
        let ox = lx + influence * lx * yawScale + lead;
        let oy = ly + influence * nod + breathe * (0.28 + 0.72 * influence);
        if (influence > 0.001 && roll !== 0) {
          const rolledX = ox * cosR - oy * sinR;
          const rolledY = ox * sinR + oy * cosR;
          ox += (rolledX - ox) * influence;
          oy += (rolledY - oy) * influence;
        }
        p.vx[i] += (headCx + ox - p.x[i]) * RETURN;
        p.vy[i] += (headCy + oy - p.y[i]) * RETURN;
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
        depth: new Float32Array(0),
        head: new Float32Array(0),
      };
      const pose = buildPose(particles.hx, particles.hy, particles.r, particles.g, particles.b, N, W, H);
      particles.depth = pose.depth;
      particles.head = pose.head;
      headCx = pose.headCx;
      headCy = pose.headCy;
      zAmp = pose.zAmp;
      buf = gfx.createImageData(W, H);
      data32 = new Uint32Array(buf.data.buffer);
      raf = requestAnimationFrame(frame);
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
