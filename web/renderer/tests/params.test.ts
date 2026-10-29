import { describe, expect, it } from 'vitest';
import { coerceParam, createRandom, randomizeParams, resolveParams } from '../src/runtime/params';
import type { ParamSpec } from '../src/runtime/types';

const specs: ParamSpec[] = [
  { key: 'count', label: 'Count', type: 'range', min: 10, max: 100, step: 5, default: 50 },
  { key: 'tint', label: 'Tint', type: 'color', default: '#112233' },
  { key: 'on', label: 'On', type: 'bool', default: true },
  { key: 'mode', label: 'Mode', type: 'select', options: ['a', 'b'], default: 'a' },
];

describe('resolveParams', () => {
  it('uses defaults when there are no overrides', () => {
    expect(resolveParams(specs)).toEqual({ count: 50, tint: '#112233', on: true, mode: 'a' });
  });

  it('clamps and snaps numeric overrides', () => {
    expect(resolveParams(specs, { count: 1000 }).count).toBe(100);
    expect(resolveParams(specs, { count: -4 }).count).toBe(10);
    expect(resolveParams(specs, { count: 33 }).count).toBe(35);
    expect(resolveParams(specs, { count: '62' }).count).toBe(60);
  });

  it('rejects invalid values and drops unknown keys', () => {
    const r = resolveParams(specs, { count: 'abc', tint: 'red', on: 'maybe', mode: 'z', extra: 1 });
    expect(r).toEqual({ count: 50, tint: '#112233', on: true, mode: 'a' });
  });

  it('normalises colours to lower case', () => {
    expect(coerceParam(specs[1], '#AABBCC')).toBe('#aabbcc');
  });
});

describe('randomizeParams', () => {
  it('stays within every spec and is deterministic for a seed', () => {
    const a = randomizeParams(specs, createRandom(7));
    const b = randomizeParams(specs, createRandom(7));
    expect(a).toEqual(b);
    expect(resolveParams(specs, a)).toEqual(a);
  });

  it('produces different variations for different seeds', () => {
    const a = randomizeParams(specs, createRandom(1));
    const b = randomizeParams(specs, createRandom(2));
    expect(a).not.toEqual(b);
  });
});

describe('createRandom', () => {
  it('returns values in [0, 1)', () => {
    const r = createRandom(42);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
