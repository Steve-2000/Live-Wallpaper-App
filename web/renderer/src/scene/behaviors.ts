import { resolveParams } from '../runtime/params';
import type { ParamSpec, ParamValues } from '../runtime/types';
import type { Behavior, PathPoint, SceneObject } from './types';

// Movement behaviours. Each one adds an offset (position, rotation, scale, opacity) on top of
// the object's pose. Apart from mouse-follow smoothing they are pure functions of time, so a
// still export or a scrubbed editor frame shows exactly what the wallpaper shows at that moment.

/** Offset applied to an object's holder for one frame. Positions add, scales and alpha multiply. */
export interface Motion {
  dx: number;
  dy: number;
  /** Degrees, clockwise. */
  rotation: number;
  scaleX: number;
  scaleY: number;
  alpha: number;
}

export interface BehaviorContext {
  /** Seconds since the scene started (not the looping keyframe time). */
  time: number;
  dt: number;
  /** The object at its keyframed pose for this frame. */
  obj: SceneObject;
  scene: { width: number; height: number };
  /** Mouse position in design pixels, or null when unknown (exports, outside the window). */
  pointer: PathPoint | null;
  /** System audio level 0..1 (0 when the host doesn't provide audio). */
  audio: number;
  /** Per-behaviour scratch values that persist between frames. */
  state: Record<string, number>;
}

export type BehaviorNeed = 'pointer' | 'audio';

export interface BehaviorDef {
  type: string;
  label: string;
  icon: string;
  description: string;
  params: ParamSpec[];
  needs?: BehaviorNeed;
  /** Composes this behaviour's offset into `out`. */
  apply(p: ParamValues, ctx: BehaviorContext, out: Motion, b: Behavior): void;
}

export const identityMotion = (): Motion => ({ dx: 0, dy: 0, rotation: 0, scaleX: 1, scaleY: 1, alpha: 1 });

const TAU = Math.PI * 2;
const DEG = 180 / Math.PI;
const n = (v: unknown) => (typeof v === 'number' ? v : 0);

/** Wraps v into [min, max). */
export function wrap(v: number, min: number, max: number): number {
  const span = max - min;
  return span <= 0 ? min : min + ((((v - min) % span) + span) % span);
}

/** 0 -> 1 -> 0 over two units (back-and-forth travel). */
const triangle = (x: number) => { const f = ((x % 2) + 2) % 2; return f < 1 ? f : 2 - f; };

