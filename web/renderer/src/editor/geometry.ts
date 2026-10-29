import type { SceneObject } from '../scene/types';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Box = Pick<SceneObject, 'x' | 'y' | 'width' | 'height' | 'rotation'>;

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Design-space point -> the object's local frame (origin at its centre, unrotated). */
export function toLocal(o: Box, p: Point): Point {
  const a = rad(o.rotation);
  const dx = p.x - o.x;
  const dy = p.y - o.y;
  return { x: dx * Math.cos(a) + dy * Math.sin(a), y: -dx * Math.sin(a) + dy * Math.cos(a) };
}

export function toWorld(o: Box, p: Point): Point {
  const a = rad(o.rotation);
  return { x: o.x + p.x * Math.cos(a) - p.y * Math.sin(a), y: o.y + p.x * Math.sin(a) + p.y * Math.cos(a) };
}

/** The four corners in design space: top-left, top-right, bottom-right, bottom-left. */
export function corners(o: Box): Point[] {
  const w = o.width / 2;
  const h = o.height / 2;
  return [{ x: -w, y: -h }, { x: w, y: -h }, { x: w, y: h }, { x: -w, y: h }].map((p) => toWorld(o, p));
}

export function contains(o: Box, p: Point, tolerance = 0): boolean {
  const l = toLocal(o, p);
  return Math.abs(l.x) <= o.width / 2 + tolerance && Math.abs(l.y) <= o.height / 2 + tolerance;
}

/** Top-most visible, unlocked object under the point (objects are drawn back to front). */
export function hitTest(objects: SceneObject[], p: Point, tolerance = 0): SceneObject | undefined {
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (!o.hidden && !o.locked && contains(o, p, tolerance)) return o;
  }
  return undefined;
}

/** Axis-aligned bounds of one or more (possibly rotated) objects. */
export function bounds(objects: Box[]): Rect | null {
  if (objects.length === 0) return null;
  const pts = objects.flatMap(corners);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const HANDLES: Record<Handle, [number, number]> = {
  nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0],
};

export const MIN_SIZE = 4;

/**
 * Resizes from a handle while the opposite edge/corner stays put, in the object's own
 * (rotated) frame. `keepAspect` preserves proportions (Shift while dragging).
 */
export function resizeFromHandle(start: Box, handle: Handle, pointer: Point, keepAspect: boolean): Pick<SceneObject, 'x' | 'y' | 'width' | 'height'> {
  const [hx, hy] = HANDLES[handle];
  const local = toLocal(start, pointer);
  const anchor = { x: (-hx * start.width) / 2, y: (-hy * start.height) / 2 };
  let w = hx !== 0 ? Math.max(MIN_SIZE, hx * (local.x - anchor.x)) : start.width;
  let h = hy !== 0 ? Math.max(MIN_SIZE, hy * (local.y - anchor.y)) : start.height;
  if (keepAspect) {
    const s = hx !== 0 && hy !== 0 ? Math.max(w / start.width, h / start.height) : hx !== 0 ? w / start.width : h / start.height;
    w = Math.max(MIN_SIZE, start.width * s);
    h = Math.max(MIN_SIZE, start.height * s);
  }
  const centre = {
    x: hx !== 0 ? anchor.x + (hx * w) / 2 : 0,
    y: hy !== 0 ? anchor.y + (hy * h) / 2 : 0,
  };
  // With keepAspect on an edge handle the other axis grows symmetrically around the centre.
  const world = toWorld(start, centre);
  return { x: world.x, y: world.y, width: w, height: h };
}

/** Rotation for a handle dragged to `pointer` (handle sits above the top edge). Shift snaps to 15 degrees. */
export function rotationFromPointer(o: Box, pointer: Point, snap: boolean): number {
  let deg = (Math.atan2(pointer.y - o.y, pointer.x - o.x) * 180) / Math.PI + 90;
  if (snap) deg = Math.round(deg / 15) * 15;
  deg = ((deg % 360) + 360) % 360;
  return deg > 180 ? deg - 360 : deg;
}

export function snap(value: number, grid: number): number {
  return grid > 0 ? Math.round(value / grid) * grid : value;
}
