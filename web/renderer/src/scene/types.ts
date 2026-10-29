import type { ParamValue } from '../runtime/types';

/** Current editable-scene format. Bump and add a step in migrateScene (validate.ts) when the format changes. */
export const SCENE_VERSION = 2;

/** Object fields that keyframes can animate. */
export const ANIMATABLE = ['x', 'y', 'width', 'height', 'rotation', 'opacity', 'brightness'] as const;
export type AnimProp = (typeof ANIMATABLE)[number];

export const EASES = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'step', 'back', 'elastic', 'bounce'] as const;
export type Ease = (typeof EASES)[number];

/** A value at a moment on the scene timeline. `ease` shapes the approach to this key from the previous one. */
export interface Keyframe {
  /** Seconds from the start of the timeline. */
  t: number;
  value: number;
  ease: Ease;
}

/** Keyframes per property, sorted by time. A property with keys ignores its static value. */
export type Tracks = Partial<Record<AnimProp, Keyframe[]>>;

export interface PathPoint {
  /** Offset from the object's position, in design pixels. */
  x: number;
  y: number;
}

/** A reusable motion (walk, fly, orbit...) layered on top of the object's pose. */
export interface Behavior {
  id: string;
  /** Key into the behaviour registry (scene/behaviors). */
  type: string;
  enabled: boolean;
  params: Record<string, ParamValue>;
  /** Only used by the path behaviour. */
  path?: PathPoint[];
}

export interface Timeline {
  /** Length of the keyframe timeline in seconds. */
  duration: number;
  /** Start again at the end; otherwise hold the last frame. */
  loop: boolean;
}

/** One independently editable thing on the canvas (a moon, a bird, a clock...). */
export interface SceneObject {
  id: string;
  /** Key into the object registry (scene/objects). */
  type: string;
  name: string;
  /** Centre position and size in design pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees, clockwise. */
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  /** 0..1 */
  opacity: number;
  /** 1 = unchanged, 0 = black, 2 = twice as bright. */
  brightness: number;
  /** Multiplier for the object's own animation. */
  speed: number;
  locked: boolean;
  hidden: boolean;
  /** Objects sharing a groupId are selected and moved together. */
  groupId?: string;
  /** Type-specific settings, validated against the type's ParamSpec list. */
  props: Record<string, ParamValue>;
  /** Seed for procedural shapes, so an object looks the same every time it loads. */
  seed: number;
  /** Applied in order; their offsets add up. */
  behaviors: Behavior[];
  keyframes: Tracks;
}

export type SceneBackground =
  | { kind: 'color'; color: string }
  | { kind: 'gradient'; from: string; to: string; angle: number }
  | { kind: 'preset'; presetId: string; params: Record<string, ParamValue>; seed: number };

export interface Scene {
  sceneVersion: number;
  id: string;
  name: string;
  /** Design resolution; the scene is scaled to cover each monitor. */
  width: number;
  height: number;
  background: SceneBackground;
  timeline: Timeline;
  /** Back-to-front drawing order (last = on top). */
  objects: SceneObject[];
}
