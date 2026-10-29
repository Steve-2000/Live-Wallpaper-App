import { createCanvas, rgba, sizeCanvas } from '../../runtime/canvas';
import type { PresetContext, PresetInstance, ParamValues } from '../../runtime/types';

interface Point {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  phase: number;
}

export function create(ctx: PresetContext): PresetInstance {
  const canvas = createCanvas(ctx.host, ctx.width, ctx.height, ctx.dpr);
  const g = canvas.getContext('2d', { alpha: false })!;
  const random = ctx.random;
  let params: ParamValues = ctx.params;
  let w = ctx.width;
  let h = ctx.height;
  let dpr = ctx.dpr;
  let points: Point[] = [];
  let background: CanvasGradient | null = null;
  const glowSprite = document.createElement('canvas');

  const spawn = (): Point => {
    const angle = random() * Math.PI * 2;
    const speed = 6 + random() * 14;
    return { x: random() * w, y: random() * h, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, size: 0.8 + random() * 1.6, phase: random() * 10 };
  };

  function rebuild(): void {
    const target = Math.round(Number(params.count));
    while (points.length < target) points.push(spawn());
    points.length = target;
    background = g.createLinearGradient(0, 0, 0, h);
    background.addColorStop(0, String(params.backgroundTop));
    background.addColorStop(1, String(params.backgroundBottom));
    // Pre-rendered glow, stamped under each point (much cheaper than shadowBlur).
    glowSprite.width = glowSprite.height = 64;
    const sg = glowSprite.getContext('2d')!;
    const grad = sg.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, rgba(params.pointColor, 0.55));
    grad.addColorStop(1, rgba(params.pointColor, 0));
    sg.clearRect(0, 0, 64, 64);
    sg.fillStyle = grad;
    sg.fillRect(0, 0, 64, 64);
  }
  rebuild();

  return {
    update(dt, time) {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = background!;
      g.fillRect(0, 0, w, h);

      const speed = Number(params.speed);
      const margin = 20;
      for (const p of points) {
        p.x += p.vx * dt * speed;
        p.y += p.vy * dt * speed;
        if (p.x < -margin) p.x += w + margin * 2;
        if (p.x > w + margin) p.x -= w + margin * 2;
        if (p.y < -margin) p.y += h + margin * 2;
        if (p.y > h + margin) p.y -= h + margin * 2;
      }

      // Links fade with distance.
      const link = Number(params.linkDistance);
      const link2 = link * link;
      g.lineWidth = 1;
      for (let i = 0; i < points.length; i++) {
        const a = points[i];
        for (let j = i + 1; j < points.length; j++) {
          const b = points[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > link2) continue;
          const alpha = (1 - Math.sqrt(d2) / link) * 0.55;
          g.strokeStyle = rgba(params.lineColor, alpha);
          g.beginPath();
          g.moveTo(a.x, a.y);
          g.lineTo(b.x, b.y);
          g.stroke();
        }
      }

      const glow = Number(params.glow);
      g.fillStyle = String(params.pointColor);
      for (const p of points) {
        const twinkle = 0.75 + 0.25 * Math.sin(time * 1.3 + p.phase);
        if (glow > 0) {
          const s = p.size * 9 * glow * twinkle;
          g.globalAlpha = 0.8;
          g.drawImage(glowSprite, p.x - s, p.y - s, s * 2, s * 2);
          g.globalAlpha = 1;
        }
        g.beginPath();
        g.arc(p.x, p.y, p.size * twinkle, 0, Math.PI * 2);
        g.fill();
      }
    },
    resize(nw, nh, d) {
      // Keep points where they are, relative to the new size.
      for (const p of points) {
        p.x = (p.x / w) * nw;
        p.y = (p.y / h) * nh;
      }
      w = nw;
      h = nh;
      dpr = d;
      sizeCanvas(canvas, w, h, d);
      rebuild();
    },
    setParams(next) {
      params = next;
      rebuild();
    },
    dispose() {
      canvas.remove();
    },
  };
}
