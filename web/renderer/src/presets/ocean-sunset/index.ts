import { createAutoShaderPreset } from '../../runtime/canvas';
import type { PresetContext, PresetInstance } from '../../runtime/types';

const FRAGMENT = `
uniform vec2 u_res;
uniform float u_time;
uniform float u_seed;
uniform vec3 u_skyTop;
uniform vec3 u_horizon;
uniform vec3 u_sun;
uniform vec3 u_sea;
uniform float u_sunHeight;
uniform float u_waves;
uniform float u_clouds;
uniform float u_flow;

const float HORIZON = 0.42;

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y);
  float t = u_time * u_flow;
  vec2 sunPos = vec2(0.0, HORIZON + u_sunHeight * 0.5);
  vec3 col;

  if (uv.y >= HORIZON) {
    float h = (uv.y - HORIZON) / (1.0 - HORIZON);
    col = mix(u_horizon, u_skyTop, pow(h, 0.55));
    float d = length(p - sunPos);
    col += u_sun * (smoothstep(0.075, 0.068, d) + 0.45 * exp(-d * 5.0));
    // Long thin cloud bands, lit from below near the horizon.
    float c = fbm(vec2(p.x * 1.3 + t * 0.015 + u_seed, h * 7.0 + u_seed));
    float band = smoothstep(0.45, 0.7, c) * smoothstep(0.02, 0.15, h) * smoothstep(0.95, 0.35, h);
    vec3 cloudCol = mix(u_skyTop * 0.7, u_horizon * 1.15 + u_sun * 0.25, pow(1.0 - h, 2.0));
    col = mix(col, cloudCol, band * u_clouds);
  } else {
    float depth = (HORIZON - uv.y) / HORIZON;   // 0 at the horizon, 1 at the bottom
    float z = 1.0 / (depth + 0.04);              // perspective: distance into the sea
    vec2 wp = vec2(p.x * z * 0.5, z);
    float w = vnoise(wp * vec2(2.0, 0.6) * u_waves + vec2(u_seed, t * 0.5))
            + 0.5 * vnoise(wp * vec2(5.0, 1.5) * u_waves - vec2(t * 0.3, t * 0.9));
    col = mix(u_sea, mix(u_horizon, u_skyTop, 0.35) * 0.55, 0.45 * (1.0 - depth));
    col *= 0.75 + 0.35 * w;
    // The sun's light path widens towards the viewer and sparkles on wave crests.
    float path = exp(-abs(p.x - sunPos.x) * 6.0 / (0.25 + depth));
    float ripple = vnoise(wp * vec2(16.0, 4.5) * u_waves + vec2(t * 1.3, -t * 2.2));
    float sparkle = smoothstep(0.62, 0.9, ripple * 0.65 + w * 0.3);
    col += u_sun * path * (0.12 + sparkle * 0.9) * (1.0 - depth * 0.6) * smoothstep(-0.2, 0.3, u_sunHeight);
    col = mix(col, u_horizon * 0.85, exp(-depth * 30.0) * 0.65); // haze at the horizon
  }

  col = 1.0 - exp(-col * 1.25);
  gl_FragColor = vec4(col, 1.0);
}
`;

export function create(ctx: PresetContext): PresetInstance {
  return createAutoShaderPreset(ctx, FRAGMENT);
}
