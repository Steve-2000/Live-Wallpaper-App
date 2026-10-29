import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { removeKeysAt, setKeyEase, toggleKey } from '../scene/animation';
import { getObjectDef } from '../scene/objects/registry';
import { ANIMATABLE, type AnimProp, type Behavior, type Ease, type Scene, type SceneObject } from '../scene/types';
import { CanvasView, type CanvasHandle, type Gesture, type PathTarget } from './components/CanvasView';
import { Library } from './components/Library';
import { Properties } from './components/Properties';
import { Timeline, type KeySelection } from './components/Timeline';
import type { Point } from './geometry';
import { History } from './history';
import type { EditorHost } from './host';
import {
  addBehavior, addObjects, align, byIds, cloneObjects, createObject, deleteObjects, duplicate, expandGroups, group, moveBehavior, removeBehavior,
  reorder, ungroup, updateAnimated, updateBehavior, updateObjects,
  type Alignment, type Order,
} from './operations';

type SaveState = 'saved' | 'unsaved' | 'saving' | 'error';

/** Inputs that use the keyboard themselves (text, numbers, sliders, lists); checkboxes and buttons don't. */
const NON_TYPING_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'color']);
const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  ((t instanceof HTMLInputElement && !NON_TYPING_INPUTS.has(t.type)) || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

export function App({ initial, host, initialSelection = [], initialTime }: {
  initial: Scene; host: EditorHost; initialSelection?: string[]; initialTime?: number;
}) {
  const history = useRef(new History<Scene>(initial));
  const canvasRef = useRef<CanvasHandle>(null);
  const clipboard = useRef<SceneObject[]>([]);
  const [scene, setScene] = useState(initial);
  const [selection, setSelection] = useState<string[]>(initialSelection);
  // A deep link to a moment opens paused on that frame.
  const [playing, setPlaying] = useState(initialTime === undefined);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [grid] = useState(20);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  /** Playhead (seconds). Edits of animated fields land as keyframes at this time. */
  const [time, setTime] = useState(initialTime ?? 0);
  const [record, setRecord] = useState(false);
  const [selectedKey, setSelectedKey] = useState<KeySelection | null>(null);
  const [pathDrawing, setPathDrawing] = useState<PathTarget | null>(null);
  // Callbacks read these through refs so they never act on a stale playhead.
  const timeRef = useRef(time);
  const recordRef = useRef(record);
  timeRef.current = time;
  recordRef.current = record;

  const sync = useCallback(() => {
    const present = history.current.present;
    setScene(present);
    // Drop selected ids that no longer exist (e.g. after undo).
    setSelection((sel) => sel.filter((id) => present.objects.some((o) => o.id === id)));
    setPathDrawing((p) => (p && present.objects.some((o) => o.id === p.objectId && o.behaviors.some((b) => b.id === p.behaviorId)) ? p : null));
  }, []);

  const markDirty = useCallback(() => setSaveState('unsaved'), []);

  const commit = useCallback((next: Scene, key?: string) => {
    history.current.commit(next, key);
    sync();
    markDirty();
  }, [sync, markDirty]);

  const gesture: Gesture = useMemo(() => ({
    begin: () => history.current.begin(),
    preview: (next) => { history.current.preview(next); setScene(next); },
    end: () => { history.current.end(); sync(); markDirty(); },
  }), [sync, markDirty]);

  /** Edits objects at the playhead; animated fields (or all, while recording) become keyframes. */
  const update = useCallback((ids: string[], change: (o: SceneObject) => Partial<SceneObject>, key?: string) =>
    commit(updateAnimated(history.current.present, ids, timeRef.current, recordRef.current, change), key), [commit]);

  const select = useCallback((ids: string[]) => {
    setSelection(ids);
    setSelectedKey((k) => (k && ids.includes(k.objectId) ? k : null));
    setPathDrawing((p) => (p && ids.length === 1 && ids[0] === p.objectId ? p : null));
  }, []);

  const seek = useCallback((t: number) => setTime(Math.max(0, t)), []);

  const flash = (text: string, error = false) => {
    setMessage({ text, error });
    window.setTimeout(() => setMessage((m) => (m?.text === text ? null : m)), 4000);
  };

  // ------------------------------------------------------------------ actions

  const addObject = (type: string, at?: Point) => {
    const def = getObjectDef(type);
    if (!def) return;
    const o = createObject(def, history.current.present, at);
    commit(addObjects(history.current.present, [o]));
    select([o.id]);
  };

  const editable = () => byIds(history.current.present, selection).filter((o) => !o.locked).map((o) => o.id);
  const present = () => history.current.present;

  const keys = {
    toggle: (prop: AnimProp) => {
      if (selection.length !== 1) return;
      commit(updateObjects(present(), selection, (o) => toggleKey(o, prop, timeRef.current)));
    },
    remove: () => {
      const k = selectedKey;
      if (!k) return;
      commit(updateObjects(present(), [k.objectId], (o) => (k.prop === 'all' ? removeKeysAt(o, k.t) : toggleKey(o, k.prop, k.t))));
      setSelectedKey(null);
    },
    ease: (kind: Ease) => {
      const k = selectedKey;
      if (!k) return;
      const props: readonly AnimProp[] = k.prop === 'all' ? ANIMATABLE : [k.prop];
      commit(updateObjects(present(), [k.objectId], (o) => {
        let tracks = o.keyframes;
        for (const p of props) tracks = setKeyEase(tracks, p, k.t, kind);
        return { keyframes: tracks };
      }));
    },
  };

  const behaviors = {
    add: (type: string) => {
      const ids = editable();
      if (ids.length === 0) return;
      const next = addBehavior(present(), ids, type);
      commit(next);
      // A new path has nothing to follow yet: go straight to drawing it.
      if (type === 'path' && ids.length === 1) {
        const added = byIds(next, ids)[0].behaviors.at(-1)!;
        setPlaying(false);
        setPathDrawing({ objectId: ids[0], behaviorId: added.id });
      }
    },
    change: (objectId: string, behaviorId: string, change: (b: Behavior) => Partial<Behavior>, key?: string) =>
      commit(updateBehavior(present(), objectId, behaviorId, change), key),
    remove: (objectId: string, behaviorId: string) => commit(removeBehavior(present(), objectId, behaviorId)),
    move: (objectId: string, behaviorId: string, delta: -1 | 1) => commit(moveBehavior(present(), objectId, behaviorId, delta)),
    drawPath: (objectId: string, behaviorId: string | null) => {
      if (behaviorId) setPlaying(false);
      setPathDrawing(behaviorId ? { objectId, behaviorId } : null);
    },
  };

  const actions = {
    undo: () => { history.current.undo(); sync(); markDirty(); },
    redo: () => { history.current.redo(); sync(); markDirty(); },
    delete: () => {
      if (selectedKey) return keys.remove(); // Delete acts on the selected keyframe first
      commit(deleteObjects(present(), selection));
    },
    duplicate: () => {
      const { scene: next, created } = duplicate(history.current.present, selection);
      commit(next);
      select(created);
    },
    copy: () => { clipboard.current = byIds(history.current.present, selection); },
    cut: () => { clipboard.current = byIds(history.current.present, selection); commit(deleteObjects(history.current.present, selection)); },
    paste: () => {
      if (clipboard.current.length === 0) return;
      const copies = cloneObjects(clipboard.current);
      clipboard.current = copies; // pasting again offsets further
      commit(addObjects(history.current.present, copies));
      select(copies.map((c) => c.id));
    },
    group: () => commit(group(history.current.present, selection)),
    ungroup: () => commit(ungroup(history.current.present, selection)),
    order: (o: Order) => commit(reorder(history.current.present, selection, o)),
    align: (a: Alignment) => commit(align(history.current.present, editable(), a, timeRef.current, recordRef.current)),
    flip: (axis: 'flipX' | 'flipY') => update(editable(), (o) => ({ [axis]: !o[axis] })),
    lock: () => {
      const objs = byIds(history.current.present, selection);
      const lock = objs.some((o) => !o.locked);
      update(objs.map((o) => o.id), () => ({ locked: lock }));
    },
    nudge: (dx: number, dy: number) => update(editable(), (o) => ({ x: o.x + dx, y: o.y + dy }), 'nudge'),
    selectAll: () => select(history.current.present.objects.filter((o) => !o.hidden).map((o) => o.id)),
  };

  // --------------------------------------------------------------- save/apply

  const thumbnail = () => {
    const s = history.current.present;
    return canvasRef.current?.capture(480, Math.round((480 * s.height) / s.width)) ?? '';
  };

  const save = useCallback(async (manual: boolean) => {
    window.clearTimeout(saveTimer.current);
    setSaveState('saving');
    try {
      await host.save(history.current.present, thumbnail());
      setSaveState('saved');
      if (manual) flash('Saved');
    } catch (e) {
      setSaveState('error');
      flash((e as Error).message, true);
    }
  }, [host]);

  // Autosave shortly after the last change.
  useEffect(() => {
    if (saveState !== 'unsaved') return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void save(false), 1500);
    return () => window.clearTimeout(saveTimer.current);
  }, [scene, saveState, save]);

  const applyWallpaper = async () => {
    setSaveState('saving');
    try {
      await host.apply(history.current.present, thumbnail());
      setSaveState('saved');
      flash('Set as your desktop wallpaper');
    } catch (e) {
      setSaveState('error');
      flash((e as Error).message, true);
    }
  };

  // ---------------------------------------------------------------- shortcuts

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const run = (f: () => void) => { e.preventDefault(); f(); };
      // Saving has no meaning inside a text field, so it works everywhere.
      if (ctrl && k === 's') return run(() => void save(true));
      if (isTyping(e.target)) return;
      if (ctrl && k === 'z' && !e.shiftKey) return run(actions.undo);
      if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) return run(actions.redo);
      if (ctrl && k === 'a') return run(actions.selectAll);
      if (ctrl && k === 'c') return run(actions.copy);
      if (ctrl && k === 'x') return run(actions.cut);
      if (ctrl && k === 'v') return run(actions.paste);
      if (ctrl && k === 'd') return run(actions.duplicate);
      if (ctrl && k === 'g') return run(e.shiftKey ? actions.ungroup : actions.group);
      if (ctrl && k === 'l') return run(actions.lock);
      if (ctrl && e.key === ']') return run(() => actions.order(e.shiftKey ? 'front' : 'forward'));
      if (ctrl && e.key === '[') return run(() => actions.order(e.shiftKey ? 'back' : 'backward'));
      if (e.key === 'Delete' || e.key === 'Backspace') return run(actions.delete);
      if (e.key === 'Escape') return run(() => (selectedKey ? setSelectedKey(null) : select([])));
      if (e.key === ' ') return run(() => setPlaying((p) => !p));
      if (e.key === 'Home') return run(() => { setPlaying(false); seek(0); });
      if (e.key === 'End') return run(() => { setPlaying(false); seek(history.current.present.timeline.duration); });
      const step = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowLeft') return run(() => actions.nudge(-step, 0));
      if (e.key === 'ArrowRight') return run(() => actions.nudge(step, 0));
      if (e.key === 'ArrowUp') return run(() => actions.nudge(0, -step));
      if (e.key === 'ArrowDown') return run(() => actions.nudge(0, step));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const has = selection.length > 0;
  const selectedObjs = byIds(scene, selection);
  const grouped = selectedObjs.some((o) => o.groupId);
  const statusText = { saved: host.native ? 'All changes saved' : 'Draft saved in this browser', unsaved: 'Unsaved changes', saving: 'Saving…', error: 'Not saved' }[saveState];

  return (
    <div className="editor">
      <header className="toolbar" role="toolbar" aria-label="Editor tools">
        <div className="brand">DreamCanvas Editor</div>
        <div className="tool-group">
          <button onClick={actions.undo} disabled={!history.current.canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">↶ Undo</button>
          <button onClick={actions.redo} disabled={!history.current.canRedo} aria-label="Redo" title="Redo (Ctrl+Y)">↷ Redo</button>
        </div>
        <div className="tool-group">
          <button onClick={actions.duplicate} disabled={!has} title="Duplicate (Ctrl+D)">Duplicate</button>
          <button onClick={actions.delete} disabled={!has} title="Delete (Del)">Delete</button>
          <button onClick={actions.group} disabled={selection.length < 2} title="Group (Ctrl+G)">Group</button>
          <button onClick={actions.ungroup} disabled={!grouped} title="Ungroup (Ctrl+Shift+G)">Ungroup</button>
        </div>
        <div className="tool-group">
          <button onClick={() => actions.flip('flipX')} disabled={!has} aria-label="Flip horizontally" title="Flip horizontally">Flip ↔</button>
          <button onClick={() => actions.flip('flipY')} disabled={!has} aria-label="Flip vertically" title="Flip vertically">Flip ↕</button>
        </div>
        <div className="tool-group">
          <label className="check" title="Snap moves to a 20 px grid">
            <input type="checkbox" checked={snapToGrid} onChange={(e) => setSnapToGrid(e.target.checked)} /> Snap to grid
          </label>
        </div>
        <div className="spacer" />
        <span className={`status ${saveState}`} role="status">{statusText}</span>
        <button onClick={() => void save(true)} title="Save (Ctrl+S)">Save</button>
        <button className="primary" onClick={() => void applyWallpaper()} disabled={!host.native}
          title={host.native ? 'Save and set as your desktop wallpaper' : 'Available inside the DreamCanvas app'}>
          Set as wallpaper
        </button>
      </header>

      <Library onAdd={(type) => addObject(type)} />

      <main className="stage">
        <CanvasView
          ref={canvasRef}
          scene={scene}
          selection={selection}
          playing={playing}
          time={time}
          record={record}
          grid={grid}
          snapToGrid={snapToGrid}
          gesture={gesture}
          pathDrawing={pathDrawing}
          onSelect={select}
          onDropObject={(type, at) => addObject(type, at)}
          onTime={setTime}
          onCommit={commit}
          onPathDone={() => setPathDrawing(null)}
        />
        {message && <div className={message.error ? 'toast error' : 'toast'} role="alert">{message.text}</div>}
      </main>

      <Properties
        scene={scene}
        selection={selection}
        time={time}
        drawingPath={pathDrawing?.behaviorId ?? null}
        onChange={commit}
        onUpdate={update}
        onAlign={actions.align}
        onToggleKey={keys.toggle}
        onAddBehavior={behaviors.add}
        onBehavior={behaviors.change}
        onRemoveBehavior={behaviors.remove}
        onMoveBehavior={behaviors.move}
        onDrawPath={behaviors.drawPath}
      />

      <Timeline
        scene={scene}
        selection={selection}
        time={time}
        playing={playing}
        record={record}
        selectedKey={selectedKey}
        gesture={gesture}
        onSelect={(ids, additive) => {
          const sel = selection;
          select(additive ? (sel.includes(ids[0]) ? sel.filter((s) => s !== ids[0]) : [...sel, ...ids]) : expandGroups(scene, ids));
        }}
        onUpdate={(ids, change) => commit(updateObjects(present(), ids, change))}
        onReorder={actions.order}
        onSeek={seek}
        onPlay={setPlaying}
        onRecord={setRecord}
        onTimeline={(timeline) => commit({ ...present(), timeline }, 'timeline')}
        onSelectKey={setSelectedKey}
        onKeyEase={keys.ease}
        onDeleteKey={keys.remove}
      />
    </div>
  );
}
