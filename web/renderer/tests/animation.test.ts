import { describe, expect, it } from 'vitest';
import nightForest from '../public/templates/night-forest.json?raw';
import { updateAnimated, cloneObjects, align } from '../src/editor/operations';
import {
  applyAnimatedChange, clearKeys, ease, keyTimes, moveKey, moveKeysAt, poseAt, removeKey, sampleTrack, setKey, setKeyEase,
  timelineTime, toggleKey,
} from '../src/scene/animation';
import {
  BEHAVIOR_DEFS, buildPath, evaluateBehaviors, getBehaviorDef, pointAlong, sceneNeeds, smoothPath, wrap, type BehaviorContext,
} from '../src/scene/behaviors';
import { EASES, SCENE_VERSION, type Behavior, type Keyframe, type Scene, type SceneObject } from '../src/scene/types';
import { emptyScene, parseScene } from '../src/scene/validate';

const obj = (patch: Partial<SceneObject> = {}): SceneObject => ({
  id: 'o', type: 'bird', name: 'o', x: 500, y: 300, width: 100, height: 60, rotation: 0,
  flipX: false, flipY: false, opacity: 1, brightness: 1, speed: 1, locked: false, hidden: false, props: {}, seed: 7,
  behaviors: [], keyframes: {}, ...patch,
});
const key = (t: number, value: number, e: Keyframe['ease'] = 'linear'): Keyframe => ({ t, value, ease: e });
const env = (time: number, extra: Partial<Omit<BehaviorContext, 'obj' | 'state'>> = {}) => ({
  time, dt: 1 / 30, scene: { width: 1920, height: 1080 }, pointer: null, audio: 0, ...extra,
});
const behave = (type: string, params: Behavior['params'] = {}, extra: Partial<Behavior> = {}): Behavior => ({ id: `b-${type}`, type, enabled: true, params, ...extra });
const motionOf = (o: SceneObject, time: number, extra = {}) => evaluateBehaviors(o, env(time, extra), new Map());

describe('easing', () => {
  it('starts at 0 and ends at 1 for every ease', () => {
    for (const e of EASES) {
      expect(ease(e, 0)).toBeCloseTo(0, 6);
      expect(ease(e, 1)).toBeCloseTo(1, 6);
    }
  });
  it('shapes the middle as expected', () => {
    expect(ease('linear', 0.25)).toBe(0.25);
    expect(ease('easeIn', 0.5)).toBeLessThan(0.5);
    expect(ease('easeOut', 0.5)).toBeGreaterThan(0.5);
    expect(ease('easeInOut', 0.5)).toBeCloseTo(0.5, 6);
    expect(ease('step', 0.99)).toBe(0);
    expect(Math.max(...[0.6, 0.7, 0.8, 0.9].map((p) => ease('back', p)))).toBeGreaterThan(1); // overshoots
  });
});

describe('keyframe sampling', () => {
  const keys = [key(1, 100), key(3, 300, 'linear'), key(5, 0, 'step')];
  it('holds outside the keys and interpolates between them', () => {
    expect(sampleTrack(undefined, 2)).toBeUndefined();
    expect(sampleTrack(keys, 0)).toBe(100);
    expect(sampleTrack(keys, 2)).toBe(200);
    expect(sampleTrack(keys, 4.9)).toBe(300); // step holds until the key
    expect(sampleTrack(keys, 5)).toBe(0);
    expect(sampleTrack(keys, 99)).toBe(0);
  });
  it('maps the scene clock onto a looping or held timeline', () => {
    expect(timelineTime(12.5, { duration: 10, loop: true })).toBeCloseTo(2.5);
    expect(timelineTime(12.5, { duration: 10, loop: false })).toBe(10);
    expect(timelineTime(-1, { duration: 10, loop: true })).toBe(0);
  });
  it('poses an object, clamping overshoot to valid values', () => {
    const o = obj({ keyframes: { x: [key(0, 0), key(2, 200)], opacity: [key(0, 0.5), key(1, 1.4)] } });
    const p = poseAt(o, 1);
    expect(p.x).toBe(100);
    expect(p.opacity).toBe(1);
    expect(p.y).toBe(300); // unkeyed fields keep their static value
    expect(poseAt(obj(), 1)).toEqual(obj()); // no keys: same object
  });
});