/** Stable pseudo-random 0..1 from a seed and a salt. */
function hash(seed: number, salt: number): number {
  const s = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** Smooth wandering value in roughly [-1, 1]. */
function smoothNoise(t: number, seed: number, salt: number): number {
  const a = hash(seed, salt) * TAU;
  const b = hash(seed, salt + 1) * TAU;
  const c = hash(seed, salt + 2) * TAU;
  return (Math.sin(t + a) + 0.5 * Math.sin(t * 2.13 + b) + 0.25 * Math.sin(t * 4.37 + c)) / 1.75;
}

/** Each behaviour gets its own phase so copies of the same object don't move in lockstep. */
const phase = (ctx: BehaviorContext, b: Behavior, salt = 0) => hash(ctx.obj.seed + b.id.length * 31 + b.id.charCodeAt(0), salt) * TAU;

/** Mirrors the object so it faces `direction` (art is drawn facing right; a flipped object faces left). */
function face(ctx: BehaviorContext, out: Motion, direction: number): void {
  const drawn = ctx.obj.flipX ? -1 : 1;
  if (direction !== 0 && Math.sign(direction) !== drawn) out.scaleX *= -1;
}

function rotateVec(x: number, y: number, deg: number): [number, number] {
  const a = deg / DEG;
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
}

// ---------------------------------------------------------------- locomotion (walk, run, fly)

const DIRECTION: ParamSpec = { key: 'direction', label: 'Direction', type: 'select', options: ['Right', 'Left'], default: 'Right' };
const MODE: ParamSpec = { key: 'mode', label: 'Route', type: 'select', options: ['Across the screen', 'Back and forth'], default: 'Across the screen' };
const DISTANCE: ParamSpec = { key: 'distance', label: 'Back-and-forth distance', type: 'range', min: 20, max: 4000, step: 10, default: 400 };
const FACE: ParamSpec = { key: 'face', label: 'Turn to face the way it moves', type: 'bool', default: true };

/** Horizontal travel shared by walk, run and fly. Returns the x offset and the direction of travel. */
function travel(p: ParamValues, ctx: BehaviorContext): { dx: number; heading: number } {
  const sign = p.direction === 'Left' ? -1 : 1;
  const dist = n(p.speed) * ctx.time;
  if (p.mode === 'Back and forth') {
    const span = Math.max(1, n(p.distance));
    const f = ((dist / span) % 2 + 2) % 2;
    return { dx: sign * triangle(dist / span) * span, heading: f < 1 ? sign : -sign };
  }
  // Leave the screen completely before reappearing on the other side.
  const margin = Math.abs(ctx.obj.width) / 2 + 10;
  const x = wrap(ctx.obj.x + sign * dist, -margin, ctx.scene.width + margin);
  return { dx: x - ctx.obj.x, heading: sign };
}

function walker(type: string, label: string, icon: string, speed: number, bob: number, steps: number): BehaviorDef {
  return {
    type,
    label,
    icon,
    description: `${label}s sideways with a stepping bob.`,
    params: [
      { key: 'speed', label: 'Speed (px/s)', type: 'range', min: 5, max: 1500, step: 5, default: speed },
      DIRECTION,
      MODE,
      DISTANCE,
      { key: 'bob', label: 'Step bounce (px)', type: 'range', min: 0, max: 80, step: 1, default: bob },
      { key: 'steps', label: 'Steps per second', type: 'range', min: 0.5, max: 10, step: 0.1, default: steps },
      FACE,
    ],
    apply(p, ctx, out) {
      const { dx, heading } = travel(p, ctx);
      out.dx += dx;
      out.dy -= Math.abs(Math.sin(Math.PI * n(p.steps) * ctx.time)) * n(p.bob);
      if (p.face) face(ctx, out, heading);
    },
  };
}

const fly: BehaviorDef = {
  type: 'fly',
  label: 'Fly',
  icon: '➶',
  description: 'Flies sideways along a gentle wave.',
  params: [
    { key: 'speed', label: 'Speed (px/s)', type: 'range', min: 5, max: 1500, step: 5, default: 160 },
    DIRECTION,
    MODE,
    DISTANCE,
    { key: 'wave', label: 'Wave height (px)', type: 'range', min: 0, max: 400, step: 1, default: 40 },
    { key: 'period', label: 'Wave length (s)', type: 'range', min: 0.3, max: 20, step: 0.1, default: 3 },
    { key: 'tilt', label: 'Tilt with the wave', type: 'bool', default: true },
    FACE,
  ],
  apply(p, ctx, out, b) {
    const { dx, heading } = travel(p, ctx);
    const w = TAU / Math.max(0.1, n(p.period));
    const ph = phase(ctx, b);
    out.dx += dx;
    out.dy += Math.sin(ctx.time * w + ph) * n(p.wave);
    if (p.tilt && n(p.speed) > 0) {
      const vy = Math.cos(ctx.time * w + ph) * n(p.wave) * w;
      out.rotation += Math.atan2(vy, n(p.speed)) * DEG * 0.6 * heading;
    }
    if (p.face) face(ctx, out, heading);
  },
};

// ------------------------------------------------------------------------------ in place

const jump: BehaviorDef = {
  type: 'jump',
  label: 'Jump',
  icon: '⤒',
  description: 'Hops up and lands with a squash.',
  params: [
    { key: 'height', label: 'Height (px)', type: 'range', min: 5, max: 1000, step: 5, default: 120 },
    { key: 'interval', label: 'Time between jumps (s)', type: 'range', min: 0.3, max: 20, step: 0.1, default: 1.6 },
    { key: 'air', label: 'Time in the air (s)', type: 'range', min: 0.15, max: 5, step: 0.05, default: 0.6 },
    { key: 'squash', label: 'Squash on landing', type: 'bool', default: true },
  ],
  apply(p, ctx, out) {
    const interval = Math.max(0.1, n(p.interval));
    const air = Math.min(interval, n(p.air));
    const t = ctx.time % interval;
    if (t < air) {
      const q = t / air;
      out.dy -= 4 * n(p.height) * q * (1 - q);
      return;
    }
    const since = t - air;
    if (p.squash && since < 0.16) {
      const s = Math.sin((since / 0.16) * Math.PI) * 0.16;
      out.scaleY *= 1 - s;
      out.scaleX *= 1 + s * 0.6;
      out.dy += (ctx.obj.height * s) / 2; // keep the feet on the ground
    }
  },
};

const bounce: BehaviorDef = {
  type: 'bounce',
  label: 'Bounce',
  icon: '◠',
  description: 'Bounces like a ball, squashing at the bottom.',
  params: [
    { key: 'height', label: 'Height (px)', type: 'range', min: 5, max: 1000, step: 5, default: 100 },
    { key: 'period', label: 'Bounce time (s)', type: 'range', min: 0.2, max: 10, step: 0.05, default: 1 },
    { key: 'squash', label: 'Squash', type: 'range', min: 0, max: 0.5, step: 0.01, default: 0.2 },
  ],
  apply(p, ctx, out) {
    const q = (ctx.time / Math.max(0.05, n(p.period))) % 1;
    out.dy -= 4 * n(p.height) * q * (1 - q);
    const edge = Math.min(q, 1 - q) / 0.08;
    if (edge < 1) {
      const s = (1 - edge) * n(p.squash);
      out.scaleY *= 1 - s;
      out.scaleX *= 1 + s;
      out.dy += (ctx.obj.height * s) / 2;
    }
  },
};

const float: BehaviorDef = {
  type: 'float',
  label: 'Float',
  icon: '≈',
  description: 'Drifts gently up and down, like a balloon or a boat.',
  params: [
    { key: 'amplitude', label: 'Up and down (px)', type: 'range', min: 0, max: 300, step: 1, default: 18 },
    { key: 'drift', label: 'Side to side (px)', type: 'range', min: 0, max: 300, step: 1, default: 6 },
    { key: 'tilt', label: 'Rocking (°)', type: 'range', min: 0, max: 45, step: 0.5, default: 3 },
    { key: 'period', label: 'Cycle (s)', type: 'range', min: 0.5, max: 30, step: 0.1, default: 4 },
  ],
  apply(p, ctx, out, b) {
    const w = TAU / Math.max(0.1, n(p.period));
    out.dy += Math.sin(ctx.time * w + phase(ctx, b)) * n(p.amplitude);
    out.dx += Math.sin((ctx.time * w) / 1.7 + phase(ctx, b, 1)) * n(p.drift);
    out.rotation += Math.sin((ctx.time * w) / 1.3 + phase(ctx, b, 2)) * n(p.tilt);
  },
};

const spin: BehaviorDef = {
  type: 'spin',
  label: 'Rotate',
  icon: '↻',
  description: 'Turns continuously.',
  params: [{ key: 'speed', label: 'Degrees per second', type: 'range', min: -720, max: 720, step: 1, default: 30 }],
  apply(p, ctx, out) {
    out.rotation += (n(p.speed) * ctx.time) % 360;
  },
};

const swing: BehaviorDef = {
  type: 'swing',
  label: 'Swing',
  icon: '⌓',
  description: 'Swings like a pendulum or a branch in the wind.',
  params: [
    { key: 'angle', label: 'Angle (°)', type: 'range', min: 0, max: 90, step: 0.5, default: 15 },
    { key: 'period', label: 'Swing time (s)', type: 'range', min: 0.2, max: 20, step: 0.1, default: 3 },
    { key: 'pivot', label: 'Pivot', type: 'select', options: ['Top', 'Centre', 'Bottom'], default: 'Top' },
  ],
  apply(p, ctx, out, b) {
    const theta = n(p.angle) * Math.sin((ctx.time * TAU) / Math.max(0.1, n(p.period)) + phase(ctx, b));
    out.rotation += theta;
    const py = p.pivot === 'Top' ? -ctx.obj.height / 2 : p.pivot === 'Bottom' ? ctx.obj.height / 2 : 0;
    if (py === 0) return;
    // Rotating about the centre moves the pivot; shift back so the pivot stays put.
    const a = theta / DEG;
    const [x, y] = rotateVec(py * Math.sin(a), py - py * Math.cos(a), ctx.obj.rotation);
    out.dx += x;
    out.dy += y;
  },
};

const fall: BehaviorDef = {
  type: 'fall',
  label: 'Fall / rise',
  icon: '↓',
  description: 'Falls (or rises, with a negative speed) through the whole screen, swaying and tumbling, then starts again.',
  params: [
    { key: 'speed', label: 'Speed (px/s, negative rises)', type: 'range', min: -800, max: 800, step: 5, default: 80 },
    { key: 'sway', label: 'Sway (px)', type: 'range', min: 0, max: 400, step: 1, default: 40 },
    { key: 'period', label: 'Sway time (s)', type: 'range', min: 0.3, max: 20, step: 0.1, default: 3 },
    { key: 'spin', label: 'Tumble (°/s)', type: 'range', min: -360, max: 360, step: 1, default: 25 },
  ],
  apply(p, ctx, out, b) {
    const margin = Math.max(Math.abs(ctx.obj.width), Math.abs(ctx.obj.height)) / 2 + 10;
    const y = wrap(ctx.obj.y + n(p.speed) * ctx.time, -margin, ctx.scene.height + margin);
    out.dy += y - ctx.obj.y;
    out.dx += Math.sin((ctx.time * TAU) / Math.max(0.1, n(p.period)) + phase(ctx, b)) * n(p.sway);
    out.rotation += (n(p.spin) * ctx.time) % 360;
  },
};

const orbit: BehaviorDef = {
  type: 'orbit',
  label: 'Orbit',
  icon: '◎',
  description: 'Circles around the position where you placed it.',
  params: [
    { key: 'radius', label: 'Radius (px)', type: 'range', min: 1, max: 2000, step: 1, default: 120 },
    { key: 'period', label: 'Time per lap (s)', type: 'range', min: 0.5, max: 120, step: 0.5, default: 8 },
    { key: 'direction', label: 'Direction', type: 'select', options: ['Clockwise', 'Anticlockwise'], default: 'Clockwise' },
    { key: 'squash', label: 'Height of the ellipse', type: 'range', min: 0.05, max: 1, step: 0.01, default: 1 },
  ],
  apply(p, ctx, out) {
    const dir = p.direction === 'Anticlockwise' ? -1 : 1;
    const a = (dir * ctx.time * TAU) / Math.max(0.1, n(p.period));
    out.dx += Math.cos(a) * n(p.radius);
    out.dy += Math.sin(a) * n(p.radius) * n(p.squash);
  },
};

const pulse: BehaviorDef = {
  type: 'pulse',
  label: 'Scale pulse',
  icon: '⊕',
  description: 'Grows and shrinks rhythmically, like a heartbeat or a glowing star.',
  params: [
    { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 1, step: 0.01, default: 0.1 },
    { key: 'period', label: 'Cycle (s)', type: 'range', min: 0.1, max: 20, step: 0.05, default: 2 },
  ],
  apply(p, ctx, out, b) {
    const s = 1 + n(p.amount) * Math.sin((ctx.time * TAU) / Math.max(0.05, n(p.period)) + phase(ctx, b));
    out.scaleX *= s;
    out.scaleY *= s;
  },
};

const fade: BehaviorDef = {
  type: 'fade',
  label: 'Fade / twinkle',
  icon: '◐',
  description: 'Fades in and out smoothly, twinkles irregularly, or fades in once at the start.',
  params: [
    { key: 'mode', label: 'Style', type: 'select', options: ['Pulse', 'Twinkle', 'Fade in once'], default: 'Pulse' },
    { key: 'min', label: 'Lowest opacity', type: 'range', min: 0, max: 1, step: 0.01, default: 0.2 },
    { key: 'period', label: 'Cycle (s)', type: 'range', min: 0.1, max: 30, step: 0.05, default: 2 },
  ],
  apply(p, ctx, out, b) {
    const lo = n(p.min);
    const period = Math.max(0.05, n(p.period));
    let level: number;
    if (p.mode === 'Fade in once') level = Math.min(1, ctx.time / period);
    else if (p.mode === 'Twinkle') level = 0.5 + 0.5 * smoothNoise((ctx.time * TAU) / period, ctx.obj.seed, b.id.length);
    else level = 0.5 + 0.5 * Math.cos((ctx.time * TAU) / period + phase(ctx, b));
    out.alpha *= lo + (1 - lo) * level;
  },
};

const wander: BehaviorDef = {
  type: 'wander',
  label: 'Wander',
  icon: '∿',
  description: 'Moves around unpredictably near where you placed it, like a firefly or a fish.',
  params: [
    { key: 'radius', label: 'Range (px)', type: 'range', min: 1, max: 2000, step: 1, default: 80 },
    { key: 'speed', label: 'Liveliness', type: 'range', min: 0.02, max: 5, step: 0.01, default: 0.4 },
    { key: 'tilt', label: 'Turning (°)', type: 'range', min: 0, max: 90, step: 1, default: 0 },
    FACE,
  ],
  apply(p, ctx, out, b) {
    const t = ctx.time * n(p.speed) * TAU * 0.25;
    const salt = b.id.length * 7;
    out.dx += n(p.radius) * smoothNoise(t, ctx.obj.seed, salt);
    out.dy += n(p.radius) * 0.7 * smoothNoise(t, ctx.obj.seed, salt + 10);
    out.rotation += n(p.tilt) * smoothNoise(t * 0.8, ctx.obj.seed, salt + 20);
    if (p.face) {
      const ahead = n(p.radius) * smoothNoise(t + 0.05, ctx.obj.seed, salt);
      face(ctx, out, ahead - n(p.radius) * smoothNoise(t, ctx.obj.seed, salt));
    }
  },
};

// -------------------------------------------------------------------------------- path

interface BuiltPath {
  pts: PathPoint[];
  /** Cumulative length at each point. */
  cum: number[];
  total: number;
}

const pathCache = new WeakMap<Behavior, Map<string, BuiltPath>>();

/** Catmull-Rom through the control points, sampled into a polyline. */
export function smoothPath(points: PathPoint[], closed: boolean, perSegment = 12): PathPoint[] {
  if (points.length < 3) return closed && points.length === 2 ? [...points, points[0]] : [...points];
  const at = (i: number) => (closed ? points[(i + points.length) % points.length] : points[Math.min(points.length - 1, Math.max(0, i))]);
  const out: PathPoint[] = [];
  const segments = closed ? points.length : points.length - 1;
  for (let i = 0; i < segments; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    for (let s = 0; s < perSegment; s++) {
      const t = s / perSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  out.push(closed ? { ...points[0] } : { ...points[points.length - 1] });
  return out;
}

/** The polyline an object follows: it always starts at the object's own position (0, 0). */
export function buildPath(b: Behavior, smooth: boolean, closed: boolean): BuiltPath {
  const key = `${smooth}|${closed}`;
  let byKey = pathCache.get(b);
  const cached = byKey?.get(key);
  if (cached) return cached;
  const control = [{ x: 0, y: 0 }, ...(b.path ?? [])];
  let pts = smooth ? smoothPath(control, closed) : [...control];
  if (!smooth && closed && control.length > 1) pts = [...pts, control[0]];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const built = { pts, cum, total: cum[cum.length - 1] };
  if (!byKey) pathCache.set(b, (byKey = new Map()));
  byKey.set(key, built);
  return built;
}

/** Point and direction at distance d along a built path. */
export function pointAlong(path: BuiltPath, d: number): { x: number; y: number; tx: number; ty: number } {
  const { pts, cum } = path;
  if (pts.length === 1 || path.total === 0) return { x: pts[0].x, y: pts[0].y, tx: 1, ty: 0 };
  d = Math.min(path.total, Math.max(0, d));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const a = pts[i - 1];
  const b = pts[i];
  const len = cum[i] - cum[i - 1];
  const q = len > 0 ? (d - cum[i - 1]) / len : 0;
  return { x: a.x + (b.x - a.x) * q, y: a.y + (b.y - a.y) * q, tx: b.x - a.x, ty: b.y - a.y };
}

const path: BehaviorDef = {
  type: 'path',
  label: 'Follow path',
  icon: '⤳',
  description: 'Travels along a path you draw on the canvas, starting from where the object is.',
  params: [
    { key: 'speed', label: 'Speed (px/s)', type: 'range', min: 5, max: 2000, step: 5, default: 150 },
    { key: 'mode', label: 'At the end', type: 'select', options: ['Loop back to start', 'Go back the same way', 'Stop'], default: 'Loop back to start' },
    { key: 'smooth', label: 'Smooth curves', type: 'bool', default: true },
    { key: 'orient', label: 'Orientation', type: 'select', options: ['Face the way it moves', 'Turn along the path', 'Keep as placed'], default: 'Face the way it moves' },
  ],
  apply(p, ctx, out, b) {
    if (!b.path || b.path.length === 0) return;
    const closed = p.mode === 'Loop back to start';
    const built = buildPath(b, Boolean(p.smooth), closed);
    if (built.total <= 0) return;
    const dist = n(p.speed) * ctx.time;
    let d: number;
    let forward = 1;
    if (closed) d = dist % built.total;
    else if (p.mode === 'Go back the same way') {
      const f = ((dist / built.total) % 2 + 2) % 2;
      d = triangle(dist / built.total) * built.total;
      forward = f < 1 ? 1 : -1;
    } else d = Math.min(dist, built.total);
    const at = pointAlong(built, d);
    out.dx += at.x;
    out.dy += at.y;
    const tx = at.tx * forward;
    const ty = at.ty * forward;
    if (p.orient === 'Turn along the path') {
      out.rotation += Math.atan2(ty, tx) * DEG - ctx.obj.rotation;
      if (ctx.obj.flipX) out.rotation += 180;
    } else if (p.orient === 'Face the way it moves' && Math.abs(tx) > 1e-6) face(ctx, out, tx);
  },
};

// ----------------------------------------------------------------------- interactive

const follow: BehaviorDef = {
  type: 'follow',
  label: 'Mouse follow',
  icon: '⌖',
  description: 'Leans towards the mouse pointer, or shies away from it.',
  needs: 'pointer',
  params: [
    { key: 'mode', label: 'Reaction', type: 'select', options: ['Follow', 'Avoid'], default: 'Follow' },
    { key: 'strength', label: 'Strength', type: 'range', min: 0, max: 1, step: 0.01, default: 0.3 },
    { key: 'reach', label: 'Reach (px)', type: 'range', min: 10, max: 3000, step: 10, default: 300 },
    { key: 'smoothing', label: 'Responsiveness', type: 'range', min: 0.2, max: 20, step: 0.1, default: 3 },
    FACE,
  ],
  apply(p, ctx, out) {
    const s = ctx.state;
    s.x ??= 0;
    s.y ??= 0;
    let tx = 0;
    let ty = 0;
    if (ctx.pointer) {
      const vx = ctx.pointer.x - (ctx.obj.x + out.dx);
      const vy = ctx.pointer.y - (ctx.obj.y + out.dy);
      const dist = Math.hypot(vx, vy);
      const reach = n(p.reach);
      if (p.mode === 'Avoid') {
        if (dist < reach && dist > 0.001) {
          const push = (reach - dist) * (0.4 + n(p.strength));
          tx = (-vx / dist) * push;
          ty = (-vy / dist) * push;
        }
      } else {
        const k = Math.min(1, dist > 0 ? (reach / dist) : 1);
        tx = vx * n(p.strength) * k;
        ty = vy * n(p.strength) * k;
      }
    }
    const k = 1 - Math.exp(-n(p.smoothing) * ctx.dt);
    const before = s.x;
    s.x += (tx - s.x) * k;
    s.y += (ty - s.y) * k;
    out.dx += s.x;
    out.dy += s.y;
    if (p.face) {
      const v = s.x - before;
      if (Math.abs(v) > 0.05) s.heading = Math.sign(v);
      if (s.heading) face(ctx, out, s.heading);
    }
  },
};

const audio: BehaviorDef = {
  type: 'audio',
  label: 'Sound reactive',
  icon: '♫',
  description: 'Reacts to the sound playing on this PC (music, videos).',
  needs: 'audio',
  params: [
    { key: 'effect', label: 'Effect', type: 'select', options: ['Grow', 'Jump', 'Light up'], default: 'Grow' },
    { key: 'amount', label: 'Amount', type: 'range', min: 0, max: 3, step: 0.05, default: 1 },
  ],
  apply(p, ctx, out) {
    const level = Math.min(1, Math.max(0, ctx.audio)) * n(p.amount);
    if (p.effect === 'Jump') out.dy -= level * 120;
    else if (p.effect === 'Light up') out.alpha *= Math.min(1, 0.15 + level);
    else {
      out.scaleX *= 1 + level * 0.35;
      out.scaleY *= 1 + level * 0.35;
    }
  },
};

export const BEHAVIOR_DEFS: BehaviorDef[] = [
  walker('walk', 'Walk', '🚶', 60, 4, 2.2),
  walker('run', 'Run', '🏃', 260, 10, 4.5),
  fly,
  jump,
  bounce,
  float,
  swing,
  spin,
  orbit,
  fall,
  wander,
  path,
  pulse,
  fade,
  follow,
  audio,
];

const byType = new Map(BEHAVIOR_DEFS.map((d) => [d.type, d]));

export function getBehaviorDef(type: string): BehaviorDef | undefined {
  return byType.get(type);
}

const paramCache = new WeakMap<Behavior, ParamValues>();

/** Behaviour params merged over defaults (cached per immutable behaviour object). */
export function behaviorParams(b: Behavior): ParamValues {
  let p = paramCache.get(b);
  if (!p) {
    const def = getBehaviorDef(b.type);
    p = def ? resolveParams(def.params, b.params) : {};
    paramCache.set(b, p);
  }
  return p;
}

/**
 * Composes every enabled behaviour of an object into one Motion. `states` keeps per-behaviour
 * scratch values between frames (keyed by behaviour id); pass a fresh map for one-off frames.
 */
export function evaluateBehaviors(
  obj: SceneObject,
  env: Omit<BehaviorContext, 'obj' | 'state'>,
  states: Map<string, Record<string, number>>,
  out: Motion = identityMotion(),
): Motion {
  for (const b of obj.behaviors) {
    if (!b.enabled) continue;
    const def = getBehaviorDef(b.type);
    if (!def) continue;
    let state = states.get(b.id);
    if (!state) states.set(b.id, (state = {}));
    def.apply(behaviorParams(b), { ...env, obj, state }, out, b);
  }
  return out;
}

/** Which live inputs (mouse, audio) a scene needs from the host. */
export function sceneNeeds(objects: SceneObject[]): BehaviorNeed[] {
  const needs = new Set<BehaviorNeed>();
  for (const o of objects) {
    for (const b of o.behaviors) {
      const need = b.enabled && !o.hidden ? getBehaviorDef(b.type)?.needs : undefined;
      if (need) needs.add(need);
    }
  }
  return [...needs];
}
