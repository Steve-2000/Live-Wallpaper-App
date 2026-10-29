import { RenderLoop } from './runtime/loop';
import { createRandom, resolveParams } from './runtime/params';
import { loadPreset } from './runtime/registry';
import { onCommand, parseLaunchOptions, send, type CaptureOptions } from './runtime/host';
import type { PresetInstance, PresetManifest } from './runtime/types';
import type { SceneRuntime } from './scene/runtime';
import { parseScene } from './scene/validate';

// Loaded on demand so plain preset wallpapers don't pay for the scene engine.
const sceneRuntime = () => import('./scene/runtime').then((m) => m.createSceneRuntime);

const stage = document.getElementById('stage')!;
const errorBox = document.getElementById('error')!;

let instance: PresetInstance | null = null;
/** Live inputs of a playing scene (mouse, audio); null for preset wallpapers. */
let sceneInputs: Pick<SceneRuntime, 'setPointerViewport' | 'setPointer' | 'setAudioLevel' | 'setSystemInfo'> | null = null;
let manifest: PresetManifest | null = null;
let speed = 1;
let time = 0;
let hostPaused = false;
let loadToken = 0;

let frames = 0;
let statsWindow = 0;

const loop = new RenderLoop(30, {
  frame(dt) {
    if (!instance) return;
    const scaled = dt * speed;
    time += scaled;
    instance.update(scaled, time);
    frames++;
    statsWindow += dt;
    if (statsWindow >= 2) {
      send({ type: 'stats', fps: Math.round(frames / statsWindow) });
      frames = 0;
      statsWindow = 0;
    }
  },
});

function showError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  errorBox.textContent = `DreamCanvas renderer error: ${message}`;
  errorBox.hidden = false;
  send({ type: 'error', message });
}

function size() {
  return { width: window.innerWidth, height: window.innerHeight, dpr: Math.min(window.devicePixelRatio || 1, 2) };
}

async function load(presetId: string, overrides: Record<string, unknown>, seed: number): Promise<void> {
  const token = ++loadToken;
  try {
    const loaded = await loadPreset(presetId);
    if (token !== loadToken) return;
    instance?.dispose();
    instance = null;
    sceneInputs = null;
    stopVideo();
    stage.replaceChildren();
    errorBox.hidden = true;
    manifest = loaded.manifest;
    time = 0;
    const { width, height, dpr } = size();
    const created = await loaded.module.create({
      host: stage,
      width,
      height,
      dpr,
      params: resolveParams(manifest.params, overrides),
      random: createRandom(seed),
      seed,
    });
    if (token !== loadToken) {
      created.dispose();
      return;
    }
    instance = created;
    send({ type: 'ready', preset: manifest.id, renderer: manifest.renderer });
    updateRunning();
  } catch (err) {
    showError(err);
  }
}

function updateRunning(): void {
  if (video) {
    // Videos run on their own clock; pausing them stops decoding entirely.
    loop.stop();
    if (!hostPaused && document.visibilityState === 'visible') void video.play().catch(() => {});
    else video.pause();
    return;
  }
  const shouldRun = !hostPaused && document.visibilityState === 'visible' && instance !== null;
  if (shouldRun) loop.start();
  else loop.stop();
}

// ------------------------------------------------------------------------- video wallpapers

/** The playing video wallpaper, if any. */
let video: HTMLVideoElement | null = null;

function stopVideo(): void {
  if (!video) return;
  video.pause();
  video.removeAttribute('src');
  video.load(); // releases the decoder
  video.remove();
  video = null;
}

