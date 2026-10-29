// Dev tool: screenshots a page of the built renderer with headless Edge.
//   node scripts/screenshot.mjs "<page?query>" <out.png> [width] [height] [virtualTimeMs]
// e.g. node scripts/screenshot.mjs "index.html?scene=templates/night-forest.json" shot.png 1366 768
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { preview } from 'vite';

const [page, out, w = '1366', h = '768', budget = '5000'] = process.argv.slice(2);
if (!page || !out) {
  console.error('usage: node scripts/screenshot.mjs "<page?query>" <out.png> [width] [height] [virtualTimeMs]');
  process.exit(2);
}
const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
if (!edge) throw new Error('Microsoft Edge not found');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await preview({ root, preview: { port: 0, host: '127.0.0.1' }, logLevel: 'silent' });
const profile = await mkdtemp(join(tmpdir(), 'dreamcanvas-shot-'));
try {
  const url = `http://127.0.0.1:${server.httpServer.address().port}/${page}`;
  // SHOW_CONSOLE=1 prints the page's console messages (Chromium logs them to stderr).
  const showConsole = process.env.SHOW_CONSOLE === '1';
  const { stderr } = await promisify(execFile)(edge, [
    '--headless=new', '--hide-scrollbars', '--no-first-run', `--user-data-dir=${profile}`,
    ...(showConsole ? ['--enable-logging=stderr', '--v=0'] : ['--log-level=3']),
    `--window-size=${w},${h}`, `--virtual-time-budget=${budget}`, `--screenshot=${resolve(out)}`, url,
  ], { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
  if (showConsole) {
    for (const line of stderr.split('\n')) if (line.includes('CONSOLE') && line.includes('127.0.0.1')) console.log(line.trim());
  }
  console.log(`Saved ${resolve(out)}`);
} finally {
  server.httpServer.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
