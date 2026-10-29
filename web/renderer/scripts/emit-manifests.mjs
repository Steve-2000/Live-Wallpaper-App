// Collects every src/presets/<id>/manifest.json into dist/presets.json, which the
// native app reads to populate the gallery. Run after `vite build`.
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile, access, copyFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const presetsDir = join(root, 'src', 'presets');
const out = join(root, 'dist', 'presets.json');

const entries = await readdir(presetsDir, { withFileTypes: true });
const manifests = [];
for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  const file = join(presetsDir, entry.name, 'manifest.json');
  await access(join(presetsDir, entry.name, 'index.ts'));
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  if (manifest.id !== entry.name) throw new Error(`${file}: id "${manifest.id}" must match folder "${entry.name}"`);
  manifests.push(manifest);
}
manifests.sort((a, b) => a.name.localeCompare(b.name));

await writeFile(out, JSON.stringify({ formatVersion: 1, presets: manifests }, null, 2));
console.log(`Wrote ${manifests.length} preset manifests to ${out}`);

// Reuse thumbnails from the last `npm run thumbnails` (vite empties dist/ on every build).
const cache = join(root, '.thumbnails');
if (existsSync(cache)) {
  const thumbs = join(root, 'dist', 'thumbnails');
  await mkdir(thumbs, { recursive: true });
  let copied = 0;
  for (const m of manifests) {
    const src = join(cache, `${m.id}.png`);
    if (existsSync(src)) {
      await copyFile(src, join(thumbs, `${m.id}.png`));
      copied++;
    }
  }
  const missing = manifests.length - copied;
  console.log(`Copied ${copied} cached thumbnails${missing ? ` (${missing} missing - run npm run thumbnails)` : ''}`);
}
