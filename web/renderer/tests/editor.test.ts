import { describe, expect, it } from 'vitest';
import nightForest from '../public/templates/night-forest.json?raw';
import { bounds, contains, corners, hitTest, resizeFromHandle, rotationFromPointer, snap, toLocal, toWorld } from '../src/editor/geometry';
import { History } from '../src/editor/history';
import { align, cloneObjects, createObject, deleteObjects, duplicate, expandGroups, group, reorder, ungroup } from '../src/editor/operations';
import { OBJECT_DEFS, getObjectDef } from '../src/scene/objects/registry';
import { resolveParams } from '../src/runtime/params';
import { emptyScene, parseScene, SceneError } from '../src/scene/validate';
import { SCENE_VERSION, type Scene, type SceneObject } from '../src/scene/types';

const obj = (id: string, patch: Partial<SceneObject> = {}): SceneObject => ({
  id, type: 'shape', name: id, x: 100, y: 100, width: 100, height: 50, rotation: 0,
  flipX: false, flipY: false, opacity: 1, brightness: 1, speed: 1, locked: false, hidden: false, props: {}, seed: 1, behaviors: [], keyframes: {}, ...patch,
});
const sceneWith = (...objects: SceneObject[]): Scene => ({ ...emptyScene(), objects });
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('geometry', () => {
  it('round-trips local and world coordinates for rotated objects', () => {
    const o = obj('a', { rotation: 37 });
    const p = { x: 140, y: 61 };
    const back = toWorld(o, toLocal(o, p));
    close(back.x, p.x);
    close(back.y, p.y);
  });

  it('hit-tests rotated boxes and picks the top-most object', () => {
    const rotated = obj('r', { rotation: 90 }); // 50 wide, 100 tall once rotated
    expect(contains(rotated, { x: 100, y: 145 })).toBe(true);
    expect(contains(rotated, { x: 145, y: 100 })).toBe(false);
    const scene = sceneWith(obj('below'), obj('above'));
    expect(hitTest(scene.objects, { x: 100, y: 100 })?.id).toBe('above');
  });

  it('ignores hidden and locked objects when hit-testing', () => {
    const scene = sceneWith(obj('base'), obj('hidden', { hidden: true }), obj('locked', { locked: true }));
    expect(hitTest(scene.objects, { x: 100, y: 100 })?.id).toBe('base');
  });

  it('resizes from the east handle keeping the west edge fixed', () => {
    const r = resizeFromHandle(obj('a'), 'e', { x: 250, y: 100 }, false);
    expect(r.width).toBe(200);
    expect(r.height).toBe(50);
    close(r.x - r.width / 2, 50); // west edge unchanged
  });

  it('resizes a rotated object along its own axis', () => {
    const o = obj('a', { rotation: 90 }); // local +x points down the screen
    const r = resizeFromHandle(o, 'e', { x: 100, y: 250 }, false);
    expect(r.width).toBeCloseTo(200);
    // The local west edge (screen top, y = 50) stays fixed.
    const topCorner = corners({ ...o, ...r })[0];
    close(topCorner.y, 50);
  });

  it('keeps the aspect ratio from a corner when asked', () => {
    const r = resizeFromHandle(obj('a'), 'se', { x: 250, y: 130 }, true);
    expect(r.width / r.height).toBeCloseTo(2);
  });

  it('never shrinks below the minimum size', () => {
    const r = resizeFromHandle(obj('a'), 'w', { x: 1000, y: 100 }, false);
    expect(r.width).toBeGreaterThanOrEqual(4);
  });

  it('computes rotation from the handle with optional 15 degree snapping', () => {
    const o = obj('a');
    close(rotationFromPointer(o, { x: 200, y: 100 }, false), 90);
    expect(rotationFromPointer(o, { x: 200, y: 92 }, true)).toBe(90);
    close(rotationFromPointer(o, { x: 100, y: 0 }, false), 0);
  });

  it('computes bounds of rotated objects and snaps to a grid', () => {
    const b = bounds([obj('a', { rotation: 90 })])!;
    close(b.width, 50);
    close(b.height, 100);
    expect(snap(37, 20)).toBe(40);
    expect(snap(37, 0)).toBe(37);
  });
});

describe('moon phases', () => {
  it('outlines only the lit part (left of the shadow circle) inside the disc', async () => {
    const { litRegion } = await import('../src/scene/objects/sky');
    const R = 100;
    for (const d of [55, 100, 155]) {
      const pts = litRegion(R, d, 32);
      for (let i = 0; i < pts.length; i += 2) {
        const [x, y] = [pts[i], pts[i + 1]];
        expect(Math.hypot(x, y)).toBeLessThanOrEqual(R + 1e-6); // within the disc
        expect(Math.hypot(x - d, y)).toBeGreaterThanOrEqual(R - 1e-6); // outside the shadow
      }
      // The left-most point of the moon is lit.
      expect(Math.min(...pts.filter((_, i) => i % 2 === 0))).toBeCloseTo(-R, 0);
    }
  });
});

