// Dev tool: records a few seconds of a preset to a real WebM file (MediaRecorder in headless
// Edge), for testing video wallpapers without downloading anything.
//   node scripts/make-test-video.mjs <out.webm> [presetId] [seconds]
import { writeFile } from 'node:fs/promises';
import { openBrowser, sleep } from './lib/browser.mjs';

const [out, preset = 'blossom-breeze', seconds = '6'] = process.argv.slice(2);
if (!out) {
  console.error('usage: node scripts/make-test-video.mjs <out.webm> [presetId] [seconds]');
  process.exit(2);
}
const page = await openBrowser({ width: 1280, height: 720 });
try {
  await page.navigate(`index.html?preset=${encodeURIComponent(preset)}`);
  await page.waitFor(`!!document.querySelector('#stage canvas')`, 'the preset canvas');
  await sleep(1000);
  const base64 = await page.evaluate(`(async () => {
    const canvas = document.querySelector('#stage canvas');
    const stream = canvas.captureStream(30);
    const type = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 4_000_000 });
    const chunks = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((r) => (recorder.onstop = r));
    recorder.start(500);
    await new Promise((r) => setTimeout(r, ${Number(seconds) * 1000}));
    recorder.stop();
    await done;
    const buf = await new Blob(chunks, { type }).arrayBuffer();
    let s = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  })()`);
  const bytes = Buffer.from(base64, 'base64');
  await writeFile(out, bytes);
  console.log(`Saved ${out} (${(bytes.length / 1024).toFixed(0)} KB, ${seconds} s of ${preset})`);
} finally {
  await page.close();
}
