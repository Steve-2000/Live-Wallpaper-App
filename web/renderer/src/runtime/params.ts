import type { ParamSpec, ParamValue, ParamValues } from './types';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function snap(v: number, min: number, step: number): number {
  if (step <= 0) return v;
  const snapped = Math.round((v - min) / step) * step + min;
  // Strip floating point noise such as 0.30000000000000004.
  return Number(snapped.toFixed(6));
}

/** Validates a single value against its spec, falling back to the default. */
export function coerceParam(spec: ParamSpec, raw: unknown): ParamValue {
  switch (spec.type) {
    case 'range': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
      if (!Number.isFinite(n)) return spec.default;
      return snap(clamp(n, spec.min, spec.max), spec.min, spec.step);
    }
    case 'color':
      return typeof raw === 'string' && HEX_COLOR.test(raw) ? raw.toLowerCase() : spec.default;
    case 'bool':
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true' || raw === 1) return true;
      if (raw === 'false' || raw === 0) return false;
      return spec.default;
    case 'select':
      return typeof raw === 'string' && spec.options.includes(raw) ? raw : spec.default;
    case 'text':
      return typeof raw === 'string' ? raw.slice(0, spec.maxLength ?? 200) : spec.default;
  }
}

/** Merges user overrides over the defaults; unknown keys are dropped. */
export function resolveParams(specs: ParamSpec[], overrides: Record<string, unknown> = {}): ParamValues {
  const out: ParamValues = {};
  for (const spec of specs) {
    out[spec.key] = spec.key in overrides ? coerceParam(spec, overrides[spec.key]) : spec.default;
  }
  return out;
}

function randomColor(random: () => number): string {
  // Random hue with pleasant saturation/lightness rather than raw RGB noise.
  const h = random() * 360;
  const s = 0.55 + random() * 0.4;
  const l = 0.45 + random() * 0.2;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

/** Produces a new variation of every parameter (the "Randomize" button). */
export function randomizeParams(specs: ParamSpec[], random: () => number): ParamValues {
  const out: ParamValues = {};
  for (const spec of specs) {
    switch (spec.type) {
      case 'range':
        out[spec.key] = coerceParam(spec, spec.min + random() * (spec.max - spec.min));
        break;
      case 'color':
        out[spec.key] = randomColor(random);
        break;
      case 'bool':
        out[spec.key] = random() < 0.5;
        break;
      case 'select':
        out[spec.key] = spec.options[Math.floor(random() * spec.options.length)];
        break;
      case 'text':
        out[spec.key] = spec.default; // free text isn't randomised
        break;
    }
  }
  return out;
}

/** Mulberry32: small, fast, deterministic PRNG. */
export function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}
