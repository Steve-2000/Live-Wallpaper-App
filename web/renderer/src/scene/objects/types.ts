import { Texture, type Container } from 'pixi.js';
import type { ParamSpec, ParamValues } from '../../runtime/types';

export type ObjectCategory = 'Sky' | 'Nature' | 'Animals' | 'Effects' | 'Text & Clocks' | 'Widgets' | 'Shapes';

/** Shared, lazily-created textures (one set per runtime). */
export interface ObjectTextures {
  /** Soft radial glow, white (tint it). */
  glow: Texture;
  /** Small hard-edged white dot. */
  dot: Texture;
}

/** CPU / memory / battery as reported by the native host (percentages, null when unknown). */
export interface SystemInfo {
  cpu: number | null;
  memory: number | null;
  battery: number | null;
  charging: boolean;
  hasBattery: boolean;
}

/** Data from outside the scene, shared by every object of a runtime and updated in place. */
export interface LiveData {
  /** Null until the host sends values (always null in the editor and browser previews). */
  system: SystemInfo | null;
}

export interface ObjectContext {
  /** Seeded per object, so procedural shapes are stable between loads. */
  random: () => number;
  textures: ObjectTextures;
  live: LiveData;
}

export interface ObjectView {
  /** Content drawn in a local frame centred on (0,0) and filling width x height. */
  readonly root: Container;
  /** (Re)draws for a size and settings; called on create and whenever size or settings change. */
  build(width: number, height: number, props: ParamValues): void;
  /** Built-in animation; `time` is the object's own clock (already scaled by its speed). */
  update(dt: number, time: number): void;
  dispose?(): void;
}

export interface ObjectDef {
  type: string;
  label: string;
  category: ObjectCategory;
  /** Single symbol shown in the editor library. */
  icon: string;
  defaultSize: [number, number];
  props: ParamSpec[];
  /** Live data this object asks the host for while it's on the desktop. */
  needs?: 'system';
  create(ctx: ObjectContext): ObjectView;
}

export const hex = (value: unknown, fallback = 0xffffff): number => {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) return fallback;
  return parseInt(value.slice(1), 16);
};

export const num = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/** Mixes two 0xRRGGBB colours. */
export function mix(a: number, b: number, t: number): number {
  const ch = (shift: number) => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export function createTextures(): ObjectTextures {
  const make = (size: number, paint: (g: CanvasRenderingContext2D, s: number) => void) => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    paint(c.getContext('2d')!, size);
    return Texture.from(c);
  };
  return {
    glow: make(128, (g, s) => {
      const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.2, 'rgba(255,255,255,0.75)');
      grad.addColorStop(0.5, 'rgba(255,255,255,0.18)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, s, s);
    }),
    dot: make(32, (g, s) => {
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(s / 2, s / 2, s / 2 - 1, 0, Math.PI * 2);
      g.fill();
    }),
  };
}
