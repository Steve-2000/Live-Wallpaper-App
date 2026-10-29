import { Container, Graphics } from 'pixi.js';
import { hex, mix, num, type ObjectDef } from './types';

export const tree: ObjectDef = {
  type: 'tree',
  label: 'Tree',
  category: 'Nature',
  icon: '♣',
  defaultSize: [180, 300],
  props: [
    { key: 'kind', label: 'Kind', type: 'select', options: ['pine', 'round', 'birch'], default: 'pine' },
    { key: 'color', label: 'Leaf colour', type: 'color', default: '#1f4d3a' },
    { key: 'trunk', label: 'Trunk colour', type: 'color', default: '#3b2a20' },
    { key: 'sway', label: 'Sway', type: 'range', min: 0, max: 1, step: 0.05, default: 0.35 },
  ],
  create(ctx) {
    // The tree pivots at its base so wind sways the top, not the roots.
    const root = new Container();
    const pivot = new Container();
    const g = new Graphics();
    pivot.addChild(g);
    root.addChild(pivot);
    let sway = 0.35;
    const phase = ctx.random() * Math.PI * 2;
    return {
      root,
      build(w, h, p) {
        sway = num(p.sway, 0.35);
        pivot.y = h / 2;
        g.y = -h / 2;
        g.clear();
        const leaf = hex(p.color, 0x1f4d3a);
        const trunk = hex(p.trunk, 0x3b2a20);
        const kind = String(p.kind);
        if (kind === 'pine') {
          g.rect(-w * 0.05, h * 0.32, w * 0.1, h * 0.18).fill({ color: trunk });
          const tiers = 4;
          for (let i = 0; i < tiers; i++) {
            const t = i / tiers;
            const base = h * 0.36 - t * h * 0.72;
            const half = (w / 2) * (1 - t * 0.7);
            const shade = mix(leaf, 0xffffff, 0.06 * i);
            g.poly([-half, base, half, base, 0, base - h * 0.34]).fill({ color: shade });
          }
        } else {
          const birch = kind === 'birch';
          g.rect(-w * 0.05, -h * 0.05, w * 0.1, h * 0.55).fill({ color: birch ? 0xe8e4da : trunk });
          if (birch) for (let i = 0; i < 6; i++) g.rect(-w * 0.05, h * (0.02 + i * 0.08), w * 0.06, h * 0.015).fill({ color: 0x2b2b2b });
          const blobs = 7;
          for (let i = 0; i < blobs; i++) {
            const a = (i / blobs) * Math.PI * 2;
            const r = w * (0.24 + ctx.random() * 0.08);
            g.circle(Math.cos(a) * w * 0.2, -h * 0.18 + Math.sin(a) * h * 0.13, r).fill({ color: mix(leaf, 0x000000, ctx.random() * 0.25) });
          }
          g.circle(0, -h * 0.2, w * 0.3).fill({ color: mix(leaf, 0xffffff, 0.08) });
        }
      },
      update(_dt, t) {
        pivot.rotation = Math.sin(t * 0.9 + phase) * 0.035 * sway + Math.sin(t * 2.3 + phase) * 0.01 * sway;
      },
    };
  },
};

export const mountains: ObjectDef = {
  type: 'mountains',
  label: 'Mountains',
  category: 'Nature',
  icon: '⛰',
  defaultSize: [1920, 420],
  props: [
    { key: 'color', label: 'Colour', type: 'color', default: '#1b2440' },
    { key: 'peaks', label: 'Peaks', type: 'range', min: 2, max: 14, step: 1, default: 6 },
    { key: 'roughness', label: 'Roughness', type: 'range', min: 0, max: 1, step: 0.05, default: 0.45 },
    { key: 'snow', label: 'Snow caps', type: 'bool', default: true },
  ],
  create(ctx) {
    const root = new Container();
    const g = new Graphics();
    root.addChild(g);
    return {
      root,
      build(w, h, p) {
        g.clear();
        const peaks = Math.round(num(p.peaks, 6));
        const rough = num(p.roughness, 0.45);
        const color = hex(p.color, 0x1b2440);
        const pts: number[] = [-w / 2, h / 2];
        const tops: Array<[number, number]> = [];
        const steps = peaks * 2;
        for (let i = 0; i <= steps; i++) {
          const x = -w / 2 + (i / steps) * w;
          const isPeak = i % 2 === 1;
          const y = isPeak ? -h / 2 + ctx.random() * h * 0.35 : -h * 0.05 + ctx.random() * h * 0.25;
          // Jagged sub-steps between control points.
          if (i > 0 && rough > 0) {
            const px = pts[pts.length - 2];
            const py = pts[pts.length - 1];
            for (let k = 1; k < 4; k++) {
              const f = k / 4;
              pts.push(px + (x - px) * f, py + (y - py) * f + (ctx.random() - 0.5) * h * 0.08 * rough);
            }
          }
          pts.push(x, y);
          if (isPeak) tops.push([x, y]);
        }
        pts.push(w / 2, h / 2);
        g.poly(pts).fill({ color });
        if (p.snow) {
          for (const [x, y] of tops) {
            const s = h * 0.12;
            g.poly([x, y, x - s * 0.9, y + s, x - s * 0.3, y + s * 0.75, x, y + s * 1.05, x + s * 0.35, y + s * 0.7, x + s * 0.9, y + s])
              .fill({ color: mix(color, 0xffffff, 0.75), alpha: 0.9 });
          }
        }
      },
      update() {},
    };
  },
};

