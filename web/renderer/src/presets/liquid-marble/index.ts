import { createAutoShaderPreset } from '../../runtime/canvas';
import type { PresetContext, PresetInstance } from '../../runtime/types';

const FRAGMENT = `
uniform vec2 u_res;
uniform float u_time;
uniform float u_seed;
uniform vec3 u_colorA;
uniform vec3 u_colorB;
uniform vec3 u_vein;
uniform float u_scale;
uniform float u_swirl;
uniform float u_veins;
uniform float u_flow;

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = vec2(uv.x * u_res.x / u_res.y, uv.y) * u_scale * 2.0 + u_seed;
  float t = u_time * u_flow * 0.06;

  // Repeated domain warping folds the pattern like marbled ink.
  vec2 q = p;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    q += u_swirl * 0.5 * vec2(fbm(q + vec2(t, fi * 3.1)), fbm(q.yx + vec2(fi * 1.7, -t)));
  }
  float n = fbm(q * 0.6);

  vec3 col = mix(u_colorA, u_colorB, smoothstep(0.25, 0.85, n));
  col = mix(col, u_colorA * 0.6, smoothstep(0.55, 0.9, fbm(q * 1.4 + 5.0)) * 0.5);
  // Thin bright veins along contour lines of the folded field, with a soft sheen.
  float v = pow(1.0 - abs(sin(n * 14.0)), 18.0);
  col += u_vein * v * u_veins;
  col += vec3(0.06) * pow(max(0.0, 1.0 - length(uv - vec2(0.3, 0.75)) * 1.6), 2.0);
  gl_FragColor = vec4(col, 1.0);
}
`;

export function create(ctx: PresetContext): PresetInstance {
  return createAutoShaderPreset(ctx, FRAGMENT);
}
