import { clampProp } from './animation';
import {
  ANIMATABLE, EASES, SCENE_VERSION,
  type Behavior, type Ease, type Keyframe, type Scene, type SceneBackground, type SceneObject, type Timeline, type Tracks,
} from './types';
import type { ParamValue } from '../runtime/types';

export class SceneError extends Error {}

type Raw = Record<string, unknown>;

const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number, min = -Infinity, max = Infinity) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const str = (v: unknown, fallback: string, maxLength = 200) => (typeof v === 'string' ? v.slice(0, maxLength) : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
const color = (v: unknown, fallback: string) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : fallback);

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/**
 * Upgrades older scene files to the current format. Each step converts version N to N+1.
 * Files written by a newer DreamCanvas are refused rather than silently damaged.
 */
export function migrateScene(raw: unknown): Raw {
  if (!isObj(raw)) throw new SceneError('Scene file is not a JSON object.');
  const version = typeof raw.sceneVersion === 'number' ? raw.sceneVersion : 1;
  if (version > SCENE_VERSION) {
    throw new SceneError(`This scene was made with a newer DreamCanvas (format ${version}); please update the app.`);
  }
  const scene: Raw = { ...raw };
  if (version < 2) {
    // v1 -> v2: timeline, behaviours and keyframes. Older scenes simply have none.
    scene.timeline = { duration: 10, loop: true };
    if (Array.isArray(scene.objects)) {
      scene.objects = scene.objects.map((o) => (isObj(o) ? { ...o, behaviors: [], keyframes: {} } : o));
    }
  }
  scene.sceneVersion = SCENE_VERSION;
  return scene;
}

const MAX_KEYS = 500;
const MAX_BEHAVIORS = 16;
const MAX_PATH_POINTS = 200;

function keyframes(v: unknown): Tracks {
  const out: Tracks = {};
  if (!isObj(v)) return out;
  for (const prop of ANIMATABLE) {
    const list = v[prop];
    if (!Array.isArray(list)) continue;
    const keys: Keyframe[] = [];
    for (const k of list.slice(0, MAX_KEYS)) {
      if (!isObj(k) || typeof k.t !== 'number' || typeof k.value !== 'number' || !Number.isFinite(k.t) || !Number.isFinite(k.value)) continue;
      const t = Math.min(3600, Math.max(0, k.t));
      if (keys.some((x) => Math.abs(x.t - t) < 1e-6)) continue;
      keys.push({ t, value: clampProp(prop, num(k.value, 0, -100_000, 100_000)), ease: (EASES as readonly unknown[]).includes(k.ease) ? (k.ease as Ease) : 'easeInOut' });
    }
    if (keys.length > 0) out[prop] = keys.sort((a, b) => a.t - b.t);
  }
  return out;
}

function behaviors(v: unknown): Behavior[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: Behavior[] = [];
  for (const b of v.slice(0, MAX_BEHAVIORS)) {
    if (!isObj(b) || typeof b.type !== 'string' || !b.type) continue;
    let id = str(b.id, '', 64);
    if (!id || seen.has(id)) id = newId();
    seen.add(id);
    const behavior: Behavior = { id, type: str(b.type, 'float', 64), enabled: bool(b.enabled, true), params: props(b.params) };
    if (Array.isArray(b.path)) {
      behavior.path = b.path
        .filter((p): p is Raw => isObj(p) && typeof p.x === 'number' && typeof p.y === 'number')
        .slice(0, MAX_PATH_POINTS)
        .map((p) => ({ x: num(p.x, 0, -100_000, 100_000), y: num(p.y, 0, -100_000, 100_000) }));
    }
    out.push(behavior);
  }
  return out;
}

function timeline(v: unknown): Timeline {
  if (!isObj(v)) return { duration: 10, loop: true };
  return { duration: num(v.duration, 10, 0.5, 600), loop: bool(v.loop, true) };
}

function props(v: unknown): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  if (!isObj(v)) return out;
  for (const [k, value] of Object.entries(v)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[k] = value;
    else if (typeof value === 'boolean') out[k] = value;
    else if (typeof value === 'string') out[k] = value.slice(0, 500);
  }
  return out;
}

function background(v: unknown): SceneBackground {
  if (isObj(v)) {
    if (v.kind === 'gradient') return { kind: 'gradient', from: color(v.from, '#0b1026'), to: color(v.to, '#2a1b4a'), angle: num(v.angle, 90, 0, 360) };
    if (v.kind === 'preset' && typeof v.presetId === 'string')
      return { kind: 'preset', presetId: str(v.presetId, 'aurora', 64), params: props(v.params), seed: Math.trunc(num(v.seed, 1337, 0, 2 ** 32 - 1)) };
    if (v.kind === 'color') return { kind: 'color', color: color(v.color, '#0b1026') };
  }
  return { kind: 'color', color: '#0b1026' };
}

function sceneObject(v: unknown, seenIds: Set<string>): SceneObject | null {
  if (!isObj(v) || typeof v.type !== 'string' || !v.type) return null;
  let id = str(v.id, '', 64);
  if (!id || seenIds.has(id)) id = newId(); // ids must be unique for selection and history
  seenIds.add(id);
  return {
    id,
    type: str(v.type, 'shape', 64),
    name: str(v.name, v.type, 80),
    x: num(v.x, 0, -100_000, 100_000),
    y: num(v.y, 0, -100_000, 100_000),
    width: num(v.width, 100, 1, 100_000),
    height: num(v.height, 100, 1, 100_000),
    rotation: num(v.rotation, 0, -36_000, 36_000),
    flipX: bool(v.flipX, false),
    flipY: bool(v.flipY, false),
    opacity: num(v.opacity, 1, 0, 1),
    brightness: num(v.brightness, 1, 0, 3),
    speed: num(v.speed, 1, 0, 10),
    locked: bool(v.locked, false),
    hidden: bool(v.hidden, false),
    groupId: typeof v.groupId === 'string' && v.groupId ? v.groupId.slice(0, 64) : undefined,
    props: props(v.props),
    seed: Math.trunc(num(v.seed, 1, 0, 2 ** 32 - 1)),
    behaviors: behaviors(v.behaviors),
    keyframes: keyframes(v.keyframes),
  };
}

/** Parses, migrates and sanitises a scene. Never throws for recoverable damage; throws SceneError otherwise. */
export function parseScene(input: unknown): Scene {
  const raw = migrateScene(typeof input === 'string' ? safeJson(input) : input);
  const seen = new Set<string>();
  const objects = Array.isArray(raw.objects)
    ? raw.objects.map((o) => sceneObject(o, seen)).filter((o): o is SceneObject => o !== null).slice(0, 2000)
    : [];
  return {
    sceneVersion: SCENE_VERSION,
    id: str(raw.id, '', 64) || newId(),
    name: str(raw.name, 'Untitled scene', 120) || 'Untitled scene',
    width: Math.round(num(raw.width, 1920, 320, 8192)),
    height: Math.round(num(raw.height, 1080, 240, 8192)),
    background: background(raw.background),
    timeline: timeline(raw.timeline),
    objects,
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new SceneError(`Scene file is not valid JSON: ${(e as Error).message}`);
  }
}

export function emptyScene(name = 'Untitled scene'): Scene {
  return {
    sceneVersion: SCENE_VERSION,
    id: newId(),
    name,
    width: 1920,
    height: 1080,
    background: { kind: 'gradient', from: '#0b1026', to: '#1d2b53', angle: 90 },
    timeline: { duration: 10, loop: true },
    objects: [],
  };
}
