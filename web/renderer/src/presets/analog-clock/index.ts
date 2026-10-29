import { createCanvas, rgba, sizeCanvas } from '../../runtime/canvas';
import type { PresetContext, PresetInstance, ParamValues } from '../../runtime/types';
import { formatDate } from '../particle-clock/time';
import { handAngles } from './angles';

export function create(ctx: PresetContext): PresetInstance {
  const canvas = createCanvas(ctx.host, ctx.width, ctx.height, ctx.dpr);
  const g = canvas.getContext('2d', { alpha: false })!;
  const faceLayer = document.createElement('canvas');
  let params: ParamValues = ctx.params;
  let w = ctx.width;
  let h = ctx.height;
  let dpr = ctx.dpr;

  const radius = () => (Math.min(w, h) * Number(params.size)) / 2;

  /** Background, dial, ticks and numbers never change between frames: draw them once. */
  function paintFace(): void {
    sizeCanvas(faceLayer, w, h, dpr);
    const f = faceLayer.getContext('2d')!;
    f.setTransform(dpr, 0, 0, dpr, 0, 0);
    f.fillStyle = String(params.background);
    f.fillRect(0, 0, w, h);
    const r = radius();
    f.translate(w / 2, h / 2);

    const glow = Number(params.glow);
    if (glow > 0) {
      const halo = f.createRadialGradient(0, 0, r * 0.9, 0, 0, r * 1.5);
      halo.addColorStop(0, rgba(params.accent, 0.12 * glow));
      halo.addColorStop(1, rgba(params.accent, 0));
      f.fillStyle = halo;
      f.fillRect(-r * 1.6, -r * 1.6, r * 3.2, r * 3.2);
    }
    const dial = f.createRadialGradient(-r * 0.3, -r * 0.4, r * 0.1, 0, 0, r);
    dial.addColorStop(0, rgba(params.face, 1));
    dial.addColorStop(1, rgba(params.background, 1));
    f.fillStyle = dial;
    f.beginPath();
    f.arc(0, 0, r, 0, Math.PI * 2);
    f.fill();
    f.strokeStyle = rgba(params.hands, 0.18);
    f.lineWidth = Math.max(1, r * 0.012);
    f.stroke();

    f.lineCap = 'round';
    for (let i = 0; i < 60; i++) {
      const major = i % 5 === 0;
      const a = (i / 60) * Math.PI * 2;
      const outer = r * 0.92;
      const inner = r * (major ? 0.8 : 0.87);
      f.strokeStyle = rgba(params.hands, major ? 0.9 : 0.35);
      f.lineWidth = r * (major ? 0.02 : 0.008);
      f.beginPath();
      f.moveTo(Math.sin(a) * inner, -Math.cos(a) * inner);
      f.lineTo(Math.sin(a) * outer, -Math.cos(a) * outer);
      f.stroke();
    }

    const numerals = String(params.numerals);
    if (numerals !== 'None') {
      f.fillStyle = rgba(params.hands, 0.85);
      f.font = `300 ${Math.round(r * 0.14)}px "Segoe UI", system-ui, sans-serif`;
      f.textAlign = 'center';
      f.textBaseline = 'middle';
      for (let n = 1; n <= 12; n++) {
        if (numerals !== 'All' && n % 3 !== 0) continue;
        const a = (n / 12) * Math.PI * 2;
        f.fillText(String(n), Math.sin(a) * r * 0.66, -Math.cos(a) * r * 0.66);
      }
    }
  }
  paintFace();

  const hand = (angle: number, length: number, tail: number, width: number, color: string) => {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    g.moveTo(-Math.sin(angle) * tail, Math.cos(angle) * tail);
    g.lineTo(Math.sin(angle) * length, -Math.cos(angle) * length);
    g.stroke();
  };

  return {
    update() {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(faceLayer, 0, 0);
      g.setTransform(dpr, 0, 0, dpr, w / 2 * dpr, h / 2 * dpr);
      const r = radius();
      const now = new Date();
      const a = handAngles(now, Boolean(params.sweep));

      if (params.showDate) {
        g.fillStyle = rgba(params.hands, 0.6);
        g.font = `400 ${Math.round(r * 0.075)}px "Segoe UI", system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(formatDate(now), 0, r * 0.36);
      }

      g.lineCap = 'round';
      g.shadowColor = 'rgba(0,0,0,0.45)';
      g.shadowBlur = r * 0.03;
      hand(a.hour, r * 0.5, r * 0.08, r * 0.045, String(params.hands));
      hand(a.minute, r * 0.76, r * 0.1, r * 0.03, String(params.hands));
      if (params.showSeconds) hand(a.second, r * 0.86, r * 0.16, r * 0.011, String(params.accent));
      g.shadowBlur = 0;
      g.fillStyle = String(params.showSeconds ? params.accent : params.hands);
      g.beginPath();
      g.arc(0, 0, r * 0.035, 0, Math.PI * 2);
      g.fill();
    },
    resize(nw, nh, d) {
      w = nw;
      h = nh;
      dpr = d;
      sizeCanvas(canvas, w, h, d);
      paintFace();
    },
    setParams(next) {
      params = next;
      paintFace();
    },
    dispose() {
      canvas.remove();
    },
  };
}
