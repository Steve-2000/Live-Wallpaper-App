import { Container, Graphics, Sprite } from 'pixi.js';
import { hex, num, type ObjectDef } from './types';

/**
 * Outline of a moon phase: a disc of radius R minus an equal circle shifted right by d.
 * Walks the disc's left arc from the upper to the lower intersection, then the shadow's
 * left arc back up (screen coordinates, y down).
 */
export function litRegion(R: number, d: number, steps: number): number[] {
  const h = Math.sqrt(R * R - (d / 2) * (d / 2));
  const pts: number[] = [];
  const aTop = Math.atan2(-h, d / 2);
  const aBottom = Math.atan2(h, d / 2) - Math.PI * 2;
  for (let i = 0; i <= steps; i++) {
    const t = aTop + ((aBottom - aTop) * i) / steps;
    pts.push(R * Math.cos(t), R * Math.sin(t));
  }
  const bBottom = Math.atan2(h, -d / 2);
  const bTop = Math.atan2(-h, -d / 2) + Math.PI * 2;
  for (let i = 1; i < steps; i++) {
    const t = bBottom + ((bTop - bBottom) * i) / steps;
    pts.push(d + R * Math.cos(t), R * Math.sin(t));
  }
  return pts;
}

export const moon: ObjectDef = {
  type: 'moon',
  label: 'Moon',
  category: 'Sky',
  icon: '☾',
  defaultSize: [160, 160],
  props: [
    { key: 'color', label: 'Colour', type: 'color', default: '#fff4d6' },
    { key: 'phase', label: 'Phase', type: 'select', options: ['full', 'gibbous', 'half', 'crescent'], default: 'crescent' },
    { key: 'glow', label: 'Glow', type: 'range', min: 0, max: 1.5, step: 0.05, default: 0.7 },
    { key: 'craters', label: 'Craters', type: 'bool', default: true },
  ],
  create(ctx) {
    const root = new Container();
    const halo = new Sprite(ctx.textures.glow);
    halo.anchor.set(0.5);
    halo.blendMode = 'add';
    const disc = new Graphics();
    root.addChild(halo, disc);
    let glow = 0.7;
    return {
      root,
      build(w, h, p) {
        const r = Math.min(w, h) / 2 / 1.0;
        const color = hex(p.color, 0xfff4d6);
        glow = num(p.glow, 0.7);
        halo.tint = color;
        halo.width = halo.height = r * 4.2;
        disc.clear();
        const R = r * 0.95;
        // Shadow circle (same radius) shifted right by d; the lit part is the disc minus it.
        const d = R * ({ full: 0, gibbous: 1.55, half: 1.0, crescent: 0.55 }[String(p.phase)] ?? 0);
        if (d <= 0 || d >= 2 * R) {
          disc.circle(0, 0, R).fill({ color });
        } else {
          disc.poly(litRegion(R, d, 48)).fill({ color });
        }
        if (p.craters) {
          // Craters sit inside the lit band (between x = -R and the shadow's left edge d - R).
          const shade = 0xd8ccaa;
          const band = d > 0 && d < 2 * R ? d : 2 * R;
          const cx = -R + band / 2;
          const s = Math.min(1, band / (2 * R));
          disc.circle(cx - band * 0.08, -R * 0.3, R * 0.16 * s + R * 0.02).fill({ color: shade, alpha: 0.55 });
          disc.circle(cx + band * 0.05, R * 0.35, R * 0.1 * s + R * 0.02).fill({ color: shade, alpha: 0.5 });
          if (band > R) disc.circle(cx + band * 0.25, -R * 0.05, R * 0.07).fill({ color: shade, alpha: 0.45 });
        }
      },
      update(_dt, t) {
        halo.alpha = glow * (0.42 + 0.06 * Math.sin(t * 0.8));
      },
    };
  },
};

