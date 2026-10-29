import { createAutoShaderPreset } from '../../runtime/canvas';
import type { PresetContext, PresetInstance } from '../../runtime/types';

const FRAGMENT = `
uniform vec2 u_res;
uniform float u_time;
uniform float u_seed;
uniform vec3 u_colorA;
uniform vec3 u_colorB;
uniform vec3 u_background;
uniform float u_blobs;
uniform float u_size;
uniform float u_glow;
uniform float u_flow;

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float t = u_time * u_flow;

  // Metaballs: each blob adds r^2/d^2; the surface is where the sum reaches 1.
  float field = 0.0;
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    if (fi >= u_blobs) break;
    float h1 = hash12(vec2(fi, 1.0 + u_seed));
    float h2 = hash12(vec2(fi, 2.0 + u_seed));
    float h3 = hash12(vec2(fi, 3.0 + u_seed));
    // Blobs wander sideways a little and travel the full height, so they meet and merge.
    vec2 c = vec2(
      aspect * (0.5 + 0.22 * sin(t * (0.09 + 0.07 * h1) + h2 * 6.2831) + 0.12 * (h1 - 0.5)),
      0.5 + 0.55 * sin(t * (0.08 + 0.07 * h2) + h3 * 6.2831));
    float r = (0.09 + 0.08 * h3) * u_size;
    vec2 d = p - c;
    field += r * r / max(dot(d, d), 0.00001);
  }

  vec3 col = u_background * (0.55 + 0.8 * uv.y);
  float body = smoothstep(0.95, 1.05, field);
  vec3 wax = mix(u_colorA, u_colorB, clamp((field - 1.0) * 0.35, 0.0, 1.0));
  col += u_colorA * smoothstep(0.25, 1.0, field) * (1.0 - body) * 0.45 * u_glow; // halo in the liquid
  col = mix(col, wax, body);
  // A soft highlight down the middle, as if the lamp glass were curved.
  col += vec3(0.08) * exp(-pow((uv.x - 0.5) * 3.0, 2.0)) * body;
  col *= 1.0 - 0.3 * pow(abs(uv.x - 0.5) * 2.0, 2.0);
  gl_FragColor = vec4(col, 1.0);
}
`;

export function create(ctx: PresetContext): PresetInstance {
  return createAutoShaderPreset(ctx, FRAGMENT);
}
