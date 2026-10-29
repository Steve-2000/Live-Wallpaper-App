// Loads every preset of the built renderer in headless Edge and fails if one shows an error
// (e.g. a shader that doesn't compile) or logs a console error. Uses dist/ (build first).
//   node scripts/preset-smoke.mjs [screenshotDir] [presetId...]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openBrowser, rendererRoot, sleep } from './lib/browser.mjs';

const [shotDir, ...only] = process.argv.slice(2);
const { presets } = JSON.parse(await readFile(join(rendererRoot, 'dist', 'presets.json'), 'utf8'));
const list = only.length ? presets.filter((p) => only.includes(p.id)) : presets;
if (shotDir) await mkdir(shotDir, { recursive: true });

const page = await openBrowser({ width: 1280, height: 720 });
let failures = 0;
try {
  for (const p of list) {
    page.clearErrors();
    await page.navigate(`index.html?preset=${p.id}`);
    try {
      await page.waitFor(`document.readyState === 'complete' && location.search.includes(${JSON.stringify(p.id)})
        && (!!document.querySelector('#stage canvas') || document.getElementById('error')?.hidden === false)`, 'a canvas');
      await sleep(2500); // let animations run for a moment
      const shown = await page.evaluate(`document.getElementById('error').hidden ? '' : document.getElementById('error').textContent`);
      const problems = [shown, ...page.errors].filter(Boolean);
      if (problems.length) throw new Error(problems.join(' | '));
      if (shotDir) await writeFile(join(shotDir, `${p.id}.png`), await page.screenshot());
      console.log(`  PASS  ${p.id} (${p.renderer})`);
    } catch (e) {
      failures++;
      console.log(`  FAIL  ${p.id}: ${e.message}`);
    }
  }
} finally {
  await page.close();
}
console.log(failures === 0 ? `All ${list.length} presets load cleanly.` : `${failures} preset(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
