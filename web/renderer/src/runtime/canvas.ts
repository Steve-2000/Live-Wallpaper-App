import { hexToRgb } from './params';
import type { PresetContext, PresetInstance, ParamValues } from './types';

export function createCanvas(host: HTMLElement, width: number, height: number, dpr: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  sizeCanvas(canvas, width, height, dpr);
  host.appendChild(canvas);
  return canvas;
}

/** CSS colour from a #rrggbb param plus alpha. */
export function rgba(hex: unknown, alpha = 1): string {
  const [r, g, b] = hexToRgb(typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#ffffff').map((v) => Math.round(v * 255));
  return `rgba(${r},${g},${b},${alpha})`;
}

export function sizeCanvas(canvas: HTMLCanvasElement, width: number, height: number, scale: number): void {
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
}

// ---------------------------------------------------------------------------
// Full-screen fragment shader presets
// ---------------------------------------------------------------------------

const VERTEX = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

/** Shared GLSL helpers prepended to every fragment shader. */
export const GLSL_NOISE = `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return v;
}
`;

export type UniformValue = number | [number, number] | [number, number, number];

export interface ShaderPresetOptions {
  fragment: string;
  /** Maps preset params to uniform values; called on create and on every param change. */
  uniforms: (params: ParamValues) => Record<string, UniformValue>;
  /** Param key holding the internal resolution scale (0.25-1), used to save GPU time. */
  qualityKey?: string;
}

/**
 * Uniforms named after the preset's params: `u_<key>`. Colours become vec3, numbers floats and
 * booleans 0/1 (select params need explicit mapping). `u_seed` varies the layout per seed.
 */
export function autoUniforms(params: ParamValues, seed: number): Record<string, UniformValue> {
  // Kept small (0..8): large offsets push noise coordinates out of float precision and leave seams.
  const out: Record<string, UniformValue> = { u_seed: ((seed * 0.6180339887) % 1) * 8 };
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'number') out[`u_${key}`] = value;
    else if (typeof value === 'boolean') out[`u_${key}`] = value ? 1 : 0;
    else if (/^#[0-9a-fA-F]{6}$/.test(value)) out[`u_${key}`] = hexToRgb(value);
  }
  return out;
}

/** A full-screen shader preset whose params map straight to uniforms (see autoUniforms). */
export function createAutoShaderPreset(ctx: PresetContext, fragment: string): PresetInstance {
  return createShaderPreset(ctx.host, ctx.width, ctx.height, ctx.dpr, ctx.params, {
    fragment,
    qualityKey: 'quality',
    uniforms: (p) => autoUniforms(p, ctx.seed),
  });
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return shader;
}

export function createShaderPreset(
  host: HTMLElement,
  width: number,
  height: number,
  dpr: number,
  params: ParamValues,
  options: ShaderPresetOptions,
): PresetInstance {
  const quality = () => (options.qualityKey ? Number(params[options.qualityKey]) || 1 : 1);
  const canvas = createCanvas(host, width, height, dpr * quality());
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
  if (!gl) throw new Error('WebGL is not available on this device.');

  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, `precision highp float;\n${GLSL_NOISE}\n${options.fragment}`));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Shader link failed: ${gl.getProgramInfoLog(program)}`);
  }
  gl.useProgram(program);

  // One oversized triangle covers the whole viewport.
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const locations = new Map<string, WebGLUniformLocation | null>();
  const loc = (name: string) => {
    if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name));
    return locations.get(name)!;
  };

  const applyUniforms = () => {
    for (const [name, value] of Object.entries(options.uniforms(params))) {
      const l = loc(name);
      if (!l) continue;
      if (typeof value === 'number') gl.uniform1f(l, value);
      else if (value.length === 2) gl.uniform2f(l, value[0], value[1]);
      else gl.uniform3f(l, value[0], value[1], value[2]);
    }
  };
  applyUniforms();

  let cssW = width;
  let cssH = height;
  let ratio = dpr;

  return {
    update(_dt, time) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(loc('u_res'), canvas.width, canvas.height);
      gl.uniform1f(loc('u_time'), time);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    resize(w, h, d) {
      cssW = w;
      cssH = h;
      ratio = d;
      sizeCanvas(canvas, w, h, d * quality());
    },
    setParams(next) {
      const qualityChanged = options.qualityKey && next[options.qualityKey] !== params[options.qualityKey];
      params = next;
      if (qualityChanged) sizeCanvas(canvas, cssW, cssH, ratio * quality());
      applyUniforms();
    },
    dispose() {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.remove();
    },
  };
}
