import { Container, Sprite } from 'pixi.js';
import { hex, mix, num, type ObjectDef } from './types';

type Kind = 'fireflies' | 'snow' | 'rain' | 'leaves' | 'stars' | 'bubbles';

interface Particle {
  s: Sprite;
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  spin: number;
  size: number;
}

const DEFAULT_COLORS: Record<Kind, string> = {
  fireflies: '#d8ff6a',
  snow: '#ffffff',
  rain: '#9fc4ff',
  leaves: '#e07a2e',
  stars: '#fff6dc',
  bubbles: '#bfe9ff',
};

/**
 * One configurable particle system confined to the object's box (particles wrap inside it),
 * so "falling leaves over the left half" is just a resized particle object.
 */
export const particles: ObjectDef = {
  type: 'particles',
  label: 'Particle effect',
  category: 'Effects',
  icon: '✦',
  defaultSize: [1920, 1080],
  props: [
    { key: 'kind', label: 'Effect', type: 'select', options: ['fireflies', 'snow', 'rain', 'leaves', 'stars', 'bubbles'], default: 'fireflies' },
    { key: 'count', label: 'Amount', type: 'range', min: 5, max: 600, step: 5, default: 80 },
    { key: 'color', label: 'Colour', type: 'color', default: '#d8ff6a' },
    { key: 'size', label: 'Size', type: 'range', min: 0.3, max: 4, step: 0.05, default: 1 },
    { key: 'wind', label: 'Wind', type: 'range', min: -1, max: 1, step: 0.05, default: 0.1 },
  ],
  create(ctx) {
    const root = new Container();
    let list: Particle[] = [];
    let kind: Kind = 'fireflies';
    let w = 100;
    let h = 100;
    let wind = 0;
    const rnd = ctx.random;

    const spawn = (p: Particle, anywhere: boolean) => {
      p.x = (rnd() - 0.5) * w;
      p.y = anywhere ? (rnd() - 0.5) * h : kind === 'bubbles' ? h / 2 + 10 : -h / 2 - 10;
      const scale = h / 1080;
      switch (kind) {
        case 'snow': p.vx = 0; p.vy = (30 + rnd() * 50) * scale; break;
        case 'rain': p.vx = 0; p.vy = (700 + rnd() * 400) * scale; break;
        case 'leaves': p.vx = 0; p.vy = (40 + rnd() * 50) * scale; break;
        case 'bubbles': p.vx = 0; p.vy = -(40 + rnd() * 60) * scale; break;
        default: p.vx = (rnd() - 0.5) * 30; p.vy = (rnd() - 0.5) * 30;
      }
    };

    return {
      root,
      build(width, height, props) {
        w = width;
        h = height;
        kind = (String(props.kind) as Kind) in DEFAULT_COLORS ? (String(props.kind) as Kind) : 'fireflies';
        wind = num(props.wind, 0.1);
        for (const p of list) p.s.destroy();
        root.removeChildren();
        const color = hex(props.color, hex(DEFAULT_COLORS[kind]));
        const size = num(props.size, 1);
        const count = Math.round(num(props.count, 80));
        list = [];
        for (let i = 0; i < count; i++) {
          const glowing = kind === 'fireflies' || kind === 'stars';
          const s = new Sprite(glowing ? ctx.textures.glow : ctx.textures.dot);
          s.anchor.set(0.5);
          if (glowing) s.blendMode = 'add';
          s.tint = kind === 'leaves' ? mix(color, 0xc0392b, rnd() * 0.6) : color;
          const base = { fireflies: 0.35, snow: 0.18, rain: 0.08, leaves: 0.3, stars: 0.14, bubbles: 0.35 }[kind] * size;
          const sz = base * (0.6 + rnd() * 0.8);
          if (kind === 'rain') s.scale.set(sz * 0.4, sz * 6);
          else if (kind === 'leaves') s.scale.set(sz * 1.6, sz * 0.8);
          else s.scale.set(sz);
          if (kind === 'bubbles') s.alpha = 0.35;
          root.addChild(s);
          const p: Particle = { s, x: 0, y: 0, vx: 0, vy: 0, phase: rnd() * Math.PI * 2, spin: (rnd() - 0.5) * 3, size: sz };
          spawn(p, true);
          list.push(p);
        }
      },
      update(dt, t) {
        const windPx = wind * w * 0.08;
        for (const p of list) {
          switch (kind) {
            case 'fireflies':
              p.vx += Math.sin(t * 0.7 + p.phase * 3) * 25 * dt;
              p.vy += Math.cos(t * 0.5 + p.phase) * 20 * dt;
              p.vx *= 0.98;
              p.vy *= 0.98;
              p.s.alpha = 0.15 + 0.85 * Math.max(0, Math.sin(t * 1.5 + p.phase)) ** 2;
              break;
            case 'stars':
              p.vx = p.vy = 0;
              p.s.alpha = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * (1 + p.spin) + p.phase));
              break;
            case 'snow':
              p.vx = windPx + Math.sin(t + p.phase) * 15;
              break;
            case 'rain':
              p.vx = windPx * 4;
              p.s.rotation = -Math.atan2(p.vx, p.vy);
              break;
            case 'leaves':
              p.vx = windPx + Math.sin(t * 1.2 + p.phase) * 40;
              p.s.rotation += p.spin * dt;
              break;
            case 'bubbles':
              p.vx = Math.sin(t * 2 + p.phase) * 12;
              break;
          }
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          // Wrap within the box.
          if (p.y > h / 2 + 12 || p.y < -h / 2 - 12) spawn(p, false);
          if (p.x > w / 2 + 12) p.x -= w + 24;
          if (p.x < -w / 2 - 12) p.x += w + 24;
          if (kind === 'fireflies' && (p.y > h / 2 || p.y < -h / 2)) p.vy *= -1;
          p.s.position.set(p.x, p.y);
        }
      },
    };
  },
};
