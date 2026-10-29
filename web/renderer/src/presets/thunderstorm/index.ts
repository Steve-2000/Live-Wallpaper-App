import { createAutoShaderPreset } from '../../runtime/canvas';
import type { PresetContext, PresetInstance } from '../../runtime/types';

const FRAGMENT = `
uniform vec2 u_res;
uniform float u_time;
uniform float u_seed;
uniform vec3 u_cloud;
uniform vec3 u_light;
uniform vec3 u_ground;
uniform float u_rain;
uniform float u_lightning;
uniform float u_wind;
uniform float u_flow;

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float t = u_time * u_flow;

  // Lightning comes in strike windows of 1.6 s; some windows have a strike, with a
  // flicker of 2-3 pulses, the bolt in a random place.
  float slot = floor(t / 1.6);
  float local = fract(t / 1.6) * 1.6;
  float strike = step(1.0 - u_lightning * 0.55, hash12(vec2(slot, u_seed)));
  float flicker = (exp(-local * 9.0) + 0.6 * exp(-abs(local - 0.18) * 30.0) + 0.4 * exp(-abs(local - 0.33) * 25.0)) * strike;
  float boltX = aspect * (0.15 + 0.7 * hash12(vec2(slot, 3.0 + u_seed)));

  // Churning cloud deck, lit from inside by the flash.
  float c = fbm(vec2(p.x * 1.3 + t * 0.03 * (1.0 + u_wind), p.y * 2.2 - t * 0.02) + u_seed);
  float c2 = fbm(vec2(p.x * 3.0 - t * 0.05, p.y * 4.0) + c * 1.5);
  vec3 sky = mix(u_cloud * 0.45, u_cloud * 2.8 + 0.04, smoothstep(0.15, 0.65, c * c2 * 1.4)) * (0.7 + 0.5 * uv.y);
  float nearBolt = exp(-abs(p.x - boltX) * 2.5);
  sky += u_light * flicker * (0.25 + 0.75 * nearBolt) * c2 * 0.9;
  vec3 col = sky;

  // The bolt: a jagged line from the clouds to the ground with a side branch.
  if (strike > 0.5 && local < 0.45) {
    float y = uv.y;
    float jag = (fbm(vec2(y * 9.0, slot)) - 0.5) * 0.18 + (vnoise(vec2(y * 40.0, slot)) - 0.5) * 0.03;
    float dx = abs(p.x - (boltX + jag));
    float main_ = smoothstep(0.004, 0.0, dx) + 0.4 * exp(-dx * 60.0);
    float branchY = 0.45 + 0.2 * hash12(vec2(slot, 7.0));
    float bx = boltX + jag + (branchY - y) * 0.6 * (hash12(vec2(slot, 8.0)) > 0.5 ? 1.0 : -1.0);
    float branch = y < branchY && y > branchY - 0.18 ? smoothstep(0.003, 0.0, abs(p.x - bx)) * 0.7 : 0.0;
    col += u_light * (main_ + branch) * step(0.12, y) * smoothstep(0.95, 0.75, y) * clamp(flicker * 1.5, 0.0, 1.0);
  }

  // Low hills silhouetted against the flash.
  float hill = 0.08 + 0.06 * fbm(vec2(p.x * 2.0 + u_seed, 2.0));
  if (uv.y < hill) col = u_ground + u_light * flicker * 0.06;

  // Slanted rain streaks in two depths.
  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    vec2 rp = vec2(p.x + p.y * u_wind * 0.35, p.y);
    vec2 g = vec2(rp.x * (90.0 + fi * 60.0), rp.y * (6.0 + fi * 3.0) + t * (12.0 + fi * 5.0));
    vec2 id = floor(g);
    float h = hash12(id + fi * 11.0);
    // A short streak at a random height inside each cell, so cell edges never show.
    float s = fract(g.y) - 0.15 - 0.6 * hash12(id + 5.0);
    float drop = step(1.0 - u_rain * 0.6, h) * smoothstep(0.35, 0.0, abs(fract(g.x) - 0.5)) * smoothstep(0.0, 0.03, s) * smoothstep(0.22, 0.0, s);
    col += vec3(0.55, 0.6, 0.7) * drop * (0.12 + fi * 0.08) * (1.0 + flicker);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

export function create(ctx: PresetContext): PresetInstance {
  return createAutoShaderPreset(ctx, FRAGMENT);
}