export const sun: ObjectDef = {
  type: 'sun',
  label: 'Sun / glow orb',
  category: 'Sky',
  icon: '☀',
  defaultSize: [200, 200],
  props: [
    { key: 'color', label: 'Colour', type: 'color', default: '#ffb347' },
    { key: 'core', label: 'Core colour', type: 'color', default: '#fff1c1' },
    { key: 'pulse', label: 'Pulse', type: 'range', min: 0, max: 1, step: 0.05, default: 0.4 },
    { key: 'rays', label: 'Rays', type: 'bool', default: false },
  ],
  create(ctx) {
    const root = new Container();
    const halo = new Sprite(ctx.textures.glow);
    halo.anchor.set(0.5);
    halo.blendMode = 'add';
    const rays = new Graphics();
    const core = new Graphics();
    root.addChild(halo, rays, core);
    let pulse = 0.4;
    let size = 100;
    return {
      root,
      build(w, h, p) {
        size = Math.min(w, h) / 2;
        pulse = num(p.pulse, 0.4);
        halo.tint = hex(p.color, 0xffb347);
        core.clear().circle(0, 0, size * 0.42).fill({ color: hex(p.core, 0xfff1c1) });
        rays.clear();
        if (p.rays) {
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            rays.moveTo(Math.cos(a) * size * 0.55, Math.sin(a) * size * 0.55)
              .lineTo(Math.cos(a) * size * 0.95, Math.sin(a) * size * 0.95)
              .stroke({ width: size * 0.06, color: hex(p.color, 0xffb347), alpha: 0.7, cap: 'round' });
          }
        }
      },
      update(_dt, t) {
        const s = 1 + pulse * 0.08 * Math.sin(t * 1.4);
        halo.width = halo.height = size * 2.6 * s;
        rays.rotation = t * 0.1;
      },
    };
  },
};

export const cloud: ObjectDef = {
  type: 'cloud',
  label: 'Cloud',
  category: 'Sky',
  icon: '☁',
  defaultSize: [320, 140],
  props: [
    { key: 'color', label: 'Colour', type: 'color', default: '#d9e2f2' },
    { key: 'shade', label: 'Shadow colour', type: 'color', default: '#8f9bb8' },
    { key: 'puffs', label: 'Puffiness', type: 'range', min: 3, max: 12, step: 1, default: 7 },
    { key: 'softness', label: 'Opacity', type: 'range', min: 0.2, max: 1, step: 0.05, default: 0.85 },
  ],
  create(ctx) {
    const root = new Container();
    const g = new Graphics();
    root.addChild(g);
    let bobAmount = 0;
    return {
      root,
      build(w, h, p) {
        g.clear();
        const n = Math.round(num(p.puffs, 7));
        const color = hex(p.color, 0xd9e2f2);
        const shade = hex(p.shade, 0x8f9bb8);
        const alpha = num(p.softness, 0.85);
        // Flat-ish base plus overlapping puffs; a shadow pass underneath gives volume.
        const puffs: Array<[number, number, number]> = [];
        for (let i = 0; i < n; i++) {
          const t = n === 1 ? 0.5 : i / (n - 1);
          const x = (t - 0.5) * w * 0.72;
          const r = h * (0.28 + 0.22 * Math.sin(Math.PI * t) + ctx.random() * 0.08);
          puffs.push([x, h * 0.18 - r * 0.55, r]);
        }
        for (const [x, y, r] of puffs) g.circle(x, y + h * 0.05, r).fill({ color: shade, alpha: alpha * 0.6 });
        g.roundRect(-w * 0.42, h * 0.02, w * 0.84, h * 0.3, h * 0.15).fill({ color: shade, alpha: alpha * 0.6 });
        for (const [x, y, r] of puffs) g.circle(x, y, r * 0.96).fill({ color, alpha });
        g.roundRect(-w * 0.4, -h * 0.02, w * 0.8, h * 0.28, h * 0.14).fill({ color, alpha });
        bobAmount = h * 0.03;
      },
      update(_dt, t) {
        g.y = Math.sin(t * 0.5) * bobAmount;
      },
    };
  },
};
