import { describe, expect, it } from 'vitest';
import { listPresets } from '../src/runtime/registry';
import { resolveParams } from '../src/runtime/params';
import { parseLaunchOptions } from '../src/runtime/host';
import { formatClock } from '../src/presets/particle-clock/time';
import { handAngles } from '../src/presets/analog-clock/angles';
import { autoUniforms } from '../src/runtime/canvas';

describe('preset registry', () => {
  const presets = listPresets();

  it('discovers all presets (the spec asks for at least 20)', () => {
    expect(presets.length).toBeGreaterThanOrEqual(20);
    expect(new Set(presets.map((p) => p.id)).size).toBe(presets.length);
  });

  it('spreads presets over several categories', () => {
    const counts = new Map<string, number>();
    for (const p of presets) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    expect(counts.size).toBeGreaterThanOrEqual(8);
    for (const p of presets) expect(p.license).toMatch(/original/i);
  });

  it.each(presets.map((p) => [p.id, p]))('%s has a valid manifest', (_id, p) => {
    expect(p.name).toBeTruthy();
    expect(p.description).toBeTruthy();
    expect(['canvas2d', 'webgl', 'pixi', 'three']).toContain(p.renderer);
    expect(p.accent).toHaveLength(2);
    const keys = p.params.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    // Every default must already be valid under its own spec.
    const defaults = Object.fromEntries(p.params.map((s) => [s.key, s.default]));
    expect(resolveParams(p.params, defaults)).toEqual(defaults);
  });
});

describe('parseLaunchOptions', () => {
  it('reads preset, fps, speed, seed and params', () => {
    const o = parseLaunchOptions('?preset=aurora&fps=24&speed=2&seed=9&params=' + encodeURIComponent('{"flow":1.5}'));
    expect(o).toEqual({ preset: 'aurora', fps: 24, speed: 2, seed: 9, params: { flow: 1.5 } });
  });

  it('reads and clamps capture options', () => {
    expect(parseLaunchOptions('?preset=galaxy').capture).toBeUndefined();
    expect(parseLaunchOptions('?capture=1&width=2560&height=1440&at=3').capture).toEqual({ width: 2560, height: 1440, at: 3 });
    expect(parseLaunchOptions('?capture=1&width=5&height=99999&at=500').capture).toEqual({ width: 16, height: 16384, at: 60 });
  });

  it('plays only videos from the DreamCanvas video library', () => {
    const p = (file: string, fit?: string) => '&params=' + encodeURIComponent(JSON.stringify({ file, fit }));
    expect(parseLaunchOptions('?preset=video&video=abc123' + p('video.webm', 'contain')).video)
      .toEqual({ url: 'https://media.dreamcanvas.local/abc123/video.webm', fit: 'contain' });
    expect(parseLaunchOptions('?video=abc123' + p('video.mp4')).video?.fit).toBe('cover');
    expect(parseLaunchOptions('?video=../etc' + p('video.mp4')).video).toBeUndefined();
    expect(parseLaunchOptions('?video=abc' + p('../../secret.mp4')).video).toBeUndefined();
    expect(parseLaunchOptions('?video=abc' + p('video.exe')).video).toBeUndefined();
    expect(parseLaunchOptions('?preset=galaxy').video).toBeUndefined();
  });

  it('tolerates malformed input', () => {
    const o = parseLaunchOptions('?params=%7Bnope&speed=99');
    expect(o.params).toEqual({});
    expect(o.speed).toBe(4);
    expect(o.fps).toBe(30);
  });
});

describe('analog clock hands', () => {
  const turn = Math.PI * 2;
  it('points all hands at 12 at midnight and noon', () => {
    for (const hour of [0, 12]) {
      const a = handAngles(new Date(2026, 0, 5, hour, 0, 0, 0), true);
      expect([a.hour, a.minute, a.second]).toEqual([0, 0, 0]);
    }
  });
  it('places the hands for 3:30:15', () => {
    const a = handAngles(new Date(2026, 0, 5, 15, 30, 15, 500), false);
    expect(a.second).toBeCloseTo((15 / 60) * turn);
    expect(a.minute).toBeCloseTo((30.25 / 60) * turn);
    expect(a.hour).toBeCloseTo(((3 + 30.25 / 60) / 12) * turn);
  });
  it('sweeps the second hand between ticks only when asked', () => {
    const d = new Date(2026, 0, 5, 1, 2, 3, 500);
    expect(handAngles(d, true).second).toBeCloseTo((3.5 / 60) * turn);
    expect(handAngles(d, false).second).toBeCloseTo((3 / 60) * turn);
  });
});

describe('autoUniforms', () => {
  it('maps params to shader uniforms and keeps the seed offset small', () => {
    const u = autoUniforms({ speed: 1.5, glow: true, tint: '#ff0000', label: 'x' }, 123456789);
    expect(u.u_speed).toBe(1.5);
    expect(u.u_glow).toBe(1);
    expect(u.u_tint).toEqual([1, 0, 0]);
    expect(u.u_label).toBeUndefined();
    expect(u.u_seed).toBeGreaterThanOrEqual(0);
    expect(u.u_seed).toBeLessThan(8); // large offsets break noise precision (visible seams)
    expect(autoUniforms({}, 1).u_seed).not.toBe(autoUniforms({}, 2).u_seed);
  });
});

describe('formatClock', () => {
  const d = new Date(2026, 0, 5, 21, 4, 9);
  it('formats 24h with seconds', () => expect(formatClock(d, true, true)).toBe('21:04:09'));
  it('formats 12h without seconds', () => expect(formatClock(d, false, false)).toBe('9:04 PM'));
  it('formats midnight in 12h as 12', () => expect(formatClock(new Date(2026, 0, 5, 0, 7), false, false)).toBe('12:07 AM'));
});
