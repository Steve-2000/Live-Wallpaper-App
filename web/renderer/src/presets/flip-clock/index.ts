import { createCanvas, rgba, sizeCanvas } from '../../runtime/canvas';
import type { PresetContext, PresetInstance, ParamValues } from '../../runtime/types';
import { formatDate } from '../particle-clock/time';
import { flipPhase, flipTime } from './flip';

const FONTS: Record<string, { family: string; weight: string; stretch: string }> = {
  Classic: { family: '"Segoe UI", Arial, sans-serif', weight: '700', stretch: 'normal' },
  Condensed: { family: 'Bahnschrift, "Arial Narrow", sans-serif', weight: '600', stretch: 'condensed' },
  Rounded: { family: '"Segoe UI Variable Display", "Segoe UI", sans-serif', weight: '600', stretch: 'normal' },
  Thin: { family: '"Segoe UI Light", "Segoe UI", sans-serif', weight: '300', stretch: 'normal' },
};

/** One card: the value it shows and, while flipping, the value it is flipping from. */
interface Card {
  value: string;
  previous: string;
  /** Seconds since the flip started; -1 when still. */
  flip: number;
}

export function create(ctx: PresetContext): PresetInstance {
  const canvas = createCanvas(ctx.host, ctx.width, ctx.height, ctx.dpr);
  const g = canvas.getContext('2d', { alpha: false })!;
  let params: ParamValues = ctx.params;
  let w = ctx.width;
  let h = ctx.height;
  let dpr = ctx.dpr;
  let cards: Card[] = [];
  let meridiem = '';
  let date = '';
  let dirty = true;
  /** Rendered card faces, one per value, reused while that value is on screen. */
  const faces = new Map<string, HTMLCanvasElement>();

  const layout = () => {
    const n = Math.max(2, cards.length);
    const size = Number(params.size);
    // Cards are as large as the screen allows, roughly square, with a small gap between them.
    const gap = Math.min(w, h) * 0.035;
    const cw = Math.min(((w * size) - gap * (n - 1)) / n, h * size * 0.92 / 1.05);
    const ch = cw * 1.05;
    const total = cw * n + gap * (n - 1);
    return { cw, ch, gap, x0: (w - total) / 2, y0: (h - ch) / 2 - (params.showDate ? ch * 0.06 : 0) };
  };

  /** Draws one card face (background, digits and hinge) into an offscreen canvas. */
  const face = (text: string, cw: number, ch: number): HTMLCanvasElement => {
    const key = `${text}|${Math.round(cw)}`;
    const cached = faces.get(key);
    if (cached) return cached;
    const c = document.createElement('canvas');
    c.width = Math.ceil(cw * dpr);
    c.height = Math.ceil(ch * dpr);
    const f = c.getContext('2d')!;
    f.scale(dpr, dpr);
    const r = Math.min(cw, ch) * Number(params.corner);
    // Card with a faint top-to-bottom shading.
    const grad = f.createLinearGradient(0, 0, 0, ch);
    grad.addColorStop(0, rgba(params.card, 1));
    grad.addColorStop(1, shade(String(params.card), -0.25));
    f.fillStyle = grad;
    f.beginPath();
    f.roundRect(0, 0, cw, ch, r);
    f.fill();
    // Digits.
    const font = FONTS[String(params.font)] ?? FONTS.Classic;
    f.fillStyle = String(params.digits);
    f.textAlign = 'center';
    f.textBaseline = 'middle';
    let px = ch * 0.78;
    f.font = `${font.stretch} ${font.weight} ${px}px ${font.family}`;
    const maxWidth = cw * 0.9;
    const measured = f.measureText(text).width;
    if (measured > maxWidth) {
      px *= maxWidth / measured;
      f.font = `${font.stretch} ${font.weight} ${px}px ${font.family}`;
    }
    f.fillText(text, cw / 2, ch * 0.535);
    // The hinge: a dark gap across the middle, with tiny shadows either side.
    f.fillStyle = shade(String(params.background), 0);
    f.fillRect(0, ch / 2 - ch * 0.006, cw, ch * 0.012);
    f.fillStyle = 'rgba(0,0,0,0.15)';
    f.fillRect(0, ch / 2 + ch * 0.006, cw, ch * 0.006);
    faces.set(key, c);
    if (faces.size > 24) faces.delete(faces.keys().next().value!); // forget faces no longer shown
    return c;
  };

  const tick = (force: boolean) => {
    const now = new Date();
    const t = flipTime(now, params.format === '24-hour', Boolean(params.showSeconds));
    if (cards.length !== t.cards.length || force) {
      cards = t.cards.map((v) => ({ value: v, previous: v, flip: -1 }));
      dirty = true;
    } else {
      t.cards.forEach((v, i) => {
        const card = cards[i];
        if (card.value !== v) {
          card.previous = card.value;
          card.value = v;
          card.flip = 0;
          dirty = true;
        }
      });
    }
    const m = params.showAmPm ? t.meridiem : '';
    const d = params.showDate ? formatDate(now) : '';
    if (m !== meridiem || d !== date) {
      meridiem = m;
      date = d;
      dirty = true;
    }
  };

  const draw = () => {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = String(params.background);
    g.fillRect(0, 0, w, h);
    const { cw, ch, gap, x0, y0 } = layout();
    const duration = Number(params.flipTime);
    cards.forEach((card, i) => {
      const x = x0 + i * (cw + gap);
      const next = face(card.value, cw, ch);
      const sw = next.width;
      const sh = next.height;
      const half = sh / 2;
      // Soft shadow under the card.
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.roundRect(x, y0 + ch * 0.015, cw, ch, Math.min(cw, ch) * Number(params.corner));
      g.fill();
      if (card.flip < 0) {
        g.drawImage(next, x, y0, cw, ch);
        return;
      }
      const prev = face(card.previous, cw, ch);
      const { topFlap, bottomFlap } = flipPhase(card.flip / duration);
      // Behind the flaps: the new top half is revealed, the old bottom half stays until covered.
      g.drawImage(next, 0, 0, sw, half, x, y0, cw, ch / 2);
      g.drawImage(prev, 0, half, sw, half, x, y0 + ch / 2, cw, ch / 2);
      if (topFlap > 0) {
        // The old top half folds down towards the hinge, darkening as it turns away.
        const fh = (ch / 2) * topFlap;
        g.drawImage(prev, 0, 0, sw, half, x, y0 + ch / 2 - fh, cw, fh);
        g.fillStyle = `rgba(0,0,0,${0.5 * (1 - topFlap)})`;
        g.fillRect(x, y0 + ch / 2 - fh, cw, fh);
      }
      if (bottomFlap > 0) {
        // The new bottom half swings down from the hinge into place.
        const fh = (ch / 2) * bottomFlap;
        g.drawImage(next, 0, half, sw, half, x, y0 + ch / 2, cw, fh);
        g.fillStyle = `rgba(0,0,0,${0.45 * (1 - bottomFlap)})`;
        g.fillRect(x, y0 + ch / 2, cw, fh);
      }
    });
    if (meridiem) {
      // AM / PM in the top-left corner of the first card, like a classic flip clock.
      g.fillStyle = String(params.digits);
      g.textAlign = 'left';
      g.textBaseline = 'top';
      g.font = `700 ${Math.round(ch * 0.07)}px "Segoe UI", Arial, sans-serif`;
      g.fillText(meridiem, x0 + cw * 0.06, y0 + ch * 0.06);
    }
    if (date) {
      g.fillStyle = rgba(params.digits, 0.7);
      g.textAlign = 'center';
      g.textBaseline = 'top';
      g.font = `400 ${Math.round(ch * 0.07)}px "Segoe UI", Arial, sans-serif`;
      g.fillText(date, w / 2, y0 + ch + ch * 0.08);
    }
  };

  tick(true);
  draw();

  return {
    update(dt) {
      tick(false);
      let animating = false;
      const duration = Number(params.flipTime);
      for (const card of cards) {
        if (card.flip < 0) continue;
        card.flip += dt;
        animating = true;
        if (card.flip >= duration) card.flip = -1;
      }
      // Redraw only while something changes: a still clock costs (almost) nothing.
      if (animating || dirty) {
        draw();
        dirty = false;
      }
    },
    resize(nw, nh, d) {
      w = nw;
      h = nh;
      dpr = d;
      sizeCanvas(canvas, w, h, d);
      faces.clear();
      draw();
    },
    setParams(next) {
      params = next;
      faces.clear();
      tick(true);
      draw();
    },
    dispose() {
      faces.clear();
      canvas.remove();
    },
  };
}

/** Lightens (amount > 0) or darkens (amount < 0) a #rrggbb colour. */
function shade(hex: string, amount: number): string {
  const v = /^#[0-9a-fA-F]{6}$/.test(hex) ? parseInt(hex.slice(1), 16) : 0;
  const ch = (s: number) => {
    const c = (v >> s) & 255;
    return Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount);
  };
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}