describe('scene operations', () => {
  it('creates objects from every registered type with valid defaults', () => {
    const scene = emptyScene();
    for (const def of OBJECT_DEFS) {
      const o = createObject(def, scene);
      expect(o.type).toBe(def.type);
      expect(resolveParams(def.props, o.props)).toEqual(o.props);
      expect(o.width).toBeGreaterThan(0);
    }
  });

  it('expands a selection to whole groups and ungroups', () => {
    let scene = sceneWith(obj('a'), obj('b'), obj('c'));
    scene = group(scene, ['a', 'b']);
    expect(expandGroups(scene, ['a'])).toEqual(['a', 'b']);
    scene = ungroup(scene, ['a', 'b']);
    expect(expandGroups(scene, ['a'])).toEqual(['a']);
  });

  it('duplicates with new ids, an offset and a separate group', () => {
    const scene = group(sceneWith(obj('a'), obj('b')), ['a', 'b']);
    const { scene: next, created } = duplicate(scene, ['a', 'b']);
    expect(next.objects).toHaveLength(4);
    const copies = next.objects.filter((o) => created.includes(o.id));
    expect(copies.map((c) => c.x)).toEqual([130, 130]);
    expect(new Set(copies.map((c) => c.groupId)).size).toBe(1);
    expect(copies[0].groupId).not.toBe(scene.objects[0].groupId);
  });

  it('pastes copies of locked objects unlocked', () => {
    expect(cloneObjects([obj('a', { locked: true })])[0].locked).toBe(false);
  });

  it('does not delete locked objects', () => {
    const scene = deleteObjects(sceneWith(obj('a'), obj('b', { locked: true })), ['a', 'b']);
    expect(scene.objects.map((o) => o.id)).toEqual(['b']);
  });

  it('reorders layers', () => {
    const scene = sceneWith(obj('a'), obj('b'), obj('c'), obj('d'));
    const ids = (s: Scene) => s.objects.map((o) => o.id).join('');
    expect(ids(reorder(scene, ['b'], 'front'))).toBe('acdb');
    expect(ids(reorder(scene, ['c'], 'back'))).toBe('cabd');
    expect(ids(reorder(scene, ['b'], 'forward'))).toBe('acbd');
    expect(ids(reorder(scene, ['c'], 'backward'))).toBe('acbd');
    expect(ids(reorder(scene, ['a', 'b'], 'forward'))).toBe('cabd');
    expect(ids(reorder(scene, ['d'], 'forward'))).toBe('abcd');
  });

  it('aligns several objects to each other and one object to the canvas', () => {
    const scene = sceneWith(obj('a', { x: 100 }), obj('b', { x: 300 }));
    const left = align(scene, ['a', 'b'], 'left');
    expect(left.objects.map((o) => o.x)).toEqual([100, 100]);
    const centered = align(scene, ['a'], 'center');
    expect(centered.objects[0].x).toBe(scene.width / 2);
  });
});

describe('history', () => {
  it('undoes and redoes commits', () => {
    const h = new History(1);
    h.commit(2);
    h.commit(3);
    expect(h.undo()).toBe(2);
    expect(h.undo()).toBe(1);
    expect(h.canUndo).toBe(false);
    expect(h.redo()).toBe(2);
    h.commit(5);
    expect(h.canRedo).toBe(false);
  });

  it('merges rapid commits with the same key (slider drags)', () => {
    let t = 0;
    const h = new History(0, 200, 800, () => t);
    for (let i = 1; i <= 10; i++) {
      t += 50;
      h.commit(i, 'opacity');
    }
    expect(h.undo()).toBe(0);
  });

  it('turns a gesture into a single step', () => {
    const h = new History('a');
    h.begin();
    h.preview('b');
    h.preview('c');
    h.end();
    expect(h.present).toBe('c');
    expect(h.undo()).toBe('a');
  });

  it('records nothing for a gesture that changed nothing', () => {
    const h = new History('a');
    h.begin();
    h.end();
    expect(h.canUndo).toBe(false);
  });
});

describe('scene files', () => {
  it('loads the bundled Night Forest template with every object type known', () => {
    const scene = parseScene(nightForest);
    expect(scene.objects.length).toBeGreaterThanOrEqual(15);
    for (const o of scene.objects) expect(getObjectDef(o.type), o.type).toBeDefined();
    // The spec's example: moon, 3 clouds, 2 birds, 5 trees, a cat, leaves, fireflies, river, clock.
    const count = (t: string) => scene.objects.filter((o) => o.type === t).length;
    expect([count('moon'), count('cloud'), count('bird'), count('tree'), count('cat'), count('river'), count('clock')]).toEqual([1, 3, 2, 5, 1, 1, 1]);
  });

  it('repairs damaged input instead of failing', () => {
    const scene = parseScene({
      name: 'x',
      width: 99999,
      background: { kind: 'gradient', from: 'red', to: '#00FF00', angle: 900 },
      objects: [{ id: 'a', type: 'moon', opacity: 7 }, { id: 'a', type: 'cloud' }, { nope: true }, 'junk'],
    });
    expect(scene.width).toBe(8192);
    expect(scene.background).toEqual({ kind: 'gradient', from: '#0b1026', to: '#00ff00', angle: 360 });
    expect(scene.objects).toHaveLength(2);
    expect(scene.objects[0].opacity).toBe(1);
    expect(scene.objects[0].id).not.toBe(scene.objects[1].id);
  });

  it('refuses scenes from a newer format and malformed JSON', () => {
    expect(() => parseScene({ sceneVersion: SCENE_VERSION + 1 })).toThrow(SceneError);
    expect(() => parseScene('{ nope')).toThrow(SceneError);
  });

  it('round-trips through JSON unchanged', () => {
    const scene = sceneWith(obj('a', { groupId: 'g', props: { kind: 'star' } }));
    expect(parseScene(JSON.stringify(scene))).toEqual(scene);
  });
});