describe('keyframe editing', () => {
  it('adds, replaces, moves, re-eases and removes keys', () => {
    let t = setKey({}, 'x', 1, 10);
    t = setKey(t, 'x', 0.5, 5);
    t = setKey(t, 'x', 1.001, 20); // within epsilon of 1 -> replaces
    expect(t.x!.map((k) => [k.t, k.value])).toEqual([[0.5, 5], [1, 20]]);
    t = setKeyEase(t, 'x', 1, 'bounce');
    expect(t.x![1].ease).toBe('bounce');
    t = moveKey(t, 'x', 1, 0.25);
    expect(t.x!.map((k) => k.t)).toEqual([0.25, 0.5]);
    t = removeKey(removeKey(t, 'x', 0.25), 'x', 0.5);
    expect(t.x).toBeUndefined();
  });
  it('writes edits to keys only for keyed fields unless recording', () => {
    const o = obj({ keyframes: { x: [key(0, 500)] } });
    const moved = applyAnimatedChange(o, { x: 700, y: 50, name: 'n' }, 2, false);
    expect(moved.keyframes.x!.map((k) => [k.t, k.value])).toEqual([[0, 500], [2, 700]]);
    expect(moved.x).toBe(500);
    expect(moved.y).toBe(50);
    expect(moved.name).toBe('n');
    const recorded = applyAnimatedChange(o, { y: 50 }, 2, true);
    expect(recorded.keyframes.y).toEqual([{ t: 2, value: 50, ease: 'easeInOut' }]);
  });
  it('toggles a key from the posed value and keeps the value when the last key goes', () => {
    let o = obj({ keyframes: { x: [key(0, 0), key(4, 400)] } });
    o = toggleKey(o, 'x', 2);
    expect(o.keyframes.x!.find((k) => k.t === 2)!.value).toBe(200);
    o = toggleKey(toggleKey(toggleKey(o, 'x', 0), 'x', 2), 'x', 4);
    expect(o.keyframes.x).toBeUndefined();
    expect(o.x).toBe(400);
  });
  it('moves and clears all of an object\'s keys at once', () => {
    let o = obj({ keyframes: { x: [key(1, 0), key(2, 10)], y: [key(1, 5)] } });
    expect(keyTimes(o.keyframes)).toEqual([1, 2]);
    o = moveKeysAt(o, 1, 3);
    expect(keyTimes(o.keyframes)).toEqual([2, 3]);
    const cleared = clearKeys(o, 3);
    expect(cleared.keyframes).toEqual({});
    expect(cleared.x).toBe(0);
  });
  it('edits, aligns and duplicates objects at the playhead', () => {
    const scene: Scene = { ...emptyScene(), objects: [obj({ keyframes: { x: [key(0, 0), key(10, 1000)] } })] };
    const edited = updateAnimated(scene, ['o'], 5, false, (p) => ({ x: p.x + 1 }));
    expect(edited.objects[0].keyframes.x!.find((k) => k.t === 5)!.value).toBe(501);
    const aligned = align(scene, ['o'], 'left', 5);
    expect(poseAt(aligned.objects[0], 5).x).toBe(50);
    const [copy] = cloneObjects(scene.objects);
    expect(copy.keyframes.x!.map((k) => k.value)).toEqual([30, 1030]);
  });
});

