import { createCanvas, sizeCanvas } from '../../runtime/canvas';
import { hexToRgb } from '../../runtime/params';
import type { PresetContext, PresetInstance, ParamValues } from '../../runtime/types';
import { formatClock, formatDate } from './time';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  alive: boolean;
  alpha: number;
}

export function create(ctx: PresetContext): PresetInstance {
  const canvas = createCanvas(ctx.host, ctx.width, ctx.height, ctx.dpr);
  const g = canvas.getContext('2d', { alpha: false })!;
  const sampler = document.createElement('canvas');
  const sg = sampler.getContext('2d', { willReadFrequently: true })!;
  const random = ctx.random;
  let params: ParamValues = ctx.params;
  let dpr = ctx.dpr;

  let particles: Particle[] = [];
  let shownText = '';
  let shownDate = '';

  function sampleTargets(text: string): Array<[number, number]> {
    const w = canvas.width;
    const h = canvas.height;
    const fontPx = Math.round(Math.min(w / (text.length * 0.62), h * 0.5) * Number(params.scale));
    sampler.width = w;
    sampler.height = h;
    sg.clearRect(0, 0, w, h);
    sg.fillStyle = '#fff';
    sg.textAlign = 'center';
    sg.textBaseline = 'middle';
    sg.font = `700 ${fontPx}px "Segoe UI", system-ui, sans-serif`;
    sg.fillText(text, w / 2, h / 2);
    const step = Math.max(3, Math.round((fontPx / 38) / Number(params.density)));
    const data = sg.getImageData(0, 0, w, h).data;
    const out: Array<[number, number]> = [];
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        if (data[(y * w + x) * 4 + 3] > 128) out.push([x, y]);
      }
    }
    return out;
  }

  /** `instant` places particles directly on the digits (first frame, resize) instead of flying in. */
  function retarget(text: string, instant = false): void {
    const targets = sampleTargets(text);
    // Sorting both sides by x keeps the morph between digits local and smooth.
    targets.sort((a, b) => a[0] - b[0]);
    const alive = particles.filter((p) => p.alive).sort((a, b) => a.tx - b.tx);
    const next: Particle[] = [];
    const used = new Set<Particle>();
    for (let i = 0; i < targets.length; i++) {
      let p = alive[Math.floor((i / targets.length) * alive.length)];
      if (!p || used.has(p)) {
        p = {
          x: random() * canvas.width,
          y: random() < 0.5 ? -10 : canvas.height + 10,
          vx: 0,
          vy: 0,
          tx: 0,
          ty: 0,
          alive: true,
          alpha: 0,
        };
      }
      p.tx = targets[i][0];
      p.ty = targets[i][1];
      if (instant) {
        p.x = p.tx;
        p.y = p.ty;
        p.vx = p.vy = 0;
        p.alpha = 1;
      }
      p.alive = true;
      used.add(p);
      next.push(p);
    }
    // Leftover particles scatter and fade out.
    for (const p of alive) {
      if (!used.has(p)) {
        p.alive = false;
        p.vx = (random() - 0.5) * 600 * dpr;
        p.vy = (random() - 0.5) * 600 * dpr;
        next.push(p);
      }
    }
    // Keep particles that were already fading out so they don't vanish abruptly.
    for (const p of particles) if (!p.alive) next.push(p);
    particles = next;
  }

  function refresh(force: boolean): void {
    const now = new Date();
    const text = formatClock(now, Boolean(params.use24h), Boolean(params.showSeconds));
    if (force || text !== shownText) {
      const first = shownText === '';
      shownText = text;
      retarget(text, first);
    }
    shownDate = params.showDate ? formatDate(now) : '';
  }

  refresh(true);

  return {
    update(dt) {
      refresh(false);
      const w = canvas.width;
      const h = canvas.height;
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = String(params.background);
      g.fillRect(0, 0, w, h);

      const [r, gr, b] = hexToRgb(String(params.color)).map((v) => Math.round(v * 255));
      const size = Number(params.particleSize) * dpr;
      const glow = Number(params.glow);
      g.globalCompositeOperation = 'lighter';

      const k = 60; // spring stiffness
      const damping = Math.exp(-9 * dt);
      for (const p of particles) {
        if (p.alive) {
          p.vx += (p.tx - p.x) * k * dt;
          p.vy += (p.ty - p.y) * k * dt;
          p.alpha = Math.min(1, p.alpha + dt * 2);
        } else {
          p.alpha -= dt * 1.5;
        }
        p.vx *= damping;
        p.vy *= damping;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      particles = particles.filter((p) => p.alive || p.alpha > 0);

      if (glow > 0) {
        g.fillStyle = `rgba(${r},${gr},${b},${0.08 * glow})`;
        const gs = size * 4;
        for (const p of particles) {
          g.globalAlpha = p.alpha;
          g.fillRect(p.x - gs / 2, p.y - gs / 2, gs, gs);
        }
      }
      g.fillStyle = `rgb(${r},${gr},${b})`;
      for (const p of particles) {
        g.globalAlpha = p.alpha;
        g.beginPath();
        g.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;

      if (shownDate) {
        g.globalCompositeOperation = 'source-over';
        g.fillStyle = `rgba(${r},${gr},${b},0.75)`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        const datePx = Math.round(Math.min(w, h) * 0.035 * Number(params.scale) * 1.6);
        g.font = `300 ${datePx}px "Segoe UI", system-ui, sans-serif`;
        g.fillText(shownDate, w / 2, h / 2 + Math.min(w / 6, h * 0.3) * Number(params.scale) + datePx);
      }
    },
    resize(w, h, d) {
      dpr = d;
      sizeCanvas(canvas, w, h, d);
      refresh(true);
    },
    setParams(next) {
      params = next;
      refresh(true);
    },
    dispose() {
      canvas.remove();
    },
  };
}
