import { createAutoShaderPreset } from '../../runtime/canvas';
import type { PresetContext, PresetInstance } from '../../runtime/types';

const FRAGMENT = `
uniform vec2 u_res;
uniform float u_time;
uniform float u_seed;
uniform vec3 u_background;
uniform vec3 u_starColor;
uniform vec3 u_nebula;
uniform float u_density;
uniform float u_streaks;
uniform float u_nebulaAmount;
uniform float u_flow;

const int LAYERS = 6;

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;   // centred, height = 1
  float t = u_time * u_flow * 0.12;

  vec3 col = u_background;
  col += u_nebula * u_nebulaAmount * 0.35 * smoothstep(0.35, 0.9, fbm(p * 2.2 + vec2(u_seed, t * 0.3)));

  vec2 dir = normalize(p + vec2(0.0001));
  for (int i = 0; i < LAYERS; i++) {
    float fi = float(i);
    // Each layer zooms in over time; when it gets too close it starts again far away.
    float depth = fract(t + fi / float(LAYERS));
    float scale = mix(22.0, 0.8, depth);
    float fade = smoothstep(0.0, 0.3, depth) * smoothstep(1.0, 0.85, depth);
    vec2 g = p * scale + vec2(fi * 17.3 + u_seed, fi * 9.1);
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = hash12(id + fi);
    if (h < u_density) {
      vec2 o = (vec2(hash12(id + 2.1), hash12(id + 7.3)) - 0.5) * 0.3;
      vec2 d = f - o;
      // Stretch each star along the line from the centre: a light trail. Trails are capped so
      // they stay inside their cell (longer ones would be cut off at the cell edge).
      float along = dot(d, dir);
      float across = dot(d, vec2(-dir.y, dir.x));
      float len = 1.0 + min(u_streaks * depth * 9.0 * min(u_flow, 2.0), 5.0);
      float s = exp(-across * across * 900.0) * exp(-along * along * 900.0 / (len * len));
      vec3 tint = mix(u_starColor, u_nebula + 0.4, hash12(id + 4.4) * 0.35);
      col += tint * s * fade * (0.6 + h);
    }
  }
  col *= 1.0 - 0.25 * length(uv - 0.5);
  gl_FragColor = vec4(col, 1.0);
}
`;

export function create(ctx: PresetContext): PresetInstance {
  return createAutoShaderPreset(ctx, FRAGMENT);
}
