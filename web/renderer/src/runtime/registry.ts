import type { PresetManifest, PresetModule } from './types';

// Presets are discovered from the folder layout: adding src/presets/<id>/
// with a manifest.json and index.ts is all it takes to register a new one.
const manifests = import.meta.glob<PresetManifest>('../presets/*/manifest.json', {
  eager: true,
  import: 'default',
});
const modules = import.meta.glob<PresetModule>('../presets/*/index.ts');

function folderOf(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 2];
}

const byId = new Map<string, { manifest: PresetManifest; load: () => Promise<PresetModule> }>();

for (const [path, manifest] of Object.entries(manifests)) {
  const folder = folderOf(path);
  const loader = modules[`../presets/${folder}/index.ts`];
  if (!loader) throw new Error(`Preset "${folder}" has a manifest but no index.ts`);
  if (manifest.id !== folder) throw new Error(`Preset folder "${folder}" declares id "${manifest.id}"`);
  byId.set(manifest.id, { manifest, load: loader });
}

export function listPresets(): PresetManifest[] {
  return [...byId.values()].map((p) => p.manifest).sort((a, b) => a.name.localeCompare(b.name));
}

export function getManifest(id: string): PresetManifest | undefined {
  return byId.get(id)?.manifest;
}

export async function loadPreset(id: string): Promise<{ manifest: PresetManifest; module: PresetModule }> {
  const entry = byId.get(id);
  if (!entry) throw new Error(`Unknown preset "${id}"`);
  return { manifest: entry.manifest, module: await entry.load() };
}
