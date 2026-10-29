import { createAutoShaderPreset } from '../../runtime/canvas';
import type { PresetContext, PresetInstance } from '../../runtime/types';

const FRAGMENT = `
uniform vec2 u_res;
uniform float u_time;
uniform float u_seed;
uniform vec3 u_colorA;
uniform vec3 u_colorB;
uniform vec3 u_space;
uniform float u_density;
uniform float u_detail;
uniform float u_stars;
uniform float u_flow;

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = vec2(uv.x * u_res.x / u_res.y, uv.y) * 1.6 + u_seed;
  float t = u_time * u_flow * 0.03;

  // Domain warping: noise displaced by noise gives billowing, swirling gas.
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(p + u_detail * q + vec2(1.7, 9.2) + t * 0.6), fbm(p + u_detail * q + vec2(8.3, 2.8)));
  float n = fbm(p + u_detail * r);

  vec3 col = u_space;
  col = mix(col, u_colorB * 0.9, smoothstep(0.3, 0.8, n) * u_density * 0.9);
  col = mix(col, u_colorA, smoothstep(0.45, 0.95, length(q) * n) * u_density);
  col += (u_colorA + u_colorB) * 0.35 * pow(clamp(n, 0.0, 1.0), 5.0) * u_density;
  // Dark dust lanes.
  col *= 1.0 - 0.55 * smoothstep(0.55, 0.85, fbm(p * 1.8 + r * 1.5 + 4.0)) * u_density;

  // Stars: many faint ones, a few bright ones with a small cross flare.
  vec2 g = gl_FragCoord.xy / 3.0;
  vec2 id = floor(g);
  float h = hash12(id + u_seed);
  if (h > 1.0 - u_stars * 0.02) {
    float tw = 0.7 + 0.3 * sin(u_time * (0.8 + h * 2.0) + h * 70.0);
    col += vec3(0.9, 0.92, 1.0) * smoothstep(0.7, 0.0, length(fract(g) - 0.5)) * tw;
  }
  vec2 g2 = gl_FragCoord.xy / 90.0;
  vec2 id2 = floor(g2);
  if (hash12(id2 + u_seed + 3.0) > 1.0 - u_stars * 0.12) {
    vec2 d = (fract(g2) - 0.5 - (vec2(hash12(id2 + 1.0), hash12(id2 + 2.0)) - 0.5) * 0.6) * 90.0;
    float core = exp(-dot(d, d) * 0.15);
    float flare = exp(-abs(d.x) * 1.5) * exp(-abs(d.y) * 0.12) + exp(-abs(d.y) * 1.5) * exp(-abs(d.x) * 0.12);
    col += vec3(1.0, 0.95, 0.9) * (core + flare * 0.25) * (0.8 + 0.2 * sin(u_time + id2.x));
  }

  col = 1.0 - exp(-col * 1.4);
  gl_FragColor = vec4(col, 1.0);
}
`;

export function create(ctx: PresetContext): PresetInstance {
  return createAutoShaderPreset(ctx, FRAGMENT);
}