describe('scene format v2', () => {
  it('migrates v1 scenes with an empty timeline and no animation', () => {
    const s = parseScene({ sceneVersion: 1, objects: [{ id: 'a', type: 'moon' }] });
    expect(s.sceneVersion).toBe(SCENE_VERSION);
    expect(s.timeline).toEqual({ duration: 10, loop: true });
    expect(s.objects[0].behaviors).toEqual([]);
    expect(s.objects[0].keyframes).toEqual({});
  });
  it('repairs damaged behaviours and keyframes', () => {
    const s = parseScene({
      sceneVersion: 2,
      timeline: { duration: -4, loop: 'yes' },
      objects: [{
        id: 'a', type: 'bird',
        behaviors: [{ type: 'fly', params: { speed: 99 } }, { nope: 1 }, { id: 'x', type: 'path', path: [{ x: 1, y: 2 }, { x: 'bad' }] }],
        keyframes: { x: [{ t: 2, value: 5 }, { t: 1, value: 1, ease: 'weird' }, { t: 'z' }], opacity: [{ t: 0, value: 9 }], colour: [] },
      }],
    });
    expect(s.timeline).toEqual({ duration: 0.5, loop: true });
    const o = s.objects[0];
    expect(o.behaviors.map((b) => b.type)).toEqual(['fly', 'path']);
    expect(o.behaviors[0].id).not.toBe('');
    expect(o.behaviors[1].path).toEqual([{ x: 1, y: 2 }]);
    expect(o.keyframes.x).toEqual([{ t: 1, value: 1, ease: 'easeInOut' }, { t: 2, value: 5, ease: 'easeInOut' }]);
    expect(o.keyframes.opacity).toEqual([{ t: 0, value: 1, ease: 'easeInOut' }]);
    expect(Object.keys(o.keyframes)).toEqual(['x', 'opacity']);
  });
  it('round-trips an animated scene through JSON', () => {
    const s = parseScene(nightForest);
    expect(parseScene(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
  it('ships the Night Forest template with working behaviours', () => {
    const s = parseScene(nightForest);
    const used = s.objects.flatMap((o) => o.behaviors.map((b) => b.type));
    expect(used.length).toBeGreaterThan(3);
    for (const type of used) expect(getBehaviorDef(type)).toBeDefined();
  });
});

describe('behaviours', () => {
  it('every behaviour produces finite motion with default settings', () => {
    for (const def of BEHAVIOR_DEFS) {
      const b = behave(def.type, {}, def.type === 'path' ? { path: [{ x: 100, y: 0 }, { x: 100, y: 100 }] } : {});
      for (const t of [0, 0.37, 5, 123.4]) {
        const m = motionOf(obj({ behaviors: [b] }), t, { pointer: { x: 900, y: 100 }, audio: 0.5 });
        for (const v of Object.values(m)) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
  it('is deterministic for the same time', () => {
    const o = obj({ behaviors: [behave('wander'), behave('fly'), behave('fade', { mode: 'Twinkle' })] });
    expect(motionOf(o, 3.21)).toEqual(motionOf(o, 3.21));
  });
  it('walks across the screen, wrapping round and facing the way it goes', () => {
    const o = obj({ x: 1900, behaviors: [behave('walk', { speed: 100, bob: 0 })] });
    const m = motionOf(o, 1);
    expect(o.x + m.dx).toBeLessThan(100); // left the right edge, came back on the left
    expect(m.scaleX).toBe(1);
    const left = motionOf(obj({ behaviors: [behave('walk', { speed: 100, direction: 'Left', bob: 0 })] }), 1);
    expect(left.dx).toBeCloseTo(-100);
    expect(left.scaleX).toBe(-1);
    // An object already flipped to face left doesn't need mirroring to walk left.
    expect(motionOf(obj({ flipX: true, behaviors: [behave('walk', { direction: 'Left' })] }), 1).scaleX).toBe(1);
  });
  it('goes back and forth over a distance and turns round', () => {
    const o = obj({ behaviors: [behave('walk', { speed: 100, mode: 'Back and forth', distance: 200, bob: 0 })] });
    expect(motionOf(o, 1).dx).toBeCloseTo(100);
    expect(motionOf(o, 3).dx).toBeCloseTo(100);
    expect(motionOf(o, 1).scaleX).toBe(1);
    expect(motionOf(o, 3).scaleX).toBe(-1);
  });
  it('jumps to the set height and lands', () => {
    const o = obj({ behaviors: [behave('jump', { height: 100, interval: 2, air: 1, squash: false })] });
    expect(motionOf(o, 0.5).dy).toBeCloseTo(-100);
    expect(motionOf(o, 1.5).dy).toBe(0);
  });
  it('swings around its top edge without the top moving', () => {
    const o = obj({ height: 200, behaviors: [behave('swing', { angle: 30, period: 4, pivot: 'Top' })] });
    const m = motionOf(o, 1.3);
    const a = (m.rotation * Math.PI) / 180;
    // Where the top-centre ends up after rotating about the shifted centre.
    const top = { x: o.x + m.dx + 100 * Math.sin(a), y: o.y + m.dy - 100 * Math.cos(a) };
    expect(top.x).toBeCloseTo(o.x, 6);
    expect(top.y).toBeCloseTo(o.y - 100, 6);
  });
  it('orbits around its placed position', () => {
    const o = obj({ behaviors: [behave('orbit', { radius: 50, period: 4 })] });
    const quarter = motionOf(o, 1);
    expect(quarter.dx).toBeCloseTo(0);
    expect(quarter.dy).toBeCloseTo(50);
  });
  it('falls through the screen and starts again at the top', () => {
    const o = obj({ y: 1000, behaviors: [behave('fall', { speed: 200, sway: 0, spin: 0 })] });
    expect(o.y + motionOf(o, 1).dy).toBeLessThan(200);
  });
  it('fades between its lowest opacity and full', () => {
    const o = obj({ behaviors: [behave('fade', { mode: 'Fade in once', min: 0, period: 2 })] });
    expect(motionOf(o, 0).alpha).toBe(0);
    expect(motionOf(o, 1).alpha).toBeCloseTo(0.5);
    expect(motionOf(o, 5).alpha).toBe(1);
  });
  it('combines several behaviours', () => {
    const o = obj({ behaviors: [behave('orbit', { radius: 50, period: 4 }), behave('pulse', { amount: 0.5, period: 4 }), behave('spin', { speed: 90 })] });
    const solo = motionOf(obj({ behaviors: [o.behaviors[0]] }), 1);
    const all = motionOf(o, 1);
    expect(all.dx).toBeCloseTo(solo.dx);
    expect(all.rotation).toBeCloseTo(90);
    expect(o.behaviors.slice(1).every((b) => b.enabled)).toBe(true);
    const disabled = motionOf({ ...o, behaviors: o.behaviors.map((b) => ({ ...b, enabled: false })) }, 1);
    expect(disabled).toEqual({ dx: 0, dy: 0, rotation: 0, scaleX: 1, scaleY: 1, alpha: 1 });
  });
});

describe('path following', () => {
  const square: Behavior = behave('path', { speed: 100, smooth: false, mode: 'Loop back to start', orient: 'Keep as placed' }, {
    path: [{ x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
  });
  it('measures the path from the object\'s own position', () => {
    const built = buildPath(square, false, true);
    expect(built.total).toBe(400);
    expect(pointAlong(built, 150)).toMatchObject({ x: 100, y: 50 });
    expect(buildPath(square, false, true)).toBe(built); // cached
  });
  it('travels at the set speed and loops', () => {
    const o = obj({ behaviors: [square] });
    expect(motionOf(o, 1.5)).toMatchObject({ dx: 100, dy: 50 });
    const lap = motionOf(o, 4.5);
    expect(lap.dx).toBeCloseTo(50);
    expect(lap.dy).toBeCloseTo(0);
  });
  it('goes back the same way, stops at the end, and turns along the path', () => {
    const back = obj({ behaviors: [{ ...square, params: { ...square.params, mode: 'Go back the same way' } }] });
    expect(motionOf(back, 4).dx).toBeCloseTo(100); // 300px path: 400px travelled = 100px back from the end
    const stop = obj({ behaviors: [{ ...square, params: { ...square.params, mode: 'Stop' } }] });
    expect(motionOf(stop, 60)).toMatchObject({ dx: 0, dy: 100 });
    const turn = obj({ behaviors: [{ ...square, params: { ...square.params, orient: 'Turn along the path' } }] });
    expect(motionOf(turn, 1.5).rotation).toBeCloseTo(90);
  });
  it('smooths through every control point', () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    const smooth = smoothPath(pts, false, 8);
    expect(smooth[0]).toEqual(pts[0]);
    expect(smooth[8]).toEqual(pts[1]);
    expect(smooth[smooth.length - 1]).toEqual(pts[2]);
  });
});

describe('interactive behaviours', () => {
  it('eases towards the pointer and back home when it leaves', () => {
    const o = obj({ behaviors: [behave('follow', { strength: 0.5, reach: 1000, smoothing: 20, face: false })] });
    const states = new Map();
    const first = evaluateBehaviors(o, env(1, { pointer: { x: 700, y: 300 } }), states);
    expect(first.dx).toBeGreaterThan(0);
    expect(first.dx).toBeLessThan(100); // smoothed, not instant
    const settled = evaluateBehaviors(o, env(2, { pointer: { x: 700, y: 300 }, dt: 5 }), states);
    expect(settled.dx).toBeCloseTo(100);
    const home = evaluateBehaviors(o, env(3, { pointer: null, dt: 5 }), states);
    expect(home.dx).toBeCloseTo(0);
    expect(evaluateBehaviors(o, env(4, { pointer: { x: 700, y: 300 }, dt: 0 }), states).dx).toBeCloseTo(0); // paused: no drift
  });
  it('avoids the pointer when it comes close', () => {
    const o = obj({ behaviors: [behave('follow', { mode: 'Avoid', reach: 200, strength: 0.6, smoothing: 20 })] });
    expect(evaluateBehaviors(o, env(1, { pointer: { x: 550, y: 300 }, dt: 5 }), new Map()).dx).toBeLessThan(-50);
    expect(evaluateBehaviors(o, env(1, { pointer: { x: 1500, y: 300 }, dt: 5 }), new Map()).dx).toBeCloseTo(0);
  });
  it('reacts to the audio level', () => {
    const o = obj({ behaviors: [behave('audio', { effect: 'Grow', amount: 1 })] });
    expect(motionOf(o, 1, { audio: 0 }).scaleX).toBe(1);
    expect(motionOf(o, 1, { audio: 1 }).scaleX).toBeCloseTo(1.35);
  });
  it('reports which live inputs a scene needs', () => {
    expect(sceneNeeds([obj({ behaviors: [behave('fly')] })])).toEqual([]);
    expect(sceneNeeds([obj({ behaviors: [behave('follow'), behave('audio')] })]).sort()).toEqual(['audio', 'pointer']);
    expect(sceneNeeds([obj({ hidden: true, behaviors: [behave('follow')] })])).toEqual([]);
  });
  it('wraps values into a range', () => {
    expect(wrap(25, 0, 10)).toBe(5);
    expect(wrap(-1, 0, 10)).toBe(9);
  });
});