function createVideo(url: string, fit: 'cover' | 'contain', crossOrigin: boolean): Promise<HTMLVideoElement> {
  const v = document.createElement('video');
  // Exports read pixels back, which needs a CORS-clean video; plain playback doesn't.
  if (crossOrigin) v.crossOrigin = 'anonymous';
  v.muted = true;
  v.loop = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.disablePictureInPicture = true;
  Object.assign(v.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: fit, background: '#000' });
  v.src = url;
  return new Promise((resolve, reject) => {
    v.addEventListener('loadeddata', () => resolve(v), { once: true });
    v.addEventListener('error', () => reject(new Error(`This video can't be played (${v.error?.message || `code ${v.error?.code ?? '?'}`}).`)), { once: true });
  });
}

async function loadVideo(url: string, fit: 'cover' | 'contain'): Promise<void> {
  const token = ++loadToken;
  try {
    const v = await createVideo(url, fit, false);
    if (token !== loadToken) return;
    instance?.dispose();
    instance = null;
    manifest = null;
    sceneInputs = null;
    stage.replaceChildren(v);
    errorBox.hidden = true;
    v.playbackRate = speed;
    video = v;
    // Report the rate at which frames actually reach the screen.
    const rvfc = (v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }).requestVideoFrameCallback?.bind(v);
    let shown = 0;
    let since = performance.now();
    const onFrame = () => {
      shown++;
      const now = performance.now();
      if (now - since >= 2000) {
        send({ type: 'stats', fps: Math.round((shown * 1000) / (now - since)) });
        shown = 0;
        since = now;
      }
      rvfc?.(onFrame);
    };
    rvfc?.(onFrame);
    send({ type: 'ready', preset: 'video', renderer: 'video' });
    updateRunning();
  } catch (err) {
    showError(err);
  }
}

/** Still export of a video wallpaper: the frame at `at` seconds, scaled like the wallpaper. */
async function captureVideo(url: string, fit: 'cover' | 'contain', c: CaptureOptions): Promise<void> {
  try {
    const v = await createVideo(url, fit, true);
    v.currentTime = v.duration > 0 ? c.at % v.duration : 0;
    await new Promise((r) => v.addEventListener('seeked', r, { once: true }));
    const canvas = document.createElement('canvas');
    canvas.width = c.width;
    canvas.height = c.height;
    const g = canvas.getContext('2d')!;
    const k = (fit === 'cover' ? Math.max : Math.min)(c.width / v.videoWidth, c.height / v.videoHeight);
    const w = v.videoWidth * k;
    const h = v.videoHeight * k;
    g.fillStyle = '#000';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(v, (c.width - w) / 2, (c.height - h) / 2, w, h);
    send({ type: 'capture', dataUrl: canvas.toDataURL('image/png'), width: c.width, height: c.height });
  } catch (err) {
    showError(err);
  }
}

window.addEventListener('resize', () => {
  const { width, height, dpr } = size();
  instance?.resize(width, height, dpr);
});

document.addEventListener('visibilitychange', updateRunning);

onCommand((cmd) => {
  switch (cmd.type) {
    case 'pause':
      hostPaused = true;
      break;
    case 'resume':
      hostPaused = false;
      break;
    case 'setFps':
      loop.limiter.setFps(cmd.fps);
      break;
    case 'setSpeed':
      speed = Math.min(4, Math.max(0.1, cmd.speed));
      if (video) video.playbackRate = speed;
      break;
    case 'setParams':
      if (manifest && instance) instance.setParams(resolveParams(manifest.params, cmd.params));
      break;
    case 'load':
      void load(cmd.preset, cmd.params ?? {}, cmd.seed ?? 1337);
      return;
    case 'pointer':
      if (cmd.u === null || cmd.v === null) sceneInputs?.setPointer(null);
      else sceneInputs?.setPointerViewport(cmd.u, cmd.v);
      return;
    case 'audio':
      sceneInputs?.setAudioLevel(cmd.level);
      return;
    case 'system':
      sceneInputs?.setSystemInfo({ cpu: cmd.cpu, memory: cmd.memory, battery: cmd.battery, charging: cmd.charging, hasBattery: cmd.hasBattery });
      return;
  }
  updateRunning();
});

