import { createAutoShaderPreset } from '../../runtime/canvas';
import type { PresetContext, PresetInstance } from '../../runtime/types';

const FRAGMENT = `
uniform vec2 u_res;
uniform float u_time;
uniform float u_seed;
uniform vec3 u_tint;
uniform vec3 u_lightA;
uniform vec3 u_lightB;
uniform float u_rain;
uniform float u_dropSize;
uniform float u_lights;
uniform float u_flow;

// The blurred city behind the glass: layers of soft round lights.
vec3 city(vec2 p) {
  vec3 col = u_tint * (0.35 + 0.9 * p.y);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 g = p * (3.0 + fi * 2.5) + vec2(fi * 7.3 + u_seed, fi * 3.1);
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = hash12(id + fi * 13.0);
    vec2 o = vec2(hash12(id + 1.7), hash12(id + 4.1)) - 0.5;
    float r = 0.16 + 0.14 * hash12(id + 2.2);
    float on = step(0.4, h) * smoothstep(0.75, 0.15, p.y) * (0.75 + 0.25 * sin(u_time * 0.4 + h * 30.0));
    float b = smoothstep(r, r * 0.55, length(f - o * 0.6)) * on;
    vec3 lc = mix(u_lightA, u_lightB, step(0.68, hash12(id + 9.0)));
    col += lc * b * (0.55 - fi * 0.13) * u_lights;
  }
  return col;
}

// Still beads that slowly appear and evaporate. Returns (normal.xy, mask).
vec3 beads(vec2 p, float t) {
  vec2 g = p * 13.0;
  vec2 id = floor(g);
  vec2 f = fract(g);
  float h = hash12(id + u_seed);
  vec2 c = 0.3 + 0.4 * vec2(hash12(id + 3.3), hash12(id + 5.1));
  float r = (0.08 + 0.16 * hash12(id + 8.2)) * u_dropSize;
  float life = fract(t * 0.04 + h * 7.0);
  float on = step(1.0 - u_rain * 0.8, h) * smoothstep(0.0, 0.1, life) * smoothstep(1.0, 0.75, life);
  vec2 d = f - c;
  float m = smoothstep(r, r * 0.75, length(d)) * on;
  return vec3(d / max(r, 0.001) * m, m);
}

// Drops running down the glass, leaving a trail of tiny beads. Returns (normal.xy, mask).
vec3 runners(vec2 p, float t) {
  const float cols = 11.0;
  float x = p.x * cols;
  float id = floor(x);
  float h = hash12(vec2(id, 1.0 + u_seed));
  if (h > u_rain) return vec3(0.0);
  float speed = 0.08 + 0.18 * hash12(vec2(id, 2.0));
  // Stick-slip motion: runs, pauses, runs.
  float phase = t * speed + h * 10.0;
  float y = 1.15 - fract(phase + 0.15 * sin(phase * 6.2831)) * 1.3;
  float wob = 0.18 * sin(p.y * 9.0 + h * 6.0);
  float fx = (fract(x) - 0.5 - wob) / cols;
  float r = 0.026 * u_dropSize;
  vec2 d = vec2(fx, (p.y - y) * 0.75);
  float head = smoothstep(r, r * 0.7, length(d));
  float above = p.y - y;
  float cell = (fract(p.y * 38.0) - 0.5) / 38.0;
  float trail = smoothstep(r * 0.45, r * 0.25, length(vec2(fx, cell))) * step(0.0, above) * smoothstep(0.35, 0.0, above)
              * step(0.5, hash12(vec2(id, floor(p.y * 38.0))));
  float m = max(head, trail);
  vec2 n = head > trail ? d / r : vec2(fx, cell) / (r * 0.45);
  return vec3(n * m, m);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = vec2(uv.x * u_res.x / u_res.y, uv.y);
  float t = u_time * u_flow;

  vec3 a = beads(p, t);
  vec3 b = runners(p, t);
  vec3 drop = a.z > b.z ? a : b;

  vec3 col = city(p) * 0.85;
  if (drop.z > 0.0) {
    // A drop acts as a small lens: it shows a sharper, flipped, brighter view of the city.
    vec2 n = drop.xy / max(drop.z, 0.001);
    vec3 seen = city(p - n * 0.12) * 1.4 + 0.04;
    float rim = smoothstep(0.55, 1.0, length(n));
    seen = mix(seen, u_tint * 0.25, rim * 0.7);
    // Small specular glint on the upper side of each drop.
    seen += vec3(0.55) * smoothstep(0.35, 0.0, length(n - vec2(-0.3, 0.35)));
    col = mix(col, seen, drop.z);
  }
  // Condensation haze and a soft vignette.
  col += vec3(0.02, 0.025, 0.03) * fbm(p * 3.0 + u_seed);
  col *= 1.0 - 0.35 * length(uv - 0.5);
  gl_FragColor = vec4(col, 1.0);
}
`;

export function create(ctx: PresetContext): PresetInstance {
  return createAutoShaderPreset(ctx, FRAGMENT);
}
