import { resolveParams } from '../runtime/params';
import { applyAnimatedChange, poseAt } from '../scene/animation';
import type { ObjectDef } from '../scene/objects/types';
import { newId } from '../scene/validate';
import type { Behavior, Scene, SceneObject } from '../scene/types';
import { bounds, type Point } from './geometry';

// Pure scene operations used by the editor. Each returns a new Scene; inputs are never mutated.

export function byIds(scene: Scene, ids: Iterable<string>): SceneObject[] {
  const set = new Set(ids);
  return scene.objects.filter((o) => set.has(o.id));
}

/** Clicking any member of a group selects the whole group. */
export function expandGroups(scene: Scene, ids: string[]): string[] {
  const groups = new Set(byIds(scene, ids).map((o) => o.groupId).filter(Boolean));
  if (groups.size === 0) return ids;
  const out = new Set(ids);
  for (const o of scene.objects) if (o.groupId && groups.has(o.groupId)) out.add(o.id);
  return scene.objects.filter((o) => out.has(o.id)).map((o) => o.id);
}

export function createObject(def: ObjectDef, scene: Scene, at?: Point, seed = Math.floor(Math.random() * 2 ** 31)): SceneObject {
  // Default sizes are authored for 1920x1080; keep their proportion on other canvas sizes.
  const k = scene.width / 1920;
  const count = scene.objects.filter((o) => o.type === def.type).length;
  return {
    id: newId(),
    type: def.type,
    name: count === 0 ? def.label : `${def.label} ${count + 1}`,
    x: at?.x ?? scene.width / 2,
    y: at?.y ?? scene.height / 2,
    width: Math.round(def.defaultSize[0] * k),
    height: Math.round(def.defaultSize[1] * k),
    rotation: 0,
    flipX: false,
    flipY: false,
    opacity: 1,
    brightness: 1,
    speed: 1,
    locked: false,
    hidden: false,
    props: resolveParams(def.props),
    seed,
    behaviors: [],
    keyframes: {},
  };
}

export function addObjects(scene: Scene, objects: SceneObject[]): Scene {
  return { ...scene, objects: [...scene.objects, ...objects] };
}

export function updateObjects(scene: Scene, ids: Iterable<string>, change: (o: SceneObject) => Partial<SceneObject>): Scene {
  const set = new Set(ids);
  return { ...scene, objects: scene.objects.map((o) => (set.has(o.id) ? { ...o, ...change(o) } : o)) };
}

export function deleteObjects(scene: Scene, ids: Iterable<string>): Scene {
  const set = new Set(ids);
  return { ...scene, objects: scene.objects.filter((o) => !set.has(o.id) || o.locked) };
}

/**
 * Copies objects with fresh ids, offset so the copies are visible. Copied groups become new
 * groups (they don't join the originals).
 */
export function cloneObjects(objects: SceneObject[], offset = 30): SceneObject[] {
  const groupMap = new Map<string, string>();
  return objects.map((o) => {
    let groupId = o.groupId;
    if (groupId) {
      if (!groupMap.has(groupId)) groupMap.set(groupId, newId());
      groupId = groupMap.get(groupId);
    }
    // Keyed positions move with the copy too, so it doesn't snap back onto the original.
    const keyframes = { ...o.keyframes };
    if (keyframes.x) keyframes.x = keyframes.x.map((k) => ({ ...k, value: k.value + offset }));
    if (keyframes.y) keyframes.y = keyframes.y.map((k) => ({ ...k, value: k.value + offset }));
    return { ...o, props: { ...o.props }, id: newId(), x: o.x + offset, y: o.y + offset, locked: false, groupId, keyframes };
  });
}

/**
 * Edits objects while the playhead is at `t`: keyed fields become keys (see applyAnimatedChange).
 * `change` receives the object at its pose for t.
 */
export function updateAnimated(scene: Scene, ids: Iterable<string>, t: number, record: boolean, change: (posed: SceneObject) => Partial<SceneObject>): Scene {
  const set = new Set(ids);
  return { ...scene, objects: scene.objects.map((o) => (set.has(o.id) ? applyAnimatedChange(o, change(poseAt(o, t)), t, record) : o)) };
}

