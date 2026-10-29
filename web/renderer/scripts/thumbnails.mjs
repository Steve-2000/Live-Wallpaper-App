// Renders a still thumbnail of every preset with headless Microsoft Edge and saves
// them as dist/thumbnails/<id>.png, used by the native gallery cards. A copy is kept
// in .thumbnails/ so fast builds (which empty dist/) can reuse them.
// Run after `npm run build`:  node scripts/thumbnails.mjs
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { preview } from 'vite';

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const outDir = join(dist, 'thumbnails');
const cacheDir = join(root, '.thumbnails');

const edgeCandidates = [
  process.env.EDGE_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const edge = edgeCandidates.find((p) => existsSync(p));
if (!edge) {
  console.warn('Microsoft Edge not found; skipping thumbnails (set EDGE_PATH to override).');
  process.exit(0);
}

const { presets } = JSON.parse(await readFile(join(dist, 'presets.json'), 'utf8'));
await mkdir(outDir, { recursive: true });
await mkdir(cacheDir, { recursive: true });

const server = await preview({ root, preview: { port: 0, strictPort: false, host: '127.0.0.1' }, logLevel: 'silent' });
const address = server.httpServer.address();
const base = `http://127.0.0.1:${address.port}`;
const profile = await mkdtemp(join(tmpdir(), 'dreamcanvas-thumbs-'));

async function capture(preset, file) {
  const url = `${base}/index.html?preset=${encodeURIComponent(preset.id)}&fps=30`;
  await run(edge, [
    '--headless=new',
    '--disable-gpu-sandbox',
    '--hide-scrollbars',
    '--no-first-run',
    '--mute-audio',
    '--log-level=3',
    `--user-data-dir=${profile}`,
    '--window-size=640,360',
    '--virtual-time-budget=6000',
    `--screenshot=${file}`,
    url,
  ], { timeout: 120_000 });
  if (!existsSync(file)) throw new Error(`Edge did not produce ${file}`);
}

// Thumbnails are cosmetic (cards fall back to a gradient), so failures warn instead of failing the build.
let failed = 0;
try {
  for (const preset of presets) {
    const file = join(outDir, `${preset.id}.png`);
    let error;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await capture(preset, file);
        error = undefined;
        break;
      } catch (e) {
        error = e;
      }
    }
    if (error) {
      failed++;
      console.warn(`thumbnail FAILED: ${preset.id} (${String(error.message).split('\n')[0]})`);
      continue;
    }
    await copyFile(file, join(cacheDir, `${preset.id}.png`));
    console.log(`thumbnail: ${preset.id}`);
  }
  if (failed) console.warn(`${failed} thumbnail(s) failed; the gallery shows gradient cards for those.`);
} finally {
  server.httpServer.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
