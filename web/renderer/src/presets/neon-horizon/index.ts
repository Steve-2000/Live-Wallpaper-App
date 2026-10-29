import { createAutoShaderPreset } from '../../runtime/canvas';
import type { PresetContext, PresetInstance } from '../../runtime/types';

const FRAGMENT = `
uniform vec2 u_res;
uniform float u_time;
uniform float u_seed;
uniform vec3 u_skyTop;
uniform vec3 u_skyGlow;
uniform vec3 u_grid;
uniform vec3 u_sunTop;
uniform vec3 u_sunBottom;
uniform float u_mountains;
uniform float u_stars;
uniform float u_flow;

const float HORIZON = 0.4;

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y);
  float t = u_time * u_flow;
  vec3 col;

  if (uv.y >= HORIZON) {
    float h = (uv.y - HORIZON) / (1.0 - HORIZON);
    col = mix(u_skyGlow * 0.9, u_skyTop, pow(h, 0.45));

    // Stars in the upper sky.
    vec2 g = p * 140.0;
    vec2 id = floor(g);
    float sh = hash12(id + u_seed);
    if (sh > 1.0 - u_stars * 0.04) {
      float tw = 0.6 + 0.4 * sin(u_time * (1.0 + sh * 3.0) + sh * 50.0);
      col += vec3(0.9, 0.85, 1.0) * smoothstep(0.35, 0.0, length(fract(g) - 0.5)) * tw * smoothstep(0.2, 0.6, h);
    }

    // Sun with horizontal cut-outs that thicken towards its base.
    vec2 sp = p - vec2(0.0, HORIZON + 0.2);
    float r = length(sp);
    if (r < 0.24) {
      float v = clamp((sp.y + 0.24) / 0.48, 0.0, 1.0);
      float stripe = step(0.5 - 0.45 * (1.0 - v) * (1.0 - v), fract(v * 9.0 - t * 0.15));
      if (v > 0.55 || stripe > 0.5) col = mix(u_sunBottom, u_sunTop, v);
    }
    col += u_sunBottom * 0.35 * exp(-max(r - 0.24, 0.0) * 9.0);

    if (u_mountains > 0.5) {
      float m = HORIZON + 0.12 * pow(fbm(vec2(p.x * 1.6 + u_seed, 1.0)), 1.6) + 0.02 * fbm(vec2(p.x * 9.0, 2.0));
      // Leave a valley in the middle so the sun stays visible.
      m = mix(HORIZON + 0.005, m, smoothstep(0.12, 0.45, abs(p.x)));
      if (uv.y < m) col = mix(u_skyTop * 0.4, u_skyGlow * 0.15, (m - uv.y) * 6.0);
      col += u_grid * smoothstep(0.004, 0.0, abs(uv.y - m)) * 0.9 * smoothstep(0.12, 0.45, abs(p.x));
    }
  } else {
    // Perspective floor grid scrolling towards the viewer.
    float depth = HORIZON - uv.y;
    float z = 0.35 / depth;
    vec2 gp = vec2(p.x * z * 2.0, z + t);
    vec2 d = abs(fract(gp) - 0.5);
    float w = 0.012 * z + 0.004;          // keeps lines a similar width on screen
    float line = smoothstep(0.5 - w, 0.5, max(d.x, d.y));
    float fade = exp(-z * 0.12);
    col = mix(u_skyTop * 0.25, u_skyGlow * 0.12, fade);
    col += u_grid * line * fade * 1.4;
    col += u_skyGlow * exp(-depth * 30.0) * 0.6; // glow where the floor meets the sky
  }

  col = 1.0 - exp(-col * 1.3);
  gl_FragColor = vec4(col, 1.0);
}
`;

export function create(ctx: PresetContext): PresetInstance {
  return createAutoShaderPreset(ctx, FRAGMENT);
}