export function addBehavior(scene: Scene, ids: Iterable<string>, type: string): Scene {
  return updateObjects(scene, ids, (o) => ({ behaviors: [...o.behaviors, { id: newId(), type, enabled: true, params: {} }] }));
}

export function updateBehavior(scene: Scene, objectId: string, behaviorId: string, change: (b: Behavior) => Partial<Behavior>): Scene {
  return updateObjects(scene, [objectId], (o) => ({ behaviors: o.behaviors.map((b) => (b.id === behaviorId ? { ...b, ...change(b) } : b)) }));
}

export function removeBehavior(scene: Scene, objectId: string, behaviorId: string): Scene {
  return updateObjects(scene, [objectId], (o) => ({ behaviors: o.behaviors.filter((b) => b.id !== behaviorId) }));
}

export function moveBehavior(scene: Scene, objectId: string, behaviorId: string, delta: -1 | 1): Scene {
  return updateObjects(scene, [objectId], (o) => {
    const list = [...o.behaviors];
    const i = list.findIndex((b) => b.id === behaviorId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return {};
    [list[i], list[j]] = [list[j], list[i]];
    return { behaviors: list };
  });
}

export function duplicate(scene: Scene, ids: string[]): { scene: Scene; created: string[] } {
  const copies = cloneObjects(byIds(scene, ids));
  return { scene: addObjects(scene, copies), created: copies.map((c) => c.id) };
}

export function group(scene: Scene, ids: string[]): Scene {
  if (ids.length < 2) return scene;
  const groupId = newId();
  return updateObjects(scene, ids, () => ({ groupId }));
}

export function ungroup(scene: Scene, ids: string[]): Scene {
  return updateObjects(scene, ids, () => ({ groupId: undefined }));
}

export type Order = 'front' | 'forward' | 'backward' | 'back';

/** Changes drawing order; the relative order of the moved objects is preserved. */
export function reorder(scene: Scene, ids: string[], order: Order): Scene {
  const set = new Set(ids);
  const list = [...scene.objects];
  if (order === 'front' || order === 'back') {
    const moving = list.filter((o) => set.has(o.id));
    const rest = list.filter((o) => !set.has(o.id));
    return { ...scene, objects: order === 'front' ? [...rest, ...moving] : [...moving, ...rest] };
  }
  if (order === 'forward') {
    for (let i = list.length - 2; i >= 0; i--) {
      if (set.has(list[i].id) && !set.has(list[i + 1].id)) [list[i], list[i + 1]] = [list[i + 1], list[i]];
    }
  } else {
    for (let i = 1; i < list.length; i++) {
      if (set.has(list[i].id) && !set.has(list[i - 1].id)) [list[i], list[i - 1]] = [list[i - 1], list[i]];
    }
  }
  return { ...scene, objects: list };
}

export type Alignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/**
 * Aligns objects to each other (2+ selected) or to the canvas (1 selected),
 * using each object's rotated bounds.
 */
export function align(scene: Scene, ids: string[], how: Alignment, t = 0, record = false): Scene {
  const selected = byIds(scene, ids).map((o) => poseAt(o, t));
  if (selected.length === 0) return scene;
  const target = selected.length > 1 ? bounds(selected)! : { x: 0, y: 0, width: scene.width, height: scene.height };
  return updateAnimated(scene, ids, t, record, (o) => {
    const b = bounds([o])!;
    switch (how) {
      case 'left': return { x: o.x + (target.x - b.x) };
      case 'right': return { x: o.x + (target.x + target.width - (b.x + b.width)) };
      case 'center': return { x: o.x + (target.x + target.width / 2 - (b.x + b.width / 2)) };
      case 'top': return { y: o.y + (target.y - b.y) };
      case 'bottom': return { y: o.y + (target.y + target.height - (b.y + b.height)) };
      case 'middle': return { y: o.y + (target.y + target.height / 2 - (b.y + b.height / 2)) };
    }
  });
}
