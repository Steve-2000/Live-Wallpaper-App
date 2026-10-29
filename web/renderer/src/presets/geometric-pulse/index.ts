import { createCanvas, rgba, sizeCanvas } from '../../runtime/canvas';
import { hexToRgb } from '../../runtime/params';
import type { PresetContext, PresetInstance, ParamValues } from '../../runtime/types';

export function create(ctx: PresetContext): PresetInstance {
  const canvas = createCanvas(ctx.host, ctx.width, ctx.height, ctx.dpr);
  const g = canvas.getContext('2d', { alpha: false })!;
  let params: ParamValues = ctx.params;
  let w = ctx.width;
  let h = ctx.height;
  let dpr = ctx.dpr;
  let cleared = false;

  /** Colour for ring i of n, blended from the inner to the outer colour. */
  const ringColor = (i: number, n: number, alpha: number) => {
    const a = hexToRgb(String(params.colorA));
    const b = hexToRgb(String(params.colorB));
    const k = n > 1 ? i / (n - 1) : 0;
    const c = a.map((v, j) => Math.round((v + (b[j] - v) * k) * 255));
    return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
  };

  return {
    update(dt, time) {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      // With trails, each frame only partly covers the last one, leaving fading echoes.
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = rgba(params.background, params.trails && cleared ? Math.min(1, dt * 9) : 1);
      g.fillRect(0, 0, w, h);
      cleared = true;

      const sides = Math.round(Number(params.sides));
      const rings = Math.round(Number(params.rings));
      const maxR = Math.hypot(w, h) * 0.5;
      const pulse = Number(params.pulse);
      const twist = Number(params.twist);
      const width = Number(params.lineWidth);
      const glow = Number(params.glow);
      g.translate(w / 2, h / 2);
      g.globalCompositeOperation = 'lighter';
      g.lineJoin = 'round';
      for (let i = 0; i < rings; i++) {
        const k = (i + 1) / rings;
        // The pulse travels outward: each ring swells a little after the one inside it.
        const swell = 1 + pulse * 0.12 * Math.sin(time * 2 - i * 0.55);
        const r = maxR * Math.pow(k, 1.15) * swell;
        const angle = time * twist * 0.3 * (i % 2 === 0 ? 1 : -1) * (1 + i * 0.04);
        g.beginPath();
        for (let s = 0; s <= sides; s++) {
          const a = angle + (s / sides) * Math.PI * 2;
          const x = Math.cos(a) * r;
          const y = Math.sin(a) * r;
          if (s === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        const bright = 0.55 + 0.45 * Math.max(0, Math.sin(time * 2 - i * 0.55));
        if (glow > 0) {
          g.strokeStyle = ringColor(i, rings, 0.12 * glow * bright);
          g.lineWidth = width * 6;
          g.stroke();
        }
        g.strokeStyle = ringColor(i, rings, 0.85 * bright);
        g.lineWidth = width;
        g.stroke();
      }
      g.globalCompositeOperation = 'source-over';
    },
    resize(nw, nh, d) {
      w = nw;
      h = nh;
      dpr = d;
      sizeCanvas(canvas, w, h, d);
      cleared = false;
    },
    setParams(next) {
      params = next;
      cleared = false;
    },
    dispose() {
      canvas.remove();
    },
  };
}
