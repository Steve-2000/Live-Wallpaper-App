import { createAutoShaderPreset } from '../../runtime/canvas';
import type { PresetContext, PresetInstance } from '../../runtime/types';

const FRAGMENT = `
uniform vec2 u_res;
uniform float u_time;
uniform float u_seed;
uniform vec3 u_skyTop;
uniform vec3 u_skyBottom;
uniform vec3 u_snowColor;
uniform float u_amount;
uniform float u_flakeSize;
uniform float u_wind;
uniform float u_moon;
uniform float u_flow;

// One layer of falling flakes; nearer layers are bigger, faster and sharper.
float flakes(vec2 p, float scale, float speed, float t, float salt) {
  vec2 g = p * scale;
  g.y += t * speed;
  g.x += sin(g.y * 0.35 + t * 0.4 + salt) * 0.4 - u_wind * t * speed * 0.6;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float h = hash12(id + salt);
  if (h > u_amount) return 0.0;
  vec2 o = (vec2(hash12(id + 1.3 + salt), hash12(id + 2.9 + salt)) - 0.5) * 0.7;
  float r = (0.05 + 0.07 * hash12(id + 5.0)) * u_flakeSize;
  return smoothstep(r, r * 0.2, length(f - o));
}

float ridge(float x, float base, float height, float freq, float salt) {
  return base + height * fbm(vec2(x * freq + salt, salt));
}

// Snow-covered foreground: rounded drifts without small wiggles (which would shade as streaks).
float smoothHill(float x) {
  return 0.06 + 0.2 * vnoise(vec2(x * 1.3 + u_seed + 9.0, 1.0)) + 0.06 * vnoise(vec2(x * 3.1 + u_seed, 4.0));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float t = u_time * u_flow;

  vec3 col = mix(u_skyBottom, u_skyTop, smoothstep(0.2, 1.0, uv.y));
  vec2 moonPos = vec2(aspect * 0.78, 0.78);
  if (u_moon > 0.5) {
    float d = length(p - moonPos);
    col += vec3(1.0, 0.97, 0.9) * smoothstep(0.055, 0.05, d) + u_snowColor * 0.25 * exp(-d * 7.0);
  }

  // Far hills with a row of small pines.
  float far = ridge(p.x, 0.22, 0.32, 1.1, u_seed);
  if (uv.y < far) col = mix(u_skyBottom, u_snowColor, 0.45) * 0.8;
  float cellW = 0.035;
  float cx = floor(p.x / cellW);
  float th = hash12(vec2(cx, u_seed + 3.0));
  if (th > 0.35) {
    float base = ridge((cx + 0.5) * cellW, 0.22, 0.32, 1.1, u_seed) - 0.01;
    float hgt = 0.04 + 0.05 * th;
    float local = (p.y - base) / hgt;
    float half_ = (1.0 - local) * cellW * 0.42;
    if (local > 0.0 && local < 1.0 && abs(p.x - (cx + 0.5) * cellW) < half_) col = mix(u_skyTop, vec3(0.05, 0.08, 0.12), 0.6);
  }

  // Near hills: snow lit by the moon on one side, blue shadow on the other.
  float near = smoothHill(p.x);
  if (uv.y < near) {
    // Shade by slope, so faces turned to the moon are bright.
    float slope = (smoothHill(p.x + 0.03) - smoothHill(p.x - 0.03)) / 0.06;
    float lit = clamp(0.6 + slope * 1.5, 0.2, 1.0);
    float depth = clamp((near - uv.y) / 0.15, 0.0, 1.0);
    col = mix(vec3(0.38, 0.48, 0.7), u_snowColor, lit) * (1.0 - 0.15 * depth);
  }

  float s = flakes(p, 7.0, 0.35, t, u_seed) * 0.45
          + flakes(p, 4.5, 0.6, t, u_seed + 17.0) * 0.75
          + flakes(p, 2.6, 0.9, t, u_seed + 41.0);
  col = mix(col, u_snowColor, clamp(s, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

export function create(ctx: PresetContext): PresetInstance {
  return createAutoShaderPreset(ctx, FRAGMENT);
}
