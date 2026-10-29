import { useEffect, useState, type ReactNode } from 'react';
import { resolveParams } from '../../runtime/params';
import type { ParamValue, PresetManifest } from '../../runtime/types';
import { keyAt, poseAt } from '../../scene/animation';
import { BEHAVIOR_DEFS, behaviorParams, getBehaviorDef } from '../../scene/behaviors';
import { getObjectDef } from '../../scene/objects/registry';
import type { AnimProp, Behavior, Scene, SceneBackground, SceneObject } from '../../scene/types';
import { byIds, type Alignment } from '../operations';
import { ParamField } from './ParamField';
import { PROP_LABELS } from './Timeline';

interface Props {
  scene: Scene;
  selection: string[];
  /** Playhead; fields show (and edit) each object's pose at this time. */
  time: number;
  /** Behaviour whose path is being drawn on the canvas. */
  drawingPath: string | null;
  /** Applies a change; `key` merges rapid edits of the same field into one undo step. */
  onChange(next: Scene, key?: string): void;
  onUpdate(ids: string[], change: (o: SceneObject) => Partial<SceneObject>, key?: string): void;
  onAlign(how: Alignment): void;
  onToggleKey(prop: AnimProp): void;
  onAddBehavior(type: string): void;
  onBehavior(objectId: string, behaviorId: string, change: (b: Behavior) => Partial<Behavior>, key?: string): void;
  onRemoveBehavior(objectId: string, behaviorId: string): void;
  onMoveBehavior(objectId: string, behaviorId: string, delta: -1 | 1): void;
  onDrawPath(objectId: string, behaviorId: string | null): void;
}

/** ◆ next to an animatable field: filled = key at the playhead, outlined = animated elsewhere. */
function KeyToggle({ o, prop, time, onToggle }: { o: SceneObject; prop: AnimProp; time: number; onToggle(p: AnimProp): void }) {
  const keys = o.keyframes[prop];
  const state = keyAt(keys, time) ? 'on' : keys?.length ? 'track' : '';
  const label = state === 'on' ? `Remove ${PROP_LABELS[prop]} keyframe` : `Add ${PROP_LABELS[prop]} keyframe at the playhead`;
  return <button className={`kf ${state}`} onClick={() => onToggle(prop)} title={label} aria-label={label} aria-pressed={state === 'on'}>◆</button>;
}

function Keyed({ children, toggle }: { children: ReactNode; toggle: ReactNode }) {
  return <div className="keyed">{children}{toggle}</div>;
}

