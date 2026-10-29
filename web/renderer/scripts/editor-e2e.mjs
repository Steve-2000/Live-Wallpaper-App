// End-to-end check of the scene editor's animation tools in headless Edge, driven over the
// DevTools protocol with real mouse/keyboard input. Uses the built dist/ (run `npm run build:fast`).
//   node scripts/editor-e2e.mjs
// Each step acts like a user would and then verifies the scene the editor saved.
import { openBrowser, sleep } from './lib/browser.mjs';

const page = await openBrowser({ width: 1366, height: 768 });
const { cdp, evaluate, waitFor, errors } = page;
let failures = 0;
try {
  const rect = (selector) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  const centre = async (selector) => {
    const r = await rect(selector);
    if (!r) throw new Error(`no element ${selector}`);
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  };
  const mouse = (type, x, y, extra = {}) => cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });
  const click = async (x, y) => { await mouse('mouseMoved', x, y, { button: 'none' }); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); await sleep(60); };
  const clickOn = async (selector) => { const c = await centre(selector); await click(c.x, c.y); };
  const drag = async (from, to, steps = 8) => {
    await mouse('mouseMoved', from.x, from.y, { button: 'none' });
    await mouse('mousePressed', from.x, from.y);
    for (let i = 1; i <= steps; i++) await mouse('mouseMoved', from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps, { buttons: 1 });
    await mouse('mouseReleased', to.x, to.y);
    await sleep(60);
  };
  const KEYS = { Enter: 13, Delete: 46, Escape: 27, s: 83, z: 90 };
  const key = async (k, modifiers = 0) => {
    const code = KEYS[k];
    const base = { key: k, code: k.length === 1 ? `Key${k.toUpperCase()}` : k, windowsVirtualKeyCode: code, modifiers };
    await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    await sleep(60);
  };
  const CTRL = 2;
  const typeInto = async (selector, text) => {
    await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.focus(); e.select(); })()`);
    await cdp('Input.insertText', { text });
    await evaluate('document.activeElement.blur()');
    await sleep(60);
  };
  /** React listens for native change events on <select>; set the value the way a user pick would. */
  const choose = (selector, value) => evaluate(`(() => {
    const e = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(e, ${JSON.stringify(value)});
    e.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  /** Saves now (Ctrl+S) and returns the scene the editor stored. */
  const saved = async () => {
    await key('s', CTRL);
    await sleep(150);
    return evaluate(`JSON.parse(localStorage.getItem('dreamcanvas.editor.draft'))`);
  };
  const objectIn = (scene, id) => scene.objects.find((o) => o.id === id);
  const keysOf = (o, prop) => (o.keyframes[prop] ?? []).map((k) => [k.t, Math.round(k.value)]);
  const rulerX = async (t) => { const r = await rect('.tl-ruler'); const d = await evaluate(`Number(document.querySelector('.tl-duration input').value)`); return r.x + (r.w * t) / d; };
  const toScreen = async (p) => {
    const f = await evaluate(`(() => { const r = document.querySelector('.design-frame'); const s = document.querySelector('.overlay').getBoundingClientRect(); return { x: +r.getAttribute('x') + s.x, y: +r.getAttribute('y') + s.y, w: +r.getAttribute('width') }; })()`);
    const k = f.w / 1920;
    return { x: f.x + p.x * k, y: f.y + p.y * k };
  };

  async function step(name, body) {
    try {
      await body();
      console.log(`  PASS  ${name}`);
    } catch (e) {
      failures++;
      console.log(`  FAIL  ${name}: ${e.message}`);
    }
  }
  const expectEqual = (actual, expected, what) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  };

  // ------------------------------------------------------------------ the checks
  await page.navigate('editor.html?select=bird-1&t=0');
  await waitFor(`!!document.querySelector('.design-frame') && !!document.querySelector('.tl-ruler')`, 'the editor to load');
  await sleep(300);
  console.log('Editor e2e (Night Forest template, Bird 1 selected):');

  await step('◆ adds a key, and an edit at another time adds a second key', async () => {
    await clickOn('button[aria-label="Add X position keyframe at the playhead"]');
    await click(await rulerX(5), (await centre('.tl-ruler')).y);
    await waitFor(`document.querySelector('.tl-time').textContent === '0:05.00'`, 'playhead at 5 s');
    await typeInto('.num-grid .keyed:nth-child(1) input', '1200');
    const bird = objectIn(await saved(), 'bird-1');
    expectEqual(keysOf(bird, 'x'), [[0, 880], [5, 1200]], 'x keys');
    expectEqual(bird.x, 880, 'static x');
  });

  await step('scrubbing shows the in-between value', async () => {
    await click(await rulerX(2.5), (await centre('.tl-ruler')).y);
    await waitFor(`document.querySelector('.num-grid .keyed:nth-child(1) input').value === '1040'`, 'X = 1040 at 2.5 s');
  });

  await step('dragging a key on the timeline moves it in time', async () => {
    const row = '.tl-object[data-object="bird-1"] .tl-row:not(.sub) .tl-lane';
    const lane = await rect(row);
    const from = { x: await rulerX(5), y: lane.y + lane.h / 2 };
    await drag(from, { x: await rulerX(8), y: from.y });
    expectEqual(keysOf(objectIn(await saved(), 'bird-1'), 'x'), [[0, 880], [8, 1200]], 'x keys after drag');
  });

  await step('the selected key\'s easing can be changed', async () => {
    await waitFor(`!!document.querySelector('.tl-key-tools select')`, 'key tools');
    await choose('.tl-key-tools select', 'bounce');
    const k = objectIn(await saved(), 'bird-1').keyframes.x.find((x) => x.t === 8);
    expectEqual(k.ease, 'bounce', 'ease');
  });

  await step('Delete removes the selected key and Ctrl+Z brings it back', async () => {
    await key('Delete');
    expectEqual(keysOf(objectIn(await saved(), 'bird-1'), 'x'), [[0, 880]], 'after delete');
    expectEqual((await saved()).objects.length, 17, 'objects untouched');
    await key('z', CTRL);
    expectEqual(keysOf(objectIn(await saved(), 'bird-1'), 'x'), [[0, 880], [8, 1200]], 'after undo');
  });

  await step('Record mode keys a field that had no keys', async () => {
    await clickOn('.tl-head button.record');
    await click(await rulerX(10), (await centre('.tl-ruler')).y);
    await typeInto('.num-grid .keyed:nth-child(2) input', '500');
    await clickOn('.tl-head button.record');
    expectEqual(keysOf(objectIn(await saved(), 'bird-1'), 'y'), [[10, 500]], 'y keys');
  });

  await step('a movement can be added and tuned', async () => {
    await choose('select.add-behavior', 'orbit');
    await waitFor(`[...document.querySelectorAll('.behavior-name')].some((e) => e.textContent === 'Orbit')`, 'orbit card');
    const bird = objectIn(await saved(), 'bird-1');
    expectEqual(bird.behaviors.map((b) => b.type), ['fly', 'orbit'], 'behaviours');
  });

  await step('a path can be drawn by clicking on the canvas', async () => {
    await choose('select.add-behavior', 'path');
    await waitFor(`!!document.querySelector('.path-banner')`, 'drawing mode');
    // Points relative to the bird's position at the playhead (x keyed: 880 -> 1200, y keyed 500).
    const pose = await evaluate(`({ x: Number(document.querySelector('.num-grid .keyed:nth-child(1) input').value), y: Number(document.querySelector('.num-grid .keyed:nth-child(2) input').value) })`);
    for (const [dx, dy] of [[200, 0], [200, 200], [0, 200]]) {
      const s = await toScreen({ x: pose.x + dx, y: pose.y + dy });
      await click(s.x, s.y);
      await sleep(400); // keep clicks apart so they aren't read as a double-click
    }
    await key('Enter');
    await waitFor(`!document.querySelector('.path-banner')`, 'drawing to finish');
    const path = objectIn(await saved(), 'bird-1').behaviors.find((b) => b.type === 'path').path;
    if (path.length !== 3) throw new Error(`expected 3 points, got ${path.length}`);
    const near = (a, b) => Math.abs(a - b) <= 20; // snap-to-grid moves points by up to 10 px
    if (!near(path[0].x, 200) || !near(path[0].y, 0) || !near(path[1].x, 200) || !near(path[1].y, 200)) throw new Error(`unexpected points ${JSON.stringify(path)}`);
    const drawnPoints = await evaluate(`document.querySelectorAll('.path-point').length`);
    expectEqual(drawnPoints, 3, 'path handles on the canvas');
  });

  await step('the timeline length and loop setting are saved', async () => {
    await typeInto('.tl-duration input', '30');
    await clickOn('.tl-transport .check input'); // leaves focus on the checkbox: Ctrl+S must still save
    expectEqual((await saved()).timeline, { duration: 30, loop: false }, 'timeline');
  });

  await step('playing advances the playhead', async () => {
    await clickOn('.tl-transport button.play');
    await sleep(700);
    await clickOn('.tl-transport button.play');
    const shown = await evaluate(`document.querySelector('.tl-time').textContent`);
    if (shown === '0:10.00') throw new Error('playhead did not move');
  });

  await step('no errors in the page console', async () => {
    if (errors.length) throw new Error(errors.join(' | '));
  });
} finally {
  await page.close();
}
console.log(failures === 0 ? 'All editor checks passed.' : `${failures} editor check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
