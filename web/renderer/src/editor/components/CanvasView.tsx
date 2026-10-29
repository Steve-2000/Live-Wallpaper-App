import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { flushSync } from 'react-dom';
import { poseAt } from '../../scene/animation';
import { behaviorParams, buildPath } from '../../scene/behaviors';
import { createSceneRuntime, type SceneRuntime, type SceneView } from '../../scene/runtime';
import type { PathPoint, Scene, SceneObject } from '../../scene/types';
import { corners, HANDLES, hitTest, resizeFromHandle, rotationFromPointer, snap, toWorld, type Handle, type Point } from '../geometry';
import { byIds, expandGroups, updateAnimated, updateBehavior } from '../operations';
import { DRAG_TYPE } from './Library';

export interface CanvasHandle {
  /** PNG data URL of the design area (for project thumbnails). */
  capture(width: number, height: number): string | null;
}

export interface Gesture {
  begin(): void;
  preview(scene: Scene): void;
  end(): void;
}

/** The path behaviour currently being drawn by clicking on the canvas. */
export interface PathTarget {
  objectId: string;
  behaviorId: string;
}

interface Props {
  scene: Scene;
  selection: string[];
  playing: boolean;
  /** Playhead, seconds. Objects are shown and edited at their pose for this time. */
  time: number;
  /** Edits of animatable fields become keyframes even without existing keys. */
  record: boolean;
  grid: number;
  snapToGrid: boolean;
  gesture: Gesture;
  pathDrawing: PathTarget | null;
  onSelect(ids: string[]): void;
  onDropObject(type: string, at: Point): void;
  /** Called every frame while playing with the runtime's timeline position. */
  onTime(t: number): void;
  onCommit(scene: Scene): void;
  onPathDone(): void;
}

type Drag =
  | { kind: 'move'; origin: Point; base: Scene; starts: Map<string, Point>; primary: string }
  | { kind: 'resize'; handle: Handle; base: Scene; start: SceneObject }
  | { kind: 'rotate'; base: Scene; start: SceneObject }
  | { kind: 'path-point'; base: Scene; target: PathTarget; index: number; centre: Point };

const CURSORS: Record<Handle, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
const round1 = (v: number) => Math.round(v * 10) / 10;

