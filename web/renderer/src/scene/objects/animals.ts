import { Container, Graphics } from 'pixi.js';
import { hex, mix, num, type ObjectDef } from './types';

export const bird: ObjectDef = {
  type: 'bird',
  label: 'Bird',
  category: 'Animals',
  icon: '⌒',
  defaultSize: [120, 70],
  props: [
    { key: 'color', label: 'Colour', type: 'color', default: '#1c1c28' },
    { key: 'flap', label: 'Flap speed', type: 'range', min: 0.2, max: 3, step: 0.05, default: 1 },
  ],
  create(ctx) {
    const root = new Container();
    const body = new Graphics();
    const left = new Graphics();
    const right = new Graphics();
    root.addChild(left, right, body);
    let rate = 1;
    const phase = ctx.random() * Math.PI * 2;
    return {
      root,
      build(w, h, p) {
        rate = num(p.flap, 1);
        const color = hex(p.color, 0x1c1c28);
        body.clear().ellipse(0, h * 0.05, w * 0.09, h * 0.11).fill({ color });
        // Wings are drawn pointing up from the shoulder; flapping squashes them through the body line.
        for (const [g, s] of [[left, -1], [right, 1]] as const) {
          g.clear()
            .moveTo(0, 0)
            .quadraticCurveTo(s * w * 0.22, -h * 0.5, s * w * 0.5, -h * 0.15)
            .quadraticCurveTo(s * w * 0.25, -h * 0.12, 0, h * 0.1)
            .fill({ color });
        }
      },
      update(_dt, t) {
        const f = Math.cos(t * 7 * rate + phase);
        left.scale.y = right.scale.y = 0.15 + 0.85 * f;
        body.y = -f * 2;
      },
    };
  },
};

export const butterfly: ObjectDef = {
  type: 'butterfly',
  label: 'Butterfly',
  category: 'Animals',
  icon: 'Ж',
  defaultSize: [90, 80],
  props: [
    { key: 'color', label: 'Wing colour', type: 'color', default: '#ff9f43' },
    { key: 'accent', label: 'Wing tips', type: 'color', default: '#5f27cd' },
    { key: 'flap', label: 'Flap speed', type: 'range', min: 0.2, max: 3, step: 0.05, default: 1 },
  ],
  create(ctx) {
    const root = new Container();
    const left = new Graphics();
    const right = new Graphics();
    const body = new Graphics();
    root.addChild(left, right, body);
    let rate = 1;
    const phase = ctx.random() * Math.PI * 2;
    return {
      root,
      build(w, h, p) {
        rate = num(p.flap, 1);
        const c = hex(p.color, 0xff9f43);
        const a = hex(p.accent, 0x5f27cd);
        for (const [g, s] of [[left, -1], [right, 1]] as const) {
          g.clear()
            .ellipse(s * w * 0.24, -h * 0.15, w * 0.24, h * 0.27).fill({ color: c })
            .ellipse(s * w * 0.18, h * 0.2, w * 0.16, h * 0.2).fill({ color: mix(c, a, 0.4) })
            .circle(s * w * 0.34, -h * 0.28, w * 0.07).fill({ color: a });
        }
        body.clear().ellipse(0, 0, w * 0.03, h * 0.32).fill({ color: 0x222222 });
      },
      update(_dt, t) {
        const f = Math.abs(Math.cos(t * 6 * rate + phase));
        left.scale.x = right.scale.x = 0.2 + 0.8 * f;
      },
    };
  },
};

