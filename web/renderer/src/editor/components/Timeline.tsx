import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { keyAt, keyTimes, moveKey, moveKeysAt } from '../../scene/animation';
import { getObjectDef } from '../../scene/objects/registry';
import { ANIMATABLE, EASES, type AnimProp, type Ease, type Scene, type SceneObject, type Timeline as TimelineSettings } from '../../scene/types';
import { updateObjects, type Order } from '../operations';
import type { Gesture } from './CanvasView';

/** A selected keyframe: one property's key, or (prop = 'all') every key of the object at that time. */
export interface KeySelection {
  objectId: string;
  prop: AnimProp | 'all';
  t: number;
}

export const PROP_LABELS: Record<AnimProp, string> = {
  x: 'X position', y: 'Y position', width: 'Width', height: 'Height', rotation: 'Rotation', opacity: 'Opacity', brightness: 'Brightness',
};

export const EASE_LABELS: Record<Ease, string> = {
  linear: 'Linear', easeIn: 'Ease in', easeOut: 'Ease out', easeInOut: 'Ease in & out', step: 'Jump (hold)', back: 'Overshoot', elastic: 'Elastic', bounce: 'Bounce',
};

interface Props {
  scene: Scene;
  selection: string[];
  time: number;
  playing: boolean;
  record: boolean;
  selectedKey: KeySelection | null;
  gesture: Gesture;
  onSelect(ids: string[], additive: boolean): void;
  onUpdate(ids: string[], change: (o: SceneObject) => Partial<SceneObject>): void;
  onReorder(order: Order): void;
  onSeek(t: number): void;
  onPlay(playing: boolean): void;
  onRecord(record: boolean): void;
  onTimeline(settings: TimelineSettings): void;
  onSelectKey(key: KeySelection | null): void;
  onKeyEase(ease: Ease): void;
  onDeleteKey(): void;
}

export function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

/** Ruler spacing that gives at most ~20 labelled ticks. */
function tickStep(duration: number): number {
  return [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60].find((s) => duration / s <= 20) ?? 120;
}

const SNAP = 0.05;
const pct = (t: number, d: number) => `${(Math.min(d, Math.max(0, t)) / d) * 100}%`;

