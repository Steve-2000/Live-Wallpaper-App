import { ANIMATABLE, type AnimProp, type Ease, type Keyframe, type SceneObject, type Timeline, type Tracks } from './types';

// Keyframe animation. Everything here is a pure function of time, so the editor can scrub,
// the wallpaper can loop and still exports land on exactly the same frame every time.

/** Keys closer than this (seconds) are treated as the same key. */
export const KEY_EPSILON = 1 / 120;

const PI2 = Math.PI * 2;

function bounceOut(p: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (p < 1 / d) return n * p * p;
  if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75;
  if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375;
  return n * (p -= 2.625 / d) * p + 0.984375;
}

/** Maps progress 0..1 to eased progress (may overshoot for back/elastic). */
export function ease(kind: Ease, p: number): number {
  p = Math.min(1, Math.max(0, p));
  switch (kind) {
    case 'linear': return p;
    case 'easeIn': return p * p * p;
    case 'easeOut': return 1 - (1 - p) ** 3;
    case 'easeInOut': return p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
    case 'step': return p < 1 ? 0 : 1;
    case 'back': { const c = 1.70158; return 1 + (c + 1) * (p - 1) ** 3 + c * (p - 1) ** 2; }
    case 'elastic': return p === 0 || p === 1 ? p : 2 ** (-10 * p) * Math.sin(((p * 10 - 0.75) * PI2) / 3) + 1;
    case 'bounce': return bounceOut(p);
  }
}

/** Value of a track at time t; undefined for an empty track. Holds the first/last value outside the keys. */
export function sampleTrack(keys: readonly Keyframe[] | undefined, t: number): number | undefined {
  if (!keys || keys.length === 0) return undefined;
  if (t <= keys[0].t) return keys[0].value;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.value;
  let i = 1;
  while (keys[i].t < t) i++;
  const a = keys[i - 1];
  const b = keys[i];
  const span = b.t - a.t;
  const p = span <= 0 ? 1 : ease(b.ease, (t - a.t) / span);
  return a.value + (b.value - a.value) * p;
}

/** Scene clock (seconds since start) -> position on the timeline. */
export function timelineTime(clock: number, timeline: Timeline): number {
  const d = Math.max(0.1, timeline.duration);
  if (clock <= 0) return 0;
  return timeline.loop ? clock % d : Math.min(clock, d);
}

export function hasKeyframes(o: Pick<SceneObject, 'keyframes'>): boolean {
  return ANIMATABLE.some((p) => (o.keyframes[p]?.length ?? 0) > 0);
}

/** The object as it stands at time t: static fields with keyframed values substituted. */
export function poseAt(o: SceneObject, t: number): SceneObject {
  if (!hasKeyframes(o)) return o;
  const out = { ...o };
  for (const prop of ANIMATABLE) {
    const v = sampleTrack(o.keyframes[prop], t);
    if (v !== undefined) out[prop] = clampProp(prop, v);
  }
  return out;
}

/** Keeps sampled values (which can overshoot with back/elastic) inside what the renderer accepts. */
export function clampProp(prop: AnimProp, v: number): number {
  switch (prop) {
    case 'width':
    case 'height': return Math.max(1, v);
    case 'opacity': return Math.min(1, Math.max(0, v));
    case 'brightness': return Math.min(3, Math.max(0, v));
    default: return v;
  }
}

/** Every key time used by an object (for the collapsed timeline row). */
export function keyTimes(tracks: Tracks): number[] {
  const times: number[] = [];
  for (const prop of ANIMATABLE) {
    for (const k of tracks[prop] ?? []) {
      if (!times.some((x) => Math.abs(x - k.t) < KEY_EPSILON)) times.push(k.t);
    }
  }
  return times.sort((a, b) => a - b);
}

export function keyAt(keys: readonly Keyframe[] | undefined, t: number): Keyframe | undefined {
  return keys?.find((k) => Math.abs(k.t - t) < KEY_EPSILON);
}

// ------------------------------------------------------------------ editing (pure, return new objects)

const roundTime = (t: number) => Math.max(0, Math.round(t * 1000) / 1000);

