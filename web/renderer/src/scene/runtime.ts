import { Application, ColorMatrixFilter, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { createRandom, resolveParams } from '../runtime/params';
import { loadPreset } from '../runtime/registry';
import type { PresetInstance } from '../runtime/types';
import { hasKeyframes, poseAt, timelineTime } from './animation';
import { evaluateBehaviors, identityMotion, sceneNeeds, type BehaviorNeed, type Motion } from './behaviors';
import { getObjectDef } from './objects/registry';
import { createTextures, type LiveData, type ObjectTextures, type ObjectView, type SystemInfo } from './objects/types';
import type { Scene, SceneBackground, SceneObject } from './types';

/** Mapping from design pixels to CSS pixels: screen = design * scale + offset. */
export interface SceneView {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface SceneRuntimeOptions {
  width: number;
  height: number;
  dpr: number;
  /** cover = fill the screen (wallpaper); contain = show the whole design area (editor). */
  fit: 'cover' | 'contain';
  /** Extra margin in contain mode, CSS px. */
  padding?: number;
}

export interface SceneRuntime {
  readonly view: SceneView;
  /** Position on the keyframe timeline, seconds. */
  readonly time: number;
  setScene(scene: Scene): void;
  /** Advances every object's animation by dt seconds and renders. dt = 0 just re-renders. */
  update(dt: number): void;
  /** Jumps the scene clock (keyframes and behaviours) to t seconds and renders. */
  seek(t: number): void;
  /** Mouse position in design pixels (null = no pointer). */
  setPointer(p: { x: number; y: number } | null): void;
  /** Mouse position as a fraction of the viewport (0..1), as reported by the native host. */
  setPointerViewport(u: number, v: number): void;
  /** System audio level, 0..1. */
  setAudioLevel(level: number): void;
  /** CPU / memory / battery for system widgets. */
  setSystemInfo(info: SystemInfo): void;
  /** Live inputs the current scene uses ('pointer', 'audio', 'system'). */
  needs(): Array<BehaviorNeed | 'system'>;
  resize(width: number, height: number, dpr: number): void;
  /** The design area as an image (for thumbnails); call right after update(). */
  captureDesign(width: number, height: number): string;
  /** Exactly what is on screen (for still exports). */
  captureViewport(): string;
  dispose(): void;
}

interface Entry {
  type: string;
  seed: number;
  holder: Container;
  view: ObjectView | null;
  buildKey: string;
  /** Size the view was last built at; keyframed sizes scale relative to it. */
  builtWidth: number;
  builtHeight: number;
  time: number;
  obj: SceneObject;
  /** Has keyframes or enabled behaviours, so it must be re-posed every frame. */
  animated: boolean;
  filter: ColorMatrixFilter | null;
  filterOn: boolean;
  brightness: number;
  states: Map<string, Record<string, number>>;
}

function gradientTexture(from: string, to: string, angle: number): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  // CSS-style angle: 0deg = bottom-to-top, 90deg = left-to-right, 180deg = top-to-bottom.
  const rad = ((angle - 90) * Math.PI) / 180;
  const dx = Math.cos(rad) * 128;
  const dy = Math.sin(rad) * 128;
  const grad = g.createLinearGradient(128 - dx, 128 - dy, 128 + dx, 128 + dy);
  grad.addColorStop(0, from);
  grad.addColorStop(1, to);
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return Texture.from(c);
}

export async function createSceneRuntime(host: HTMLElement, initial: Scene, options: SceneRuntimeOptions): Promise<SceneRuntime> {
  let { width, height, dpr } = options;
  const padding = options.padding ?? 0;
  // Layers are absolutely positioned inside the host; only make it a containing block if it
  // isn't one already (overriding a fixed/absolute host would collapse it to zero height).
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.style.overflow = 'hidden';

  // Background presets render into their own canvas underneath the (transparent) Pixi canvas.
  const presetLayer = document.createElement('div');
  presetLayer.style.position = 'absolute';
  host.appendChild(presetLayer);

  const app = new Application();
  await app.init({
    width,
    height,
    resolution: dpr,
    autoDensity: true,
    antialias: true,
    autoStart: false,
    sharedTicker: false,
    backgroundAlpha: 0,
    preference: 'webgl',
    powerPreference: 'low-power',
  });
  app.canvas.style.position = 'absolute';
  app.canvas.style.left = app.canvas.style.top = '0';
  host.appendChild(app.canvas);

  const textures: ObjectTextures = createTextures();
  const live: LiveData = { system: null };
  const world = new Container();
  const mask = new Graphics();
  const bgSprite = new Sprite(Texture.WHITE);
  const objectsLayer = new Container();
  world.addChild(bgSprite, objectsLayer);
  world.mask = mask;
  app.stage.addChild(world, mask);

  let scene = initial;
  const view: SceneView = { scale: 1, offsetX: 0, offsetY: 0 };
  const entries = new Map<string, Entry>();
  let bgKey = '';
  let bgTexture: Texture | null = null;
  let preset: PresetInstance | null = null;
  let presetToken = 0;
  let clock = 0;

  function layout(): void {
    const availW = Math.max(1, width - padding * 2);
    const availH = Math.max(1, height - padding * 2);
    const s = options.fit === 'cover'
      ? Math.max(width / scene.width, height / scene.height)
      : Math.min(availW / scene.width, availH / scene.height);
    view.scale = s;
    view.offsetX = (width - scene.width * s) / 2;
    view.offsetY = (height - scene.height * s) / 2;
    world.scale.set(s);
    world.position.set(view.offsetX, view.offsetY);
    mask.clear().rect(view.offsetX, view.offsetY, scene.width * s, scene.height * s).fill({ color: 0xffffff });
    bgSprite.width = scene.width;
    bgSprite.height = scene.height;
    Object.assign(presetLayer.style, {
      left: `${view.offsetX}px`,
      top: `${view.offsetY}px`,
      width: `${scene.width * s}px`,
      height: `${scene.height * s}px`,
    });
    preset?.resize(scene.width * s, scene.height * s, dpr);
  }

  function applyBackground(bg: SceneBackground): void {
    const key = JSON.stringify(bg);
    if (key === bgKey) return;
    const previous = bgKey ? (JSON.parse(bgKey) as SceneBackground) : null;
    bgKey = key;

    if (bg.kind === 'preset') {
      bgSprite.visible = false;
      const sameModule = previous?.kind === 'preset' && previous.presetId === bg.presetId && previous.seed === bg.seed && preset;
      if (sameModule) {
        void loadPreset(bg.presetId).then(({ manifest }) => preset?.setParams(resolveParams(manifest.params, bg.params)));
        return;
      }
      preset?.dispose();
      preset = null;
      presetLayer.replaceChildren();
      const token = ++presetToken;
      void loadPreset(bg.presetId)
        .then(async ({ manifest, module }) => {
          const instance = await module.create({
            host: presetLayer,
            width: scene.width * view.scale,
            height: scene.height * view.scale,
            dpr,
            params: resolveParams(manifest.params, bg.params),
            random: createRandom(bg.seed),
            seed: bg.seed,
          });
          if (token !== presetToken) instance.dispose();
          else preset = instance;
        })
        .catch((e) => console.error('Background preset failed', e));
      return;
    }

    presetToken++;
    preset?.dispose();
    preset = null;
    presetLayer.replaceChildren();
    bgSprite.visible = true;
    bgTexture?.destroy(true);
    bgTexture = bg.kind === 'gradient' ? gradientTexture(bg.from, bg.to, bg.angle) : null;
    bgSprite.texture = bgTexture ?? Texture.WHITE;
    bgSprite.tint = bg.kind === 'color' ? parseInt(bg.color.slice(1), 16) : 0xffffff;
    bgSprite.width = scene.width;
    bgSprite.height = scene.height;
  }

  function placeholder(obj: SceneObject): ObjectView {
    // Unknown type (e.g. a scene from a newer version): keep it visible and editable.
    const root = new Container();
    const g = new Graphics();
    root.addChild(g);
    return {
      root,
      build(w, h) {
        g.clear().rect(-w / 2, -h / 2, w, h).fill({ color: 0xff00ff, alpha: 0.15 }).stroke({ width: 2, color: 0xff00ff });
      },
      update() {},
      dispose() {
        console.warn(`Unknown object type "${obj.type}"`);
      },
    };
  }

  function syncObject(obj: SceneObject): Entry {
    let e = entries.get(obj.id);
    if (e && (e.type !== obj.type || e.seed !== obj.seed)) {
      e.view?.dispose?.();
      e.holder.destroy({ children: true });
      entries.delete(obj.id);
      e = undefined;
    }
    if (!e) {
      const def = getObjectDef(obj.type);
      const holder = new Container();
      const objView = def ? def.create({ random: createRandom(obj.seed), textures, live }) : placeholder(obj);
      holder.addChild(objView.root);
      e = {
        type: obj.type, seed: obj.seed, holder, view: objView, buildKey: '', builtWidth: obj.width, builtHeight: obj.height,
        time: 0, obj, animated: false, filter: null, filterOn: false, brightness: 1, states: new Map(),
      };
      entries.set(obj.id, e);
    }
    e.obj = obj;
    e.animated = hasKeyframes(obj) || obj.behaviors.some((b) => b.enabled);

    // Build at the static size; keyframed sizes are drawn by scaling (rebuilding every frame would be slow).
    const def = getObjectDef(obj.type);
    const props = def ? resolveParams(def.props, obj.props) : obj.props;
    const key = `${obj.width}|${obj.height}|${JSON.stringify(props)}`;
    if (key !== e.buildKey) {
      e.view?.build(obj.width, obj.height, props);
      e.buildKey = key;
      e.builtWidth = obj.width;
      e.builtHeight = obj.height;
    }
    // Forget smoothing state of behaviours that were removed.
    for (const id of e.states.keys()) if (!obj.behaviors.some((b) => b.id === id)) e.states.delete(id);
    return e;
  }

  const motion: Motion = identityMotion();
  let pointer: { x: number; y: number } | null = null;
  let audioLevel = 0;

  /** Places an object for the current clock: keyframed pose, then behaviours on top. */
  function pose(e: Entry, dt: number): void {
    const h = e.holder;
    const o = e.obj;
    h.visible = !o.hidden;
    if (o.hidden) return;
    const p = poseAt(o, timelineTime(clock, scene.timeline));
    Object.assign(motion, identityMotion());
    if (o.behaviors.length > 0) {
      evaluateBehaviors(p, { time: clock, dt, scene, pointer, audio: audioLevel }, e.states, motion);
    }
    h.position.set(p.x + motion.dx, p.y + motion.dy);
    h.rotation = ((p.rotation + motion.rotation) * Math.PI) / 180;
    h.scale.set(
      (o.flipX ? -1 : 1) * motion.scaleX * (p.width / e.builtWidth),
      (o.flipY ? -1 : 1) * motion.scaleY * (p.height / e.builtHeight),
    );
    h.alpha = Math.min(1, Math.max(0, p.opacity * motion.alpha));
    // The filter costs an extra render pass, so it's only attached while brightness differs from 1.
    if (Math.abs(p.brightness - 1) > 0.001) {
      e.filter ??= new ColorMatrixFilter();
      if (p.brightness !== e.brightness) {
        e.filter.brightness(p.brightness, false);
        e.brightness = p.brightness;
      }
      if (!e.filterOn) {
        h.filters = [e.filter];
        e.filterOn = true;
      }
    } else if (e.filterOn) {
      h.filters = [];
      e.filterOn = false;
      e.brightness = 1;
    }
  }

  function setScene(next: Scene): void {
    const sizeChanged = next.width !== scene.width || next.height !== scene.height;
    scene = next;
    if (sizeChanged) layout();
    applyBackground(next.background);

    const alive = new Set(next.objects.map((o) => o.id));
    for (const [id, e] of entries) {
      if (!alive.has(id)) {
        e.view?.dispose?.();
        e.holder.destroy({ children: true });
        e.filter?.destroy();
        entries.delete(id);
      }
    }
    objectsLayer.removeChildren();
    for (const obj of next.objects) {
      const e = syncObject(obj);
      pose(e, 0);
      objectsLayer.addChild(e.holder);
    }
  }

  function render(): void {
    app.render();
  }

  layout();
  setScene(initial);

  return {
    view,
    get time() {
      return timelineTime(clock, scene.timeline);
    },
    setScene,
    update(dt) {
      clock += dt;
      for (const e of entries.values()) {
        const d = dt * e.obj.speed;
        e.time += d;
        e.view?.update(d, e.time);
        // Objects without keys or movement keep the pose set by setScene/seek.
        if (e.animated) pose(e, dt);
      }
      preset?.update(dt, clock);
      render();
    },
    seek(t) {
      clock = Math.max(0, t);
      for (const e of entries.values()) pose(e, 0);
      render();
    },
    setPointer(p) {
      pointer = p;
    },
    setPointerViewport(u, v) {
      pointer = Number.isFinite(u) && Number.isFinite(v)
        ? { x: (u * width - view.offsetX) / view.scale, y: (v * height - view.offsetY) / view.scale }
        : null;
    },
    setAudioLevel(level) {
      audioLevel = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
    },
    setSystemInfo(info) {
      live.system = info;
    },
    needs: () => {
      const needs: Array<BehaviorNeed | 'system'> = sceneNeeds(scene.objects);
      if (scene.objects.some((o) => !o.hidden && getObjectDef(o.type)?.needs === 'system')) needs.push('system');
      return needs;
    },
    resize(w, h, d) {
      width = w;
      height = h;
      dpr = d;
      app.renderer.resolution = d;
      app.renderer.resize(w, h);
      layout();
      render();
    },
    captureDesign(outW, outH) {
      const out = document.createElement('canvas');
      out.width = outW;
      out.height = outH;
      const g = out.getContext('2d')!;
      const presetCanvas = presetLayer.querySelector('canvas');
      if (presetCanvas) g.drawImage(presetCanvas, 0, 0, outW, outH);
      const r = app.renderer.resolution;
      g.drawImage(app.canvas, view.offsetX * r, view.offsetY * r, scene.width * view.scale * r, scene.height * view.scale * r, 0, 0, outW, outH);
      return out.toDataURL('image/png');
    },
    captureViewport() {
      const r = app.renderer.resolution;
      const out = document.createElement('canvas');
      out.width = Math.round(width * r);
      out.height = Math.round(height * r);
      const g = out.getContext('2d')!;
      const presetCanvas = presetLayer.querySelector('canvas');
      if (presetCanvas) g.drawImage(presetCanvas, view.offsetX * r, view.offsetY * r, scene.width * view.scale * r, scene.height * view.scale * r);
      g.drawImage(app.canvas, 0, 0);
      return out.toDataURL('image/png');
    },
    dispose() {
      presetToken++;
      preset?.dispose();
      for (const e of entries.values()) e.view?.dispose?.();
      entries.clear();
      bgTexture?.destroy(true);
      textures.glow.destroy(true);
      textures.dot.destroy(true);
      app.destroy({ removeView: true }, { children: true });
      presetLayer.remove();
    },
  };
}