export const CanvasView = forwardRef<CanvasHandle, Props>(function CanvasView(props, ref) {
  const { scene, selection, playing, time, record, grid, snapToGrid, gesture, pathDrawing, onSelect, onDropObject, onTime, onCommit, onPathDone } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const runtimeRef = useRef<SceneRuntime | null>(null);
  const sceneRef = useRef(scene);
  const playingRef = useRef(playing);
  const onTimeRef = useRef(onTime);
  const reportedTime = useRef(time);
  const dragRef = useRef<Drag | null>(null);
  const [view, setView] = useState<SceneView | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  sceneRef.current = scene;
  playingRef.current = playing;
  onTimeRef.current = onTime;

  useImperativeHandle(ref, () => ({
    capture(width, height) {
      const rt = runtimeRef.current;
      if (!rt) return null;
      rt.update(0); // render and read back in the same task
      return rt.captureDesign(width, height);
    },
  }));

  // Create the runtime once; keep it in sync with the container size.
  useEffect(() => {
    const host = hostRef.current!;
    let disposed = false;
    let frame = 0;
    let last = performance.now();
    const observer = new ResizeObserver(() => {
      const rt = runtimeRef.current;
      if (!rt) return;
      rt.resize(host.clientWidth, host.clientHeight, Math.min(2, devicePixelRatio || 1));
      // The canvas redraws synchronously; update the overlay in the same frame so handles never lag behind it.
      flushSync(() => setView({ ...rt.view }));
    });
    createSceneRuntime(host, sceneRef.current, {
      width: Math.max(1, host.clientWidth),
      height: Math.max(1, host.clientHeight),
      dpr: Math.min(2, devicePixelRatio || 1),
      fit: 'contain',
      padding: 36,
    })
      .then((rt) => {
        if (disposed) return rt.dispose();
        runtimeRef.current = rt;
        rt.setScene(sceneRef.current);
        rt.seek(reportedTime.current);
        setView({ ...rt.view });
        observer.observe(host);
        const tick = (now: number) => {
          const dt = Math.min(0.1, (now - last) / 1000);
          last = now;
          if (playingRef.current) {
            rt.update(dt);
            reportedTime.current = rt.time;
            onTimeRef.current(rt.time);
          } else {
            rt.update(0);
          }
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      runtimeRef.current?.dispose();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const rt = runtimeRef.current;
    if (!rt) return;
    rt.setScene(scene);
    setView({ ...rt.view });
  }, [scene]);

  // Scrubbing: jump to the playhead when it was moved from outside (not by our own playback).
  useEffect(() => {
    if (playing || Math.abs(time - reportedTime.current) < 1e-6) return;
    reportedTime.current = time;
    runtimeRef.current?.seek(time);
  }, [time, playing]);

  // Finish path drawing with Enter or Escape.
  useEffect(() => {
    if (!pathDrawing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onPathDone();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pathDrawing, onPathDone]);

  // Everything on the overlay uses each object's pose at the playhead.
  const posed = useMemo(() => scene.objects.map((o) => poseAt(o, time)), [scene, time]);

  const toDesign = (clientX: number, clientY: number): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    const v = runtimeRef.current?.view ?? { scale: 1, offsetX: 0, offsetY: 0 };
    return { x: (clientX - r.left - v.offsetX) / v.scale, y: (clientY - r.top - v.offsetY) / v.scale };
  };
  const toScreen = (p: Point) => (view ? { x: p.x * view.scale + view.offsetX, y: p.y * view.scale + view.offsetY } : p);

  const selected = posed.filter((o) => selection.includes(o.id));
  const single = selected.length === 1 && !selected[0].locked ? selected[0] : null;

  /** Path behaviours of the selected object, with their drawn points in design space. */
  const owner = selected.length === 1 ? selected[0] : null;
  const paths = owner?.behaviors
    .filter((b) => b.type === 'path')
    .map((b) => {
      const p = behaviorParams(b);
      const closed = p.mode === 'Loop back to start';
      const line = buildPath(b, Boolean(p.smooth), closed).pts.map((q) => toScreen({ x: owner.x + q.x, y: owner.y + q.y }));
      return { b, line, active: pathDrawing?.behaviorId === b.id };
    }) ?? [];

  const setPath = (base: Scene, target: PathTarget, points: PathPoint[]) =>
    updateBehavior(base, target.objectId, target.behaviorId, () => ({ path: points }));

  function onPointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    if (e.button !== 0 || !view) return;
    const p = toDesign(e.clientX, e.clientY);
    const target = e.target as SVGElement;

    // Path control points: drag to move, Alt+click to delete.
    const pointIndex = target.dataset.point;
    const pointOwner = target.dataset.behavior;
    if (pointIndex !== undefined && pointOwner && owner) {
      const t: PathTarget = { objectId: owner.id, behaviorId: pointOwner };
      const index = Number(pointIndex);
      const behavior = owner.behaviors.find((b) => b.id === pointOwner);
      if (e.altKey && behavior?.path) {
        onCommit(setPath(scene, t, behavior.path.filter((_, i) => i !== index)));
        return;
      }
      svgRef.current!.setPointerCapture(e.pointerId);
      gesture.begin();
      dragRef.current = { kind: 'path-point', base: scene, target: t, index, centre: { x: owner.x, y: owner.y } };
      return;
    }

    // Drawing a path: every click adds a point (relative to the object's position).
    if (pathDrawing) {
      const drawn = posed.find((o) => o.id === pathDrawing.objectId);
      const behavior = drawn?.behaviors.find((b) => b.id === pathDrawing.behaviorId);
      if (!drawn || !behavior) return onPathDone();
      if (e.detail >= 2) return onPathDone(); // double-click finishes
      const q = snapToGrid ? { x: snap(p.x, grid), y: snap(p.y, grid) } : p;
      onCommit(setPath(scene, pathDrawing, [...(behavior.path ?? []), { x: round1(q.x - drawn.x), y: round1(q.y - drawn.y) }]));
      return;
    }

    const handle = target.dataset.handle as Handle | 'rotate' | undefined;
    svgRef.current!.setPointerCapture(e.pointerId);

    if (single && handle) {
      gesture.begin();
      dragRef.current = handle === 'rotate'
        ? { kind: 'rotate', base: scene, start: single }
        : { kind: 'resize', handle, base: scene, start: single };
      return;
    }

    const hit = hitTest(posed, p, 4 / view.scale);
    if (!hit) {
      if (!e.shiftKey) onSelect([]);
      return;
    }
    // Alt picks a single member of a group; otherwise the whole group is selected.
    const ids = e.altKey ? [hit.id] : expandGroups(scene, [hit.id]);
    let next: string[];
    if (e.shiftKey || e.ctrlKey) {
      next = selection.includes(hit.id) ? selection.filter((id) => !ids.includes(id)) : [...selection, ...ids];
    } else {
      next = selection.includes(hit.id) ? selection : ids;
    }
    onSelect(next);
    const movable = posed.filter((o) => next.includes(o.id) && !o.locked);
    if (movable.length === 0 || !next.includes(hit.id)) return;
    gesture.begin();
    dragRef.current = {
      kind: 'move',
      origin: p,
      base: scene,
      starts: new Map(movable.map((o) => [o.id, { x: o.x, y: o.y }])),
      primary: hit.id,
    };
  }

  function onPointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    const p = toDesign(e.clientX, e.clientY);
    runtimeRef.current?.setPointer(p); // lets mouse-follow behaviours be tried out in the editor
    const drag = dragRef.current;
    if (!drag) {
      if (!pathDrawing) setHover(hitTest(posed, p)?.id ?? null);
      return;
    }
    if (drag.kind === 'path-point') {
      const behavior = byIds(drag.base, [drag.target.objectId])[0]?.behaviors.find((b) => b.id === drag.target.behaviorId);
      if (!behavior?.path) return;
      const q = snapToGrid ? { x: snap(p.x, grid), y: snap(p.y, grid) } : p;
      const pts = behavior.path.map((pt, i) => (i === drag.index ? { x: round1(q.x - drag.centre.x), y: round1(q.y - drag.centre.y) } : pt));
      gesture.preview(setPath(drag.base, drag.target, pts));
    } else if (drag.kind === 'move') {
      let dx = p.x - drag.origin.x;
      let dy = p.y - drag.origin.y;
      const start = drag.starts.get(drag.primary);
      if (snapToGrid && start) {
        dx = snap(start.x + dx, grid) - start.x;
        dy = snap(start.y + dy, grid) - start.y;
      }
      gesture.preview(updateAnimated(drag.base, drag.starts.keys(), time, record, (o) => {
        const s = drag.starts.get(o.id)!;
        return { x: round1(s.x + dx), y: round1(s.y + dy) };
      }));
    } else if (drag.kind === 'resize') {
      const r = resizeFromHandle(drag.start, drag.handle, p, e.shiftKey);
      gesture.preview(updateAnimated(drag.base, [drag.start.id], time, record, () => ({
        x: round1(r.x), y: round1(r.y), width: Math.round(r.width), height: Math.round(r.height),
      })));
    } else {
      const rotation = round1(rotationFromPointer(drag.start, p, e.shiftKey));
      gesture.preview(updateAnimated(drag.base, [drag.start.id], time, record, () => ({ rotation })));
    }
  }

  function onPointerUp(e: ReactPointerEvent<SVGSVGElement>) {
    if (svgRef.current?.hasPointerCapture(e.pointerId)) svgRef.current.releasePointerCapture(e.pointerId);
    if (dragRef.current) {
      dragRef.current = null;
      gesture.end();
    }
  }

  const outline = (o: SceneObject) => corners(o).map((c) => { const s = toScreen(c); return `${s.x},${s.y}`; }).join(' ');
  const hovered = hover && !selection.includes(hover) ? posed.find((o) => o.id === hover) : undefined;

  return (
    <div
      className={pathDrawing ? 'canvas-host drawing' : 'canvas-host'}
      ref={hostRef}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DRAG_TYPE)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={(e) => {
        const type = e.dataTransfer.getData(DRAG_TYPE);
        if (!type) return;
        e.preventDefault();
        onDropObject(type, toDesign(e.clientX, e.clientY));
      }}
    >
      {error && <div className="canvas-error">Canvas error: {error}</div>}
      <svg
        ref={svgRef}
        className="overlay"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => { setHover(null); runtimeRef.current?.setPointer(null); }}
      >
        {view && (
          <rect className="design-frame" x={view.offsetX} y={view.offsetY} width={scene.width * view.scale} height={scene.height * view.scale} />
        )}
        {hovered && <polygon className="hover-outline" points={outline(hovered)} />}
        {selected.map((o) => <polygon key={o.id} className={o.locked ? 'sel-outline locked' : 'sel-outline'} points={outline(o)} />)}
        {owner && paths.map(({ b, line, active }) => (
          <g key={b.id} className={active ? 'path active' : 'path'}>
            <polyline className="path-line" points={line.map((q) => `${q.x},${q.y}`).join(' ')} />
            {(b.path ?? []).map((pt, i) => {
              const s = toScreen({ x: owner.x + pt.x, y: owner.y + pt.y });
              return <circle key={i} className="path-point" data-point={i} data-behavior={b.id} cx={s.x} cy={s.y} r={5}><title>Drag to move · Alt+click to delete</title></circle>;
            })}
          </g>
        ))}
        {single && view && !pathDrawing && (() => {
          const top = toScreen(toWorld(single, { x: 0, y: -single.height / 2 }));
          const knob = toScreen(toWorld(single, { x: 0, y: -single.height / 2 - 28 / view.scale }));
          return (
            <g>
              <line className="rotate-stem" x1={top.x} y1={top.y} x2={knob.x} y2={knob.y} />
              <circle className="rotate-handle" data-handle="rotate" cx={knob.x} cy={knob.y} r={6} />
              {(Object.keys(HANDLES) as Handle[]).map((h) => {
                const [hx, hy] = HANDLES[h];
                const s = toScreen(toWorld(single, { x: (hx * single.width) / 2, y: (hy * single.height) / 2 }));
                return <rect key={h} className="handle" data-handle={h} x={s.x - 5} y={s.y - 5} width={10} height={10} style={{ cursor: CURSORS[h] }} />;
              })}
            </g>
          );
        })()}
      </svg>
      {pathDrawing && (
        <div className="path-banner" role="status">
          Click on the canvas to add points to the path · Enter, Esc or double-click to finish
          <button onClick={onPathDone}>Done</button>
        </div>
      )}
      {view && (
        <div className="canvas-info">
          {scene.width} × {scene.height}{selected.length > 0 ? ` · ${selected.length} selected` : ''}
        </div>
      )}
    </div>
  );
});