/** Adds or replaces the key at time t. A new key takes the ease of the key it replaces, else `fallbackEase`. */
export function setKey(tracks: Tracks, prop: AnimProp, t: number, value: number, fallbackEase: Ease = 'easeInOut'): Tracks {
  t = roundTime(t);
  const keys = tracks[prop] ?? [];
  const existing = keyAt(keys, t);
  const key: Keyframe = { t: existing?.t ?? t, value, ease: existing?.ease ?? fallbackEase };
  const next = [...keys.filter((k) => k !== existing), key].sort((a, b) => a.t - b.t);
  return { ...tracks, [prop]: next };
}

export function removeKey(tracks: Tracks, prop: AnimProp, t: number): Tracks {
  const keys = (tracks[prop] ?? []).filter((k) => Math.abs(k.t - t) >= KEY_EPSILON);
  const next = { ...tracks };
  if (keys.length > 0) next[prop] = keys;
  else delete next[prop];
  return next;
}

/** Moves the key at `from` to `to` (replacing anything already at `to`). */
export function moveKey(tracks: Tracks, prop: AnimProp, from: number, to: number): Tracks {
  const keys = tracks[prop] ?? [];
  const moving = keyAt(keys, from);
  if (!moving) return tracks;
  to = roundTime(to);
  const rest = keys.filter((k) => k !== moving && Math.abs(k.t - to) >= KEY_EPSILON);
  return { ...tracks, [prop]: [...rest, { ...moving, t: to }].sort((a, b) => a.t - b.t) };
}

export function setKeyEase(tracks: Tracks, prop: AnimProp, t: number, kind: Ease): Tracks {
  const keys = tracks[prop];
  if (!keyAt(keys, t)) return tracks;
  return { ...tracks, [prop]: keys!.map((k) => (Math.abs(k.t - t) < KEY_EPSILON ? { ...k, ease: kind } : k)) };
}

const isAnimatable = (key: string): key is AnimProp => (ANIMATABLE as readonly string[]).includes(key);

/**
 * Applies an edit made while the playhead is at `t`. Animatable fields that already have keys
 * (or every animatable field, when `record` is on) are written as keys at t; everything else
 * changes the static value. Keyed fields keep their static value so removing the last key
 * doesn't make the object jump.
 */
export function applyAnimatedChange(o: SceneObject, change: Partial<SceneObject>, t: number, record: boolean): SceneObject {
  let tracks = o.keyframes;
  const staticChange: Partial<SceneObject> = {};
  for (const [key, value] of Object.entries(change) as Array<[keyof SceneObject, unknown]>) {
    if (isAnimatable(key) && typeof value === 'number' && (record || (tracks[key]?.length ?? 0) > 0)) {
      tracks = setKey(tracks, key, t, value);
    } else {
      (staticChange as Record<string, unknown>)[key] = value;
    }
  }
  return tracks === o.keyframes ? { ...o, ...staticChange } : { ...o, ...staticChange, keyframes: tracks };
}

/**
 * The ◆ button next to a property: removes the key at t if there is one, otherwise records the
 * property's current (posed) value. Removing the last key copies its value to the static field.
 */
export function toggleKey(o: SceneObject, prop: AnimProp, t: number): SceneObject {
  const keys = o.keyframes[prop];
  const existing = keyAt(keys, t);
  if (existing) {
    const tracks = removeKey(o.keyframes, prop, t);
    return tracks[prop] ? { ...o, keyframes: tracks } : { ...o, [prop]: existing.value, keyframes: tracks };
  }
  return { ...o, keyframes: setKey(o.keyframes, prop, t, poseAt(o, t)[prop]) };
}

/** Removes every key of an object (the static pose becomes the pose at time t). */
export function clearKeys(o: SceneObject, t: number): SceneObject {
  return { ...poseAt(o, t), keyframes: {} };
}

/** Shifts all of an object's keys of every property sitting at `from` to `to`. */
export function moveKeysAt(o: SceneObject, from: number, to: number): SceneObject {
  let tracks = o.keyframes;
  for (const prop of ANIMATABLE) if (keyAt(tracks[prop], from)) tracks = moveKey(tracks, prop, from, to);
  return tracks === o.keyframes ? o : { ...o, keyframes: tracks };
}

export function removeKeysAt(o: SceneObject, t: number): SceneObject {
  let next = o;
  for (const prop of ANIMATABLE) if (keyAt(next.keyframes[prop], t)) next = toggleKey(next, prop, t);
  return next;
}