export const grass: ObjectDef = {
  type: 'grass',
  label: 'Grass',
  category: 'Nature',
  icon: '⌇',
  defaultSize: [600, 120],
  props: [
    { key: 'color', label: 'Colour', type: 'color', default: '#2f6b3a' },
    { key: 'tip', label: 'Tip colour', type: 'color', default: '#7fbf5a' },
    { key: 'density', label: 'Density', type: 'range', min: 0.2, max: 2, step: 0.05, default: 1 },
    { key: 'sway', label: 'Sway', type: 'range', min: 0, max: 1, step: 0.05, default: 0.5 },
  ],
  create(ctx) {
    const root = new Container();
    const pivot = new Container();
    const g = new Graphics();
    pivot.addChild(g);
    root.addChild(pivot);
    let sway = 0.5;
    return {
      root,
      build(w, h, p) {
        sway = num(p.sway, 0.5);
        pivot.y = h / 2;
        g.y = -h / 2;
        g.clear();
        const base = hex(p.color, 0x2f6b3a);
        const tip = hex(p.tip, 0x7fbf5a);
        const blades = Math.round((w / 6) * num(p.density, 1));
        for (let i = 0; i < blades; i++) {
          const x = -w / 2 + ctx.random() * w;
          const bh = h * (0.4 + ctx.random() * 0.6);
          const lean = (ctx.random() - 0.5) * h * 0.3;
          const bw = 2 + ctx.random() * 3;
          g.poly([x - bw, h / 2, x + bw, h / 2, x + lean, h / 2 - bh]).fill({ color: mix(base, tip, ctx.random()) });
        }
      },
      update(_dt, t) {
        pivot.skew.x = Math.sin(t * 1.3) * 0.12 * sway;
      },
    };
  },
};

export const river: ObjectDef = {
  type: 'river',
  label: 'Flowing river',
  category: 'Nature',
  icon: '≈',
  defaultSize: [1920, 180],
  props: [
    { key: 'color', label: 'Water colour', type: 'color', default: '#1a4a6b' },
    { key: 'highlight', label: 'Ripple colour', type: 'color', default: '#8fd3ff' },
    { key: 'ripples', label: 'Ripples', type: 'range', min: 2, max: 20, step: 1, default: 9 },
    { key: 'direction', label: 'Flow direction', type: 'select', options: ['right', 'left'], default: 'right' },
  ],
  create(ctx) {
    const root = new Container();
    const water = new Graphics();
    const lines = new Graphics();
    root.addChild(water, lines);
    let w = 100;
    let h = 50;
    let ripples: Array<{ y: number; len: number; offset: number; speed: number; amp: number }> = [];
    let color = 0x8fd3ff;
    let dir = 1;
    return {
      root,
      build(width, height, p) {
        w = width;
        h = height;
        color = hex(p.highlight, 0x8fd3ff);
        dir = p.direction === 'left' ? -1 : 1;
        const base = hex(p.color, 0x1a4a6b);
        water.clear();
        const bands = 6;
        for (let i = 0; i < bands; i++) {
          water.rect(-w / 2, -h / 2 + (i / bands) * h, w, h / bands + 1).fill({ color: mix(base, 0x000000, (i / bands) * 0.35) });
        }
        const count = Math.round(num(p.ripples, 9));
        ripples = Array.from({ length: count }, () => ({
          y: -h / 2 + h * (0.1 + ctx.random() * 0.8),
          len: w * (0.05 + ctx.random() * 0.12),
          offset: ctx.random() * w,
          speed: w * (0.03 + ctx.random() * 0.05),
          amp: 2 + ctx.random() * 3,
        }));
      },
      update(_dt, t) {
        lines.clear();
        for (const r of ripples) {
          const span = w + r.len;
          const x0 = -w / 2 - r.len + ((((r.offset + dir * r.speed * t) % span) + span) % span);
          lines.moveTo(x0, r.y);
          for (let k = 1; k <= 8; k++) {
            const x = x0 + (k / 8) * r.len;
            lines.lineTo(Math.min(w / 2, Math.max(-w / 2, x)), r.y + Math.sin(k * 0.8 + t * 2) * r.amp);
          }
          lines.stroke({ width: 2, color, alpha: 0.45 });
        }
      },
    };
  },
};