function BehaviorCard({ o, b, index, count, drawing, props }: {
  o: SceneObject; b: Behavior; index: number; count: number; drawing: boolean; props: Props;
}) {
  const [open, setOpen] = useState(true);
  const def = getBehaviorDef(b.type);
  const values = behaviorParams(b);
  return (
    <div className={b.enabled ? 'behavior' : 'behavior off'}>
      <div className="behavior-head">
        <button className="icon-btn expand" aria-expanded={open} aria-label={open ? 'Collapse' : 'Expand'} onClick={() => setOpen(!open)}>{open ? '▾' : '▸'}</button>
        <span className="layer-icon" aria-hidden>{def?.icon ?? '?'}</span>
        <span className="behavior-name" title={def?.description}>{def?.label ?? b.type}</span>
        <input type="checkbox" checked={b.enabled} title={b.enabled ? 'On' : 'Off'} aria-label={`${def?.label ?? b.type} on`}
          onChange={(e) => props.onBehavior(o.id, b.id, () => ({ enabled: e.target.checked }))} />
        <button className="icon-btn" disabled={index === 0} title="Apply earlier" aria-label="Move up" onClick={() => props.onMoveBehavior(o.id, b.id, -1)}>↑</button>
        <button className="icon-btn" disabled={index === count - 1} title="Apply later" aria-label="Move down" onClick={() => props.onMoveBehavior(o.id, b.id, 1)}>↓</button>
        <button className="icon-btn" title="Remove" aria-label={`Remove ${def?.label ?? b.type}`} onClick={() => props.onRemoveBehavior(o.id, b.id)}>✕</button>
      </div>
      {open && def && (
        <div className="behavior-body">
          <p className="hint">{def.description}</p>
          {def.params.map((spec) => (
            <ParamField key={spec.key} spec={spec} value={values[spec.key]}
              onChange={(v: ParamValue) => props.onBehavior(o.id, b.id, (x) => ({ params: { ...x.params, [spec.key]: v } }), `${b.id}:${spec.key}`)} />
          ))}
          {b.type === 'path' && (
            <>
              <p className="hint">{b.path?.length ? `${b.path.length} point${b.path.length === 1 ? '' : 's'} · drag them on the canvas, Alt+click deletes one` : 'No path yet.'}</p>
              <div className="toggle-row">
                <button className={drawing ? 'active' : ''} aria-pressed={drawing} onClick={() => props.onDrawPath(o.id, drawing ? null : b.id)}>
                  {drawing ? 'Finish drawing' : b.path?.length ? 'Add points' : 'Draw path'}
                </button>
                <button disabled={!b.path?.length} onClick={() => props.onBehavior(o.id, b.id, () => ({ path: [] }))}>Clear path</button>
              </div>
            </>
          )}
          {def.needs === 'pointer' && <p className="hint">On the desktop this follows your mouse; in the editor, move the mouse over the canvas.</p>}
          {def.needs === 'audio' && <p className="hint">Listens to what your PC is playing while it's the wallpaper. Nothing is recorded or sent anywhere.</p>}
        </div>
      )}
      {!def && <p className="hint">This movement isn't known to this version of DreamCanvas. It is kept unchanged.</p>}
    </div>
  );
}

function AddBehavior({ onAdd }: { onAdd(type: string): void }) {
  return (
    <select className="add-behavior" value="" aria-label="Add a movement" onChange={(e) => { if (e.target.value) onAdd(e.target.value); }}>
      <option value="">+ Add movement…</option>
      {BEHAVIOR_DEFS.map((d) => <option key={d.type} value={d.type}>{d.icon}  {d.label}</option>)}
    </select>
  );
}

const SIZES: Array<[string, number, number]> = [
  ['Full HD 1920 × 1080', 1920, 1080],
  ['QHD 2560 × 1440', 2560, 1440],
  ['4K 3840 × 2160', 3840, 2160],
  ['Ultrawide 3440 × 1440', 3440, 1440],
  ['Portrait 1080 × 1920', 1080, 1920],
];

function Num({ label, value, onChange, step = 1 }: { label: string; value: number; step?: number; onChange(v: number): void }) {
  return (
    <label className="num">
      <span>{label}</span>
      <input type="number" step={step} value={Math.round(value * 10) / 10}
        onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(v); }} />
    </label>
  );
}