export const fish: ObjectDef = {
  type: 'fish',
  label: 'Fish',
  category: 'Animals',
  icon: '∝',
  defaultSize: [160, 80],
  props: [
    { key: 'color', label: 'Body colour', type: 'color', default: '#ff7f50' },
    { key: 'fin', label: 'Fin colour', type: 'color', default: '#ffd166' },
    { key: 'stripes', label: 'Stripes', type: 'bool', default: true },
  ],
  create(ctx) {
    const root = new Container();
    const tail = new Graphics();
    const body = new Graphics();
    root.addChild(tail, body);
    const phase = ctx.random() * Math.PI * 2;
    return {
      root,
      build(w, h, p) {
        const c = hex(p.color, 0xff7f50);
        const fin = hex(p.fin, 0xffd166);
        tail.position.set(-w * 0.28, 0);
        tail.clear().poly([0, 0, -w * 0.22, -h * 0.38, -w * 0.18, 0, -w * 0.22, h * 0.38]).fill({ color: fin });
        body.clear()
          .ellipse(w * 0.05, 0, w * 0.36, h * 0.36).fill({ color: c })
          .poly([w * 0.0, -h * 0.3, w * 0.15, -h * 0.5, w * 0.2, -h * 0.28]).fill({ color: fin });
        if (p.stripes) {
          for (const x of [-0.08, 0.08]) body.rect(w * x, -h * 0.3, w * 0.04, h * 0.6).fill({ color: 0xffffff, alpha: 0.7 });
        }
        body.circle(w * 0.27, -h * 0.07, h * 0.07).fill({ color: 0xffffff }).circle(w * 0.28, -h * 0.07, h * 0.035).fill({ color: 0x111111 });
      },
      update(_dt, t) {
        tail.rotation = Math.sin(t * 5 + phase) * 0.35;
        body.rotation = Math.sin(t * 5 + phase + 0.6) * 0.04;
      },
    };
  },
};

export const cat: ObjectDef = {
  type: 'cat',
  label: 'Cat',
  category: 'Animals',
  icon: 'ᓚ',
  defaultSize: [140, 170],
  props: [
    { key: 'color', label: 'Fur colour', type: 'color', default: '#15151d' },
    { key: 'eyes', label: 'Eye colour', type: 'color', default: '#e8ff5a' },
    { key: 'tail', label: 'Tail swish', type: 'range', min: 0, max: 1, step: 0.05, default: 0.6 },
  ],
  create(ctx) {
    // A sitting cat in silhouette: the tail swishes and the eyes blink now and then.
    const root = new Container();
    const tailG = new Graphics();
    const body = new Graphics();
    const eyes = new Graphics();
    root.addChild(tailG, body, eyes);
    let swish = 0.6;
    let nextBlink = 2 + ctx.random() * 4;
    let blink = 0;
    return {
      root,
      build(w, h, p) {
        swish = num(p.tail, 0.6);
        const c = hex(p.color, 0x15151d);
        body.clear()
          .ellipse(0, h * 0.18, w * 0.34, h * 0.32).fill({ color: c })
          .circle(0, -h * 0.22, w * 0.22).fill({ color: c })
          .poly([-w * 0.2, -h * 0.3, -w * 0.16, -h * 0.5, -w * 0.04, -h * 0.38]).fill({ color: c })
          .poly([w * 0.2, -h * 0.3, w * 0.16, -h * 0.5, w * 0.04, -h * 0.38]).fill({ color: c });
        tailG.position.set(w * 0.28, h * 0.42);
        tailG.clear()
          .moveTo(0, 0)
          .bezierCurveTo(w * 0.35, 0, w * 0.4, -h * 0.25, w * 0.2, -h * 0.4)
          .stroke({ width: w * 0.08, color: c, cap: 'round' });
        eyes.position.set(0, -h * 0.22);
        eyes.clear()
          .ellipse(-w * 0.08, 0, w * 0.04, w * 0.05).fill({ color: hex(p.eyes, 0xe8ff5a) })
          .ellipse(w * 0.08, 0, w * 0.04, w * 0.05).fill({ color: hex(p.eyes, 0xe8ff5a) });
      },
      update(dt, t) {
        tailG.rotation = Math.sin(t * 1.6) * 0.3 * swish;
        nextBlink -= dt;
        if (nextBlink <= 0) {
          blink = 0.18;
          nextBlink = 2.5 + ctx.random() * 5;
        }
        blink = Math.max(0, blink - dt);
        eyes.scale.y = blink > 0 ? 0.1 : 1;
      },
    };
  },
};
