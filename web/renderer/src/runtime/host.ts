// Messaging with the native host (WebView2). Falls back to a no-op when the
// page is opened in a normal browser during development.

export type HostCommand =
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'setFps'; fps: number }
  | { type: 'setSpeed'; speed: number }
  | { type: 'setParams'; params: Record<string, unknown> }
  | { type: 'load'; preset: string; params?: Record<string, unknown>; seed?: number }
  /** Mouse position as a fraction of the window (may be outside 0..1); null when unknown. */
  | { type: 'pointer'; u: number | null; v: number | null }
  /** System audio level 0..1. */
  | { type: 'audio'; level: number }
  /** CPU / memory / battery for system widgets (percentages; null = unknown). */
  | { type: 'system'; cpu: number | null; memory: number | null; battery: number | null; charging: boolean; hasBattery: boolean };

export type RendererEvent =
  /** `needs` lists live inputs the scene wants from the host ('pointer', 'audio'). */
  | { type: 'ready'; preset: string; renderer: string; needs?: string[] }
  | { type: 'error'; message: string }
  | { type: 'stats'; fps: number }
  | { type: 'capture'; dataUrl: string; width: number; height: number };

interface WebViewBridge {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (e: MessageEvent) => void): void;
}

function bridge(): WebViewBridge | undefined {
  return (window as unknown as { chrome?: { webview?: WebViewBridge } }).chrome?.webview;
}

export function send(event: RendererEvent): void {
  bridge()?.postMessage(event);
}

export function isHostCommand(value: unknown): value is HostCommand {
  if (typeof value !== 'object' || value === null) return false;
  const t = (value as { type?: unknown }).type;
  return t === 'pause' || t === 'resume' || t === 'setFps' || t === 'setSpeed' || t === 'setParams' || t === 'load' || t === 'pointer' || t === 'audio' || t === 'system';
}

export function onCommand(handler: (cmd: HostCommand) => void): void {
  const listener = (e: MessageEvent) => {
    let data: unknown = e.data;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        return;
      }
    }
    if (isHostCommand(data)) handler(data);
  };
  bridge()?.addEventListener('message', listener);
}

export interface CaptureOptions {
  width: number;
  height: number;
  /** Seconds of animation to simulate before grabbing the frame. */
  at: number;
}

export interface LaunchOptions {
  preset: string;
  fps: number;
  speed: number;
  seed: number;
  params: Record<string, unknown>;
  /** Present when the page should render one still frame (Lock Screen Export) instead of animating. */
  capture?: CaptureOptions;
  /** Scene file to play instead of a preset (a saved project or a template). */
  sceneUrl?: string;
  /** Video from the user's video library to play instead of a preset. */
  video?: { url: string; fit: 'cover' | 'contain' };
}

/** Virtual host the native side maps to the user's video library. */
export const MEDIA_HOST = 'https://media.dreamcanvas.local';

/** Only files inside DreamCanvas's video library may be played: media/<id>/video.(mp4|webm). */
export function videoFor(q: URLSearchParams, params: Record<string, unknown>): LaunchOptions['video'] {
  const id = q.get('video');
  const file = params.file;
  if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id) || typeof file !== 'string' || !/^video\.(mp4|webm)$/.test(file)) return undefined;
  return { url: `${MEDIA_HOST}/${id}/${file}`, fit: params.fit === 'contain' ? 'contain' : 'cover' };
}

/** Virtual host the native side maps to the user's projects folder. */
export const PROJECTS_HOST = 'https://projects.dreamcanvas.local';

/** Only DreamCanvas's own locations may be loaded as scenes. */
export function sceneUrlFor(q: URLSearchParams): string | undefined {
  const project = q.get('project');
  if (project && /^[A-Za-z0-9_-]{1,64}$/.test(project)) {
    return `${PROJECTS_HOST}/${project}/scene.json?rev=${encodeURIComponent(q.get('rev') ?? '0')}`;
  }
  const scene = q.get('scene');
  if (scene && /^[A-Za-z0-9_\-/]+\.json$/.test(scene) && !scene.includes('..')) return `./${scene}`;
  return undefined;
}

export function parseLaunchOptions(search: string): LaunchOptions {
  const q = new URLSearchParams(search);
  let params: Record<string, unknown> = {};
  const rawParams = q.get('params');
  if (rawParams) {
    try {
      const parsed = JSON.parse(rawParams);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) params = parsed;
    } catch {
      // Ignore malformed overrides; defaults are used instead.
    }
  }
  const num = (key: string, fallback: number) => {
    const v = Number(q.get(key));
    return q.has(key) && Number.isFinite(v) ? v : fallback;
  };
  const options: LaunchOptions = {
    preset: q.get('preset') ?? 'galaxy',
    fps: num('fps', 30),
    speed: Math.min(4, Math.max(0.1, num('speed', 1))),
    seed: Math.trunc(num('seed', 1337)) >>> 0,
    params,
    sceneUrl: sceneUrlFor(q),
    video: videoFor(q, params),
  };
  if (!options.video) delete options.video;
  if (q.get('capture') === '1') {
    const clampSize = (v: number) => Math.min(16384, Math.max(16, Math.round(v)));
    options.capture = {
      width: clampSize(num('width', 1920)),
      height: clampSize(num('height', 1080)),
      at: Math.min(60, Math.max(0, num('at', 8))),
    };
  }
  return options;
}
