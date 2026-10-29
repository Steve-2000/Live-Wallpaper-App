import { createShaderPreset } from '../../runtime/canvas';
import { hexToRgb } from '../../runtime/params';
import type { PresetContext, PresetInstance } from '../../runtime/types';

const FRAGMENT = `
uniform vec2 u_res;
uniform float u_time;
uniform vec3 u_a;
uniform vec3 u_b;
uniform vec3 u_c;
uniform float u_waves;
uniform float u_amp;
uniform float u_flow;
uniform float u_glow;

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  float t = u_time * u_flow;

  vec3 col = mix(u_a * 0.6, u_a, uv.y);
  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    if (fi >= u_waves) break;
    float k = fi / max(u_waves - 1.0, 1.0);
    float base = 0.15 + k * 0.7;
    float x = uv.x * aspect;
    float y = base
      + sin(x * (1.2 + k * 0.8) + t * (0.6 + k * 0.3) + fi * 1.7) * u_amp
      + (fbm(vec2(x * 0.8 + fi * 3.0, t * 0.2)) - 0.5) * u_amp * 1.4;
    // Alternate between the two accent colours so neither drowns out the other.
    vec3 tint = mix(u_b, u_c, mod(fi, 2.0) * 0.8 + k * 0.2);
    float body = smoothstep(y + 0.002, y - 0.002, uv.y);
    float edge = exp(-abs(uv.y - y) * 60.0) * u_glow;
    col = mix(col, tint * (0.35 + 0.4 * (1.0 - k)), body * 0.32);
    col += tint * edge * 0.6;
  }
  // Soft vignette
  vec2 q = uv - 0.5;
  col *= 1.0 - dot(q, q) * 0.7;
  gl_FragColor = vec4(col, 1.0);
}
`;

export function create(ctx: PresetContext): PresetInstance {
  return createShaderPreset(ctx.host, ctx.width, ctx.height, ctx.dpr, ctx.params, {
    fragment: FRAGMENT,
    qualityKey: 'quality',
    uniforms: (p) => ({
      u_a: hexToRgb(String(p.colorA)),
      u_b: hexToRgb(String(p.colorB)),
      u_c: hexToRgb(String(p.colorC)),
      u_waves: Number(p.waves),
      u_amp: Number(p.amplitude),
      u_flow: Number(p.flow),
      u_glow: Number(p.glow),
    }),
  });
}
