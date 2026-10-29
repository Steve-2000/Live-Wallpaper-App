import { PROJECTS_HOST } from '../runtime/host';
import { emptyScene, parseScene } from '../scene/validate';
import type { Scene } from '../scene/types';

/** How the editor loads and saves: through the DreamCanvas app, or (in a browser) local storage. */
export interface EditorHost {
  readonly native: boolean;
  load(): Promise<Scene>;
  save(scene: Scene, thumbnail: string): Promise<void>;
  /** Saves, then sets the scene as the desktop wallpaper. */
  apply(scene: Scene, thumbnail: string): Promise<void>;
}

interface WebViewBridge {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (e: MessageEvent) => void): void;
}

const bridge = (window as unknown as { chrome?: { webview?: WebViewBridge } }).chrome?.webview;

function nativeHost(projectId: string, webview: WebViewBridge): EditorHost {
  let next = 1;
  const pending = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();
  webview.addEventListener('message', (e) => {
    const msg = e.data as { type?: string; requestId?: number; ok?: boolean; error?: string };
    if (msg?.type !== 'reply' || typeof msg.requestId !== 'number') return;
    const p = pending.get(msg.requestId);
    pending.delete(msg.requestId);
    if (!p) return;
    if (msg.ok) p.resolve();
    else p.reject(new Error(msg.error || 'The app could not complete the request.'));
  });
  const request = (type: string, scene: Scene, thumbnail: string) =>
    new Promise<void>((resolve, reject) => {
      const requestId = next++;
      pending.set(requestId, { resolve, reject });
      webview.postMessage({ type, requestId, projectId, scene: JSON.stringify(scene), thumbnail });
      setTimeout(() => {
        if (pending.delete(requestId)) reject(new Error('The app did not respond.'));
      }, 60_000);
    });

  return {
    native: true,
    async load() {
      const res = await fetch(`${PROJECTS_HOST}/${projectId}/scene.json?rev=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Could not open the project (${res.status}).`);
      return parseScene(await res.text());
    },
    save: (scene, thumbnail) => request('save', scene, thumbnail),
    apply: (scene, thumbnail) => request('apply', scene, thumbnail),
  };
}

const DRAFT_KEY = 'dreamcanvas.editor.draft';

/** Browser fallback for development: keeps one draft in local storage. */
function browserHost(): EditorHost {
  return {
    native: false,
    async load() {
      try {
        const draft = localStorage.getItem(DRAFT_KEY);
        if (draft) return parseScene(draft);
      } catch {
        // Storage unavailable or draft corrupt: fall through to the template.
      }
      const res = await fetch('./templates/night-forest.json');
      return res.ok ? parseScene(await res.text()) : emptyScene();
    },
    async save(scene) {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(scene));
      } catch {
        throw new Error('Could not save the draft in this browser.');
      }
    },
    async apply() {
      throw new Error('Setting the wallpaper is only available inside the DreamCanvas app.');
    },
  };
}

export function createHost(): EditorHost {
  const project = new URLSearchParams(location.search).get('project');
  if (bridge && project && /^[A-Za-z0-9_-]{1,64}$/.test(project)) return nativeHost(project, bridge);
  return browserHost();
}