window.addEventListener('error', (e) => showError(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => showError(e.reason));

/**
 * Still-frame export: render at exactly width x height (CSS pixels = image pixels), simulate
 * `at` seconds so particles and orbits settle, then hand the frame back as a PNG data URL.
 * The frame is read in the same task it was drawn, so WebGL needs no preserveDrawingBuffer.
 */
async function capture(presetId: string, overrides: Record<string, unknown>, seed: number, c: CaptureOptions): Promise<void> {
  try {
    const loaded = await loadPreset(presetId);
    const params = resolveParams(loaded.manifest.params, overrides);
    // Exports always use full internal resolution.
    for (const spec of loaded.manifest.params) {
      if (spec.key === 'quality' && spec.type === 'range') params.quality = spec.max;
    }
    stage.style.width = `${c.width}px`;
    stage.style.height = `${c.height}px`;
    stage.style.right = stage.style.bottom = 'auto';
    const preset = await loaded.module.create({
      host: stage, width: c.width, height: c.height, dpr: 1, params, random: createRandom(seed), seed,
    });
    const dt = 1 / 30;
    const steps = Math.max(1, Math.round(c.at / dt));
    for (let i = 1; i <= steps; i++) preset.update(dt, i * dt);
    const canvas = stage.querySelector('canvas');
    if (!canvas) throw new Error('Preset did not create a canvas');
    send({ type: 'capture', dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height });
    preset.dispose();
  } catch (err) {
    showError(err);
  }
}

async function fetchScene(url: string) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not load scene (${response.status})`);
  return parseScene(await response.text());
}

/** Plays an editable scene (a saved project or template) as the wallpaper. */
async function loadScene(url: string): Promise<void> {
  const token = ++loadToken;
  try {
    const scene = await fetchScene(url);
    const { width, height, dpr } = size();
    const runtime = await (await sceneRuntime())(stage, scene, { width, height, dpr, fit: 'cover' });
    if (token !== loadToken) {
      runtime.dispose();
      return;
    }
    instance?.dispose();
    stopVideo();
    manifest = null;
    instance = {
      update: (dt) => runtime.update(dt),
      resize: (w, h, d) => runtime.resize(w, h, d),
      setParams: () => {},
      dispose: () => runtime.dispose(),
    };
    sceneInputs = runtime;
    send({ type: 'ready', preset: 'scene', renderer: 'scene', needs: runtime.needs() });
    updateRunning();
  } catch (err) {
    showError(err);
  }
}

async function captureScene(url: string, c: CaptureOptions): Promise<void> {
  try {
    const scene = await fetchScene(url);
    stage.style.width = `${c.width}px`;
    stage.style.height = `${c.height}px`;
    stage.style.right = stage.style.bottom = 'auto';
    const runtime = await (await sceneRuntime())(stage, scene, { width: c.width, height: c.height, dpr: 1, fit: 'cover' });
    const steps = Math.max(1, Math.round(c.at * 30));
    for (let i = 0; i < steps - 1; i++) runtime.update(1 / 30);
    // Background presets load asynchronously; give them a moment before the final frame.
    await new Promise((r) => setTimeout(r, 300));
    runtime.update(1 / 30);
    send({ type: 'capture', dataUrl: runtime.captureViewport(), width: c.width, height: c.height });
    runtime.dispose();
  } catch (err) {
    showError(err);
  }
}

const options = parseLaunchOptions(location.search);
speed = options.speed;
loop.limiter.setFps(options.fps);
if (options.video && options.capture) void captureVideo(options.video.url, options.video.fit, options.capture);
else if (options.video) void loadVideo(options.video.url, options.video.fit);
else if (options.sceneUrl && options.capture) void captureScene(options.sceneUrl, options.capture);
else if (options.sceneUrl) void loadScene(options.sceneUrl);
else if (options.capture) void capture(options.preset, options.params, options.seed, options.capture);
else void load(options.preset, options.params, options.seed);