/** Bottom panel: layer list with a keyframe lane per layer, ruler, playhead and transport. */
export function Timeline(props: Props) {
  const { scene, selection, time, playing, record, selectedKey, gesture } = props;
  const duration = scene.timeline.duration;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const rulerRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);

  // Bring the selected object's row into view (e.g. after clicking it on the canvas).
  const firstSelected = selection[0];
  useEffect(() => {
    if (!firstSelected) return;
    rowsRef.current?.querySelector(`[data-object="${CSS.escape(firstSelected)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [firstSelected]);
  const keyDrag = useRef<{ base: Scene; key: KeySelection; to: number } | null>(null);
  const top = [...scene.objects].reverse();
  const hasSel = selection.length > 0;
  const step = tickStep(duration);

  /** Timeline seconds under a client x coordinate (all lanes share the ruler's horizontal extent). */
  const timeAt = (clientX: number, snapToPlayhead = false) => {
    const r = rulerRef.current!.getBoundingClientRect();
    let t = Math.min(duration, Math.max(0, ((clientX - r.left) / r.width) * duration));
    if (snapToPlayhead && Math.abs(t - time) * (r.width / duration) < 6) return time;
    t = Math.round(t / SNAP) * SNAP;
    return Math.round(t * 1000) / 1000;
  };

  const scrub = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    props.onPlay(false);
    props.onSeek(timeAt(e.clientX));
  };
  const scrubMove = (e: ReactPointerEvent<HTMLElement>) => {
    if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) props.onSeek(timeAt(e.clientX));
  };

  const keyDown = (e: ReactPointerEvent<HTMLButtonElement>, key: KeySelection) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    props.onPlay(false);
    props.onSelectKey(key);
    if (!selection.includes(key.objectId)) props.onSelect([key.objectId], false);
    gesture.begin();
    keyDrag.current = { base: scene, key, to: key.t };
  };
  const keyMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = keyDrag.current;
    if (!drag || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const to = timeAt(e.clientX, true);
    if (to === drag.to) return;
    drag.to = to;
    const { objectId, prop, t } = drag.key;
    gesture.preview(updateObjects(drag.base, [objectId], (o) =>
      prop === 'all' ? moveKeysAt(o, t, to) : { keyframes: moveKey(o.keyframes, prop, t, to) }));
  };
  const keyUp = () => {
    const drag = keyDrag.current;
    if (!drag) return;
    keyDrag.current = null;
    gesture.end();
    props.onSelectKey({ ...drag.key, t: drag.to });
    props.onSeek(drag.to);
  };

  const isSelectedKey = (objectId: string, prop: AnimProp | 'all', t: number) =>
    selectedKey !== null && selectedKey.objectId === objectId && selectedKey.prop === prop && Math.abs(selectedKey.t - t) < 1e-6;

  // Keyed by position, not time: a key being dragged must stay the same element or it loses the pointer.
  const diamond = (o: SceneObject, prop: AnimProp | 'all', t: number, index: number, ease?: Ease) => (
    <button
      key={`${prop}-${index}`}
      className={isSelectedKey(o.id, prop, t) ? 'key selected' : 'key'}
      style={{ left: pct(t, duration) }}
      title={`${prop === 'all' ? 'Keys' : PROP_LABELS[prop]} at ${formatTime(t)}${ease ? ` · ${EASE_LABELS[ease]}` : ''} — drag to move, Delete to remove`}
      aria-label={`Keyframe at ${formatTime(t)}`}
      onPointerDown={(e) => keyDown(e, { objectId: o.id, prop, t })}
      onPointerMove={keyMove}
      onPointerUp={keyUp}
      onPointerCancel={keyUp}
      onLostPointerCapture={keyUp}
    />
  );

  const selectedEase = (() => {
    if (!selectedKey) return undefined;
    const o = scene.objects.find((x) => x.id === selectedKey.objectId);
    if (!o) return undefined;
    const props = selectedKey.prop === 'all' ? ANIMATABLE : [selectedKey.prop];
    return props.map((p) => keyAt(o.keyframes[p], selectedKey.t)?.ease).find(Boolean);
  })();

  return (
    <section className="panel timeline" aria-label="Timeline and layers">
      <div className="tl-head">
        <div className="tl-transport">
          <button onClick={() => { props.onPlay(false); props.onSeek(0); }} title="Go to start (Home)" aria-label="Go to start">⏮</button>
          <button className="play" onClick={() => props.onPlay(!playing)} title="Play / pause (Space)" aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</button>
          <span className="tl-time" aria-live="off">{formatTime(time)}</span>
          <label className="tl-duration" title="Length of the timeline">
            / <input type="number" min={0.5} max={600} step={0.5} value={duration}
              onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0.5) props.onTimeline({ ...scene.timeline, duration: Math.min(600, v) }); }} /> s
          </label>
          <label className="check" title="Start again at the end (otherwise the last frame holds)">
            <input type="checkbox" checked={scene.timeline.loop} onChange={(e) => props.onTimeline({ ...scene.timeline, loop: e.target.checked })} /> Loop
          </label>
          <button className={record ? 'record on' : 'record'} aria-pressed={record} onClick={() => props.onRecord(!record)}
            title="Record: every move, resize, rotation or opacity change becomes a keyframe at the playhead">
            ● Record
          </button>
        </div>
        {selectedKey && selectedEase && (
          <div className="tl-key-tools" role="group" aria-label="Selected keyframe">
            <span className="muted">Key {formatTime(selectedKey.t)}</span>
            <select value={selectedEase} onChange={(e) => props.onKeyEase(e.target.value as Ease)} aria-label="Easing into this key" title="How the value approaches this key">
              {EASES.map((ease) => <option key={ease} value={ease}>{EASE_LABELS[ease]}</option>)}
            </select>
            <button onClick={props.onDeleteKey} title="Delete keyframe (Del)">Delete key</button>
          </div>
        )}
        <div className="spacer" />
        <div className="layers-actions">
          <button disabled={!hasSel} onClick={() => props.onReorder('front')} title="Bring to front (Ctrl+Shift+])">To front</button>
          <button disabled={!hasSel} onClick={() => props.onReorder('forward')} title="Bring forward (Ctrl+])">Forward</button>
          <button disabled={!hasSel} onClick={() => props.onReorder('backward')} title="Send backward (Ctrl+[)">Backward</button>
          <button disabled={!hasSel} onClick={() => props.onReorder('back')} title="Send to back (Ctrl+Shift+[)">To back</button>
        </div>
      </div>

      <div className="tl-grid">
        <div className="tl-corner">Layers ({scene.objects.length})</div>
        <div className="tl-ruler" ref={rulerRef} onPointerDown={scrub} onPointerMove={scrubMove} title="Click or drag to move the playhead">
          {Array.from({ length: Math.floor(duration / step + 1e-9) + 1 }, (_, i) => i * step).map((t) => (
            <span key={t} className="tick" style={{ left: pct(t, duration) }}>{t % 1 === 0 ? `${t}s` : t.toFixed(2).replace(/0$/, '')}</span>
          ))}
          <span className="playhead-cap" style={{ left: pct(time, duration) }} />
        </div>

        <div className="tl-rows" ref={rowsRef} role="listbox" aria-multiselectable aria-label="Layers">
          <div className="tl-playhead-track" aria-hidden>
            <span className="playhead" style={{ left: pct(time, duration) }} />
          </div>
          {top.map((o) => {
            const animated = ANIMATABLE.filter((p) => (o.keyframes[p]?.length ?? 0) > 0);
            const open = expanded.has(o.id) && animated.length > 0;
            const sel = selection.includes(o.id);
            return (
              <div key={o.id} className="tl-object" data-object={o.id}>
                <div className={sel ? 'tl-row selected' : 'tl-row'} role="option" aria-selected={sel}>
                  <div className="tl-label" onClick={(e) => props.onSelect([o.id], e.ctrlKey || e.shiftKey)}>
                    <button className="icon-btn expand" disabled={animated.length === 0} aria-expanded={open}
                      aria-label={open ? 'Hide keyframe tracks' : 'Show keyframe tracks'} title={animated.length ? 'Show each animated property' : 'No keyframes'}
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpanded((s) => { const n = new Set(s); if (n.has(o.id)) n.delete(o.id); else n.add(o.id); return n; });
                      }}>
                      {animated.length === 0 ? '' : open ? '▾' : '▸'}
                    </button>
                    <span className="layer-icon" aria-hidden>{getObjectDef(o.type)?.icon ?? '?'}</span>
                    <span className={o.hidden ? 'layer-name dim' : 'layer-name'}>{o.name}</span>
                    {o.behaviors.some((b) => b.enabled) && <span className="badge" title={o.behaviors.map((b) => b.type).join(', ')}>⟳{o.behaviors.length}</span>}
                    {o.groupId && <span className="badge" title="Grouped">G</span>}
                    <button className={o.hidden ? 'icon-btn on' : 'icon-btn'} title={o.hidden ? 'Show' : 'Hide'} aria-label={`${o.hidden ? 'Show' : 'Hide'} ${o.name}`}
                      onClick={(e) => { e.stopPropagation(); props.onUpdate([o.id], () => ({ hidden: !o.hidden })); }}>
                      {o.hidden ? '◌' : '●'}
                    </button>
                    <button className={o.locked ? 'icon-btn on' : 'icon-btn'} title={o.locked ? 'Unlock' : 'Lock'} aria-label={`${o.locked ? 'Unlock' : 'Lock'} ${o.name}`}
                      onClick={(e) => { e.stopPropagation(); props.onUpdate([o.id], () => ({ locked: !o.locked })); }}>
                      {o.locked ? '🔒' : '🔓'}
                    </button>
                  </div>
                  <div className="tl-lane" onPointerDown={(e) => { props.onSelect([o.id], false); scrub(e); }} onPointerMove={scrubMove}>
                    {keyTimes(o.keyframes).map((t, i) => diamond(o, 'all', t, i))}
                  </div>
                </div>
                {open && animated.map((p) => (
                  <div key={p} className="tl-row sub">
                    <div className="tl-label sub">{PROP_LABELS[p]}</div>
                    <div className="tl-lane" onPointerDown={scrub} onPointerMove={scrubMove}>
                      {o.keyframes[p]!.map((k, i) => diamond(o, p, k.t, i, k.ease))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
          {top.length === 0 && <div className="tl-empty">No objects yet. Pick something from the library.</div>}
        </div>
      </div>
    </section>
  );
}
