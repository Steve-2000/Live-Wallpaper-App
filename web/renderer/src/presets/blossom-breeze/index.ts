import { createCanvas, rgba, sizeCanvas } from '../../runtime/canvas';
import { createRandom } from '../../runtime/params';
import type { PresetContext, PresetInstance, ParamValues } from '../../runtime/types';

interface Petal {
  x: number;
  y: number;
  size: number;
  rot: number;
  spin: number;
  flip: number;
  flipSpeed: number;
  sway: number;
  depth: number;
}

/** A single petal: rounded with a small notch at the tip, centred on 0,0, about 2 units long. */
const PETAL = new Path2D('M0,-1 C0.55,-0.95 0.75,-0.2 0.4,0.55 C0.25,0.9 0.08,1 0,0.85 C-0.08,1 -0.25,0.9 -0.4,0.55 C-0.75,-0.2 -0.55,-0.95 0,-1 Z');

export function create(ctx: PresetContext): PresetInstance {
  const canvas = createCanvas(ctx.host, ctx.width, ctx.height, ctx.dpr);
  const g = canvas.getContext('2d', { alpha: false })!;
  const scenery = document.createElement('canvas');
  const random = ctx.random;
  let params: ParamValues = ctx.params;
  let w = ctx.width;
  let h = ctx.height;
  let dpr = ctx.dpr;
  let petals: Petal[] = [];
  /** Where blossoms are on the branch; new petals start from these. */
  let blossoms: Array<[number, number]> = [];

  const newPetal = (anywhere: boolean): Petal => {
    const fromBranch = params.branch && blossoms.length > 0 && !anywhere && random() < 0.6;
    const [bx, by] = fromBranch ? blossoms[Math.floor(random() * blossoms.length)] : [random() * w * 1.2 - w * 0.1, -20];
    const depth = 0.4 + random() * 0.6;
    return {
      x: anywhere ? random() * w : bx,
      y: anywhere ? random() * h : by,
      size: (5 + random() * 6) * depth * Math.max(0.6, Math.min(w, h) / 900),
      rot: random() * Math.PI * 2,
      spin: (random() - 0.5) * 2.2,
      flip: random() * Math.PI * 2,
      flipSpeed: 1.5 + random() * 2.5,
      sway: random() * Math.PI * 2,
      depth,
    };
  };

  /** Sky and the branch are drawn once into an offscreen canvas. */
  function paintScenery(): void {
    sizeCanvas(scenery, w, h, dpr);
    const s = scenery.getContext('2d')!;
    s.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sky = s.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, String(params.skyTop));
    sky.addColorStop(1, String(params.skyBottom));
    s.fillStyle = sky;
    s.fillRect(0, 0, w, h);
    const sun = s.createRadialGradient(w * 0.75, h * 0.3, 0, w * 0.75, h * 0.3, Math.max(w, h) * 0.45);
    sun.addColorStop(0, 'rgba(255,255,240,0.55)');
    sun.addColorStop(1, 'rgba(255,255,240,0)');
    s.fillStyle = sun;
    s.fillRect(0, 0, w, h);

    blossoms = [];
    if (!params.branch) return;
    // The branch shape comes from the seed, so it stays the same across restarts.
    const r = createRandom(ctx.seed);
    const scale = Math.min(w, h) / 900;
    s.lineCap = 'round';
    s.strokeStyle = String(params.branchColor);
    const grow = (x: number, y: number, angle: number, length: number, width: number, depth: number) => {
      const x2 = x + Math.cos(angle) * length;
      const y2 = y + Math.sin(angle) * length;
      const bend = (r() - 0.5) * length * 0.4;
      s.lineWidth = width;
      s.beginPath();
      s.moveTo(x, y);
      s.quadraticCurveTo((x + x2) / 2 - Math.sin(angle) * bend, (y + y2) / 2 + Math.cos(angle) * bend, x2, y2);
      s.stroke();
      if (depth <= 0 || width < 1.2) {
        blossoms.push([x2, y2]);
        return;
      }
      const kids = depth > 3 ? 2 : 2 + (r() < 0.5 ? 1 : 0);
      for (let i = 0; i < kids; i++) {
        grow(x2, y2, angle + (r() - 0.5) * 1.1 + (i === 0 ? -0.25 : 0.3), length * (0.62 + r() * 0.2), width * 0.66, depth - 1);
      }
      if (depth < 4) blossoms.push([x2, y2]);
    };
    grow(-20 * scale, h * 0.08, 0.32, 260 * scale, 26 * scale, 6);
    // Blossom clusters: a few overlapping petals around each branch tip.
    for (const [bx, by] of blossoms) {
      const n = 3 + Math.floor(r() * 4);
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2;
        const d = r() * 10 * scale;
        s.save();
        s.translate(bx + Math.cos(a) * d, by + Math.sin(a) * d);
        s.rotate(r() * Math.PI * 2);
        s.scale(9 * scale, 9 * scale);
        s.fillStyle = rgba(params.petal, 0.65 + r() * 0.35);
        s.fill(PETAL);
        s.restore();
      }
      s.fillStyle = 'rgba(255,240,200,0.9)';
      s.beginPath();
      s.arc(bx, by, 2.2 * scale, 0, Math.PI * 2);
      s.fill();
    }
  }

  function rebuild(): void {
    paintScenery();
    const target = Math.round(Number(params.petals));
    while (petals.length < target) petals.push(newPetal(true));
    petals.length = target;
  }
  rebuild();

  return {
    update(dt) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(scenery, 0, 0);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const wind = Number(params.wind) * 40;
      const fall = Number(params.speed) * 38;
      for (let i = 0; i < petals.length; i++) {
        const p = petals[i];
        p.sway += dt * 1.2;
        p.x += (wind + Math.sin(p.sway) * 22) * p.depth * dt;
        p.y += fall * p.depth * dt * (0.7 + 0.3 * Math.abs(Math.cos(p.flip)));
        p.rot += p.spin * dt;
        p.flip += p.flipSpeed * dt;
        if (p.y > h + 30 || p.x < -60 || p.x > w + 60) petals[i] = newPetal(false);
        // Squashing one axis with cos() looks like the petal turning over as it falls.
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.scale(p.size * Math.max(0.15, Math.abs(Math.cos(p.flip))), p.size);
        g.fillStyle = rgba(params.petal, 0.55 + 0.45 * p.depth);
        g.fill(PETAL);
        g.restore();
      }
    },
    resize(nw, nh, d) {
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