function Slider({ label, value, min, max, step, onChange, format }: {
  label: string; value: number; min: number; max: number; step: number; onChange(v: number): void; format?: (v: number) => string;
}) {
  return (
    <label className="field">
      <span className="field-row"><span>{label}</span><span className="field-value">{format ? format(value) : value.toFixed(2)}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

const ALIGN: Array<[Alignment, string]> = [['left', '⇤'], ['center', '↔'], ['right', '⇥'], ['top', '⤒'], ['middle', '↕'], ['bottom', '⤓']];

function AlignBar({ onAlign, multi }: { onAlign(a: Alignment): void; multi: boolean }) {
  return (
    <div className="align-bar" role="group" aria-label={multi ? 'Align to each other' : 'Align to canvas'}>
      {ALIGN.map(([a, icon]) => (
        <button key={a} title={`Align ${a}${multi ? '' : ' (to canvas)'}`} aria-label={`Align ${a}`} onClick={() => onAlign(a)}>{icon}</button>
      ))}
    </div>
  );
}

function usePresets(): PresetManifest[] {
  const [presets, setPresets] = useState<PresetManifest[]>([]);
  useEffect(() => {
    fetch('./presets.json')
      .then((r) => r.json())
      .then((d: { presets: PresetManifest[] }) => setPresets(d.presets))
      .catch(() => setPresets([]));
  }, []);
  return presets;
}

function SceneProps({ scene, onChange }: Pick<Props, 'scene' | 'onChange'>) {
  const presets = usePresets();
  const bg = scene.background;
  const setBg = (b: SceneBackground, key?: string) => onChange({ ...scene, background: b }, key);
  const preset = bg.kind === 'preset' ? presets.find((p) => p.id === bg.presetId) : undefined;
  return (
    <>
      <div className="panel-title">Scene</div>
      <label className="field">
        <span>Name</span>
        <input type="text" maxLength={120} value={scene.name} onChange={(e) => onChange({ ...scene, name: e.target.value }, 'scene-name')} />
      </label>
      <label className="field">
        <span>Canvas size</span>
        <select value={`${scene.width}x${scene.height}`}
          onChange={(e) => { const [w, h] = e.target.value.split('x').map(Number); onChange({ ...scene, width: w, height: h }); }}>
          {SIZES.map(([label, w, h]) => <option key={label} value={`${w}x${h}`}>{label}</option>)}
          {!SIZES.some(([, w, h]) => w === scene.width && h === scene.height) && <option value={`${scene.width}x${scene.height}`}>{scene.width} × {scene.height}</option>}
        </select>
      </label>

      <div className="panel-title">Background</div>
      <div className="segmented" role="radiogroup" aria-label="Background type">
        {(['color', 'gradient', 'preset'] as const).map((k) => (
          <button key={k} role="radio" aria-checked={bg.kind === k} className={bg.kind === k ? 'active' : ''}
            onClick={() => {
              if (bg.kind === k) return;
              if (k === 'color') setBg({ kind: 'color', color: bg.kind === 'gradient' ? bg.from : '#0b1026' });
              else if (k === 'gradient') setBg({ kind: 'gradient', from: '#0b1026', to: '#1d2b53', angle: 180 });
              else setBg({ kind: 'preset', presetId: presets[0]?.id ?? 'aurora', params: {}, seed: 1337 });
            }}>
            {k === 'color' ? 'Colour' : k === 'gradient' ? 'Gradient' : 'Animated'}
          </button>
        ))}
      </div>
      {bg.kind === 'color' && (
        <ParamField spec={{ key: 'bg', label: 'Colour', type: 'color', default: '#0b1026' }} value={bg.color} onChange={(v) => setBg({ ...bg, color: String(v) }, 'bg-color')} />
      )}
      {bg.kind === 'gradient' && (
        <>
          <ParamField spec={{ key: 'from', label: 'From', type: 'color', default: '#0b1026' }} value={bg.from} onChange={(v) => setBg({ ...bg, from: String(v) }, 'bg-from')} />
          <ParamField spec={{ key: 'to', label: 'To', type: 'color', default: '#1d2b53' }} value={bg.to} onChange={(v) => setBg({ ...bg, to: String(v) }, 'bg-to')} />
          <Slider label="Angle" value={bg.angle} min={0} max={360} step={1} format={(v) => `${v}°`} onChange={(v) => setBg({ ...bg, angle: v }, 'bg-angle')} />
        </>
      )}
      {bg.kind === 'preset' && (
        <>
          <label className="field">
            <span>Animated background</span>
            <select value={bg.presetId} onChange={(e) => setBg({ kind: 'preset', presetId: e.target.value, params: {}, seed: bg.seed })}>
              {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          {preset && preset.params.map((spec) => (
            <ParamField key={spec.key} spec={spec} value={resolveParams(preset.params, bg.params)[spec.key]}
              onChange={(v) => setBg({ ...bg, params: { ...bg.params, [spec.key]: v } }, `bg-${spec.key}`)} />
          ))}
          <button className="wide" onClick={() => setBg({ ...bg, seed: Math.floor(Math.random() * 2 ** 31) })}>Regenerate background</button>
        </>
      )}
      <p className="hint">Select an object on the canvas to edit it. Add objects from the library on the left.</p>
    </>
  );
}

export function Properties(allProps: Props) {
  const { scene, selection, time, onChange, onUpdate, onAlign, onToggleKey } = allProps;
  const raw = byIds(scene, selection);
  if (raw.length === 0) {
    return <aside className="panel properties" aria-label="Properties"><SceneProps scene={scene} onChange={onChange} /></aside>;
  }

  // Show values as they are at the playhead.
  const selected = raw.map((o) => poseAt(o, time));
  const ids = selected.map((o) => o.id);
  const first = selected[0];
  const set = (field: string, change: (o: SceneObject) => Partial<SceneObject>) => onUpdate(ids, change, `${ids.join(',')}:${field}`);
  const single = selected.length === 1 ? raw[0] : null;
  const toggle = (prop: AnimProp) => (single ? <KeyToggle o={single} prop={prop} time={time} onToggle={onToggleKey} /> : null);

  const common = (
    <>
      <Keyed toggle={toggle('opacity')}>
        <Slider label="Opacity" value={first.opacity} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set('opacity', () => ({ opacity: v }))} />
      </Keyed>
      <Keyed toggle={toggle('brightness')}>
        <Slider label="Brightness" value={first.brightness} min={0} max={2} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set('brightness', () => ({ brightness: v }))} />
      </Keyed>
      <Slider label="Animation speed" value={first.speed} min={0} max={4} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => set('speed', () => ({ speed: v }))} />
    </>
  );

  if (selected.length > 1) {
    return (
      <aside className="panel properties" aria-label="Properties">
        <div className="panel-title">{selected.length} objects</div>
        <AlignBar multi onAlign={onAlign} />
        {common}
        <div className="panel-title">Movement</div>
        <AddBehavior onAdd={allProps.onAddBehavior} />
        <p className="hint">Adds the movement to every selected object. Select one object to adjust it.</p>
        <p className="hint">Ctrl+G groups them so they move together. Alt+click selects one object inside a group.</p>
      </aside>
    );
  }

  const o = first;
  const def = getObjectDef(o.type);
  const props = def ? resolveParams(def.props, o.props) : o.props;
  return (
    <aside className="panel properties" aria-label="Properties">
      <div className="panel-title">{def?.label ?? o.type}{o.groupId ? ' · grouped' : ''}</div>
      <label className="field">
        <span>Name</span>
        <input type="text" maxLength={80} value={o.name} onChange={(e) => set('name', () => ({ name: e.target.value }))} />
      </label>
      <div className="num-grid">
        <Keyed toggle={toggle('x')}><Num label="X" value={o.x} onChange={(v) => set('x', () => ({ x: v }))} /></Keyed>
        <Keyed toggle={toggle('y')}><Num label="Y" value={o.y} onChange={(v) => set('y', () => ({ y: v }))} /></Keyed>
        <Keyed toggle={toggle('width')}><Num label="W" value={o.width} onChange={(v) => set('w', () => ({ width: Math.max(4, v) }))} /></Keyed>
        <Keyed toggle={toggle('height')}><Num label="H" value={o.height} onChange={(v) => set('h', () => ({ height: Math.max(4, v) }))} /></Keyed>
        <Keyed toggle={toggle('rotation')}><Num label="Rotate" value={o.rotation} onChange={(v) => set('rotation', () => ({ rotation: v }))} /></Keyed>
      </div>
      <p className="hint">◆ adds a keyframe at the playhead; keyed values then animate along the timeline below.</p>
      <div className="toggle-row">
        <button className={o.flipX ? 'active' : ''} aria-pressed={o.flipX} onClick={() => set('flipX', () => ({ flipX: !o.flipX }))}>Flip ↔</button>
        <button className={o.flipY ? 'active' : ''} aria-pressed={o.flipY} onClick={() => set('flipY', () => ({ flipY: !o.flipY }))}>Flip ↕</button>
        <button className={o.locked ? 'active' : ''} aria-pressed={o.locked} onClick={() => set('locked', () => ({ locked: !o.locked }))}>{o.locked ? 'Locked' : 'Lock'}</button>
        <button className={o.hidden ? 'active' : ''} aria-pressed={o.hidden} onClick={() => set('hidden', () => ({ hidden: !o.hidden }))}>{o.hidden ? 'Hidden' : 'Hide'}</button>
      </div>
      <AlignBar multi={false} onAlign={onAlign} />
      {common}

      <div className="panel-title">Movement</div>
      {o.behaviors.map((b, i) => (
        <BehaviorCard key={b.id} o={o} b={b} index={i} count={o.behaviors.length} drawing={allProps.drawingPath === b.id} props={allProps} />
      ))}
      <AddBehavior onAdd={allProps.onAddBehavior} />

      {def && def.props.length > 0 && <div className="panel-title">{def.label} settings</div>}
      {def?.props.map((spec) => (
        <ParamField key={spec.key} spec={spec} value={props[spec.key]}
          onChange={(v: ParamValue) => set(`prop-${spec.key}`, (x) => ({ props: { ...x.props, [spec.key]: v } }))} />
      ))}
      {def && <button className="wide" onClick={() => onUpdate(ids, () => ({ seed: Math.floor(Math.random() * 2 ** 31) }))}>Regenerate shape</button>}
      {!def && <p className="hint">This object type isn't known to this version of DreamCanvas. It is kept unchanged.</p>}
    </aside>
  );
}
