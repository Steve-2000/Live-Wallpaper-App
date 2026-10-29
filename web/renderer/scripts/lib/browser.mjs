// Headless Edge driven over the DevTools protocol (no extra dependencies), serving the built dist/.
// Shared by the editor end-to-end checks and the preset smoke test.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const rendererRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Starts a preview server and headless Edge; returns helpers for one page. Call close() when done. */
export async function openBrowser({ width = 1366, height = 768 } = {}) {
  const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  if (!edge) throw new Error('Microsoft Edge not found');
  const server = await preview({ root: rendererRoot, preview: { port: 0, host: '127.0.0.1' }, logLevel: 'silent' });
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const profile = await mkdtemp(join(tmpdir(), 'dreamcanvas-cdp-'));
  const browser = spawn(edge, ['--headless=new', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `--window-size=${width},${height}`, 'about:blank']);

  let port;
  for (let i = 0; i < 100 && !port; i++) {
    await sleep(100);
    const file = join(profile, 'DevToolsActivePort');
    if (existsSync(file)) port = (await readFile(file, 'utf8')).split('\n')[0];
  }
  if (!port) throw new Error('Edge did not open a debugging port');
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  /** Console errors and uncaught exceptions since the last clearErrors(). */
  const errors = [];
  let nextId = 1;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
    }
  };
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  await cdp('Runtime.enable');
  await cdp('Page.enable');

  const evaluate = async (expression) => {
    const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`evaluate failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  const waitFor = async (expression, what, timeout = 10_000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await evaluate(expression)) return;
      await sleep(100);
    }
    throw new Error(`timed out waiting for ${what}`);
  };

  return {
    base,
    cdp,
    evaluate,
    waitFor,
    errors,
    clearErrors: () => { errors.length = 0; },
    navigate: (path) => cdp('Page.navigate', { url: `${base}/${path}` }),
    /** PNG bytes of the viewport. */
    screenshot: async () => Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
    async close() {
      ws.close();
      browser.kill();
      server.httpServer.close();
      await sleep(300);
      await rm(profile, { recursive: true, force: true }).catch(() => {});
    },
  };
}
