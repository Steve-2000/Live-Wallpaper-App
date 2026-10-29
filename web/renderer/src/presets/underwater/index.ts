import { createAutoShaderPreset } from '../../runtime/canvas';
import type { PresetContext, PresetInstance } from '../../runtime/types';

const FRAGMENT = `
uniform vec2 u_res;
uniform float u_time;
uniform float u_seed;
uniform vec3 u_deep;
uniform vec3 u_shallow;
uniform vec3 u_light;
uniform vec3 u_sand;
uniform float u_caustics;
uniform float u_rays;
uniform float u_bubbles;
uniform float u_flow;

// Distance between the nearest and second-nearest moving cell points: thin bright lines
// where they're nearly equal, which looks like light focused by a rippling surface.
float caustic(vec2 x, float t) {
  vec2 n = floor(x);
  vec2 f = fract(x);
  float m1 = 8.0;
  float m2 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = vec2(hash12(n + g + u_seed), hash12(n + g + 19.1));
      o = 0.5 + 0.45 * sin(t + 6.2831 * o);
      float d = length(g + o - f);
      if (d < m1) { m2 = m1; m1 = d; } else if (d < m2) { m2 = d; }
    }
  }
  return pow(smoothstep(0.1, 0.0, m2 - m1), 2.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = vec2(uv.x * u_res.x / u_res.y, uv.y);
  float t = u_time * u_flow;

  vec3 col = mix(u_deep, u_shallow, pow(uv.y, 1.4));

  // Slanted sunbeams, brightest near the surface.
  float x = p.x + (1.0 - uv.y) * 0.35;
  float beams = pow(0.5 + 0.5 * sin(x * 9.0 + fbm(vec2(x * 2.0, t * 0.1)) * 4.0 + t * 0.2), 8.0)
              + 0.6 * pow(0.5 + 0.5 * sin(x * 4.3 - t * 0.13 + 2.0), 10.0);
  col += u_light * beams * u_rays * 0.35 * smoothstep(0.0, 1.0, uv.y);

  // Surface shimmer at the top.
  col += u_light * caustic(vec2(p.x * 6.0, (1.0 - uv.y) * 20.0), t * 0.8) * smoothstep(0.88, 1.0, uv.y) * 0.5;

  // Sandy floor with dancing light.
  float floorY = 0.16 + 0.06 * fbm(vec2(p.x * 1.5 + u_seed, 3.0));
  if (uv.y < floorY) {
    float shade = 0.75 + 0.25 * fbm(p * 30.0);
    col = mix(u_deep, u_sand * shade, 0.75 * (1.0 - (floorY - uv.y) * 1.5));
    // Two drifting layers multiplied together give irregular, broken light instead of a net.
    float cA = caustic(vec2(p.x * 7.0, uv.y * 16.0), t * 0.9);
    float cB = caustic(vec2(p.x * 5.3 + 3.1, uv.y * 12.0 + 1.7), -t * 0.7);
    col += u_light * (cA * 0.22 + cA * cB * 1.4) * u_caustics * 0.4;
  } else {
    col += u_light * caustic(p * 5.0, t * 0.7) * caustic(p * 3.7 + 2.0, -t * 0.5) * u_caustics * 0.12 * uv.y;
  }

  // Bubbles rising in loose columns.
  // Each column of cells is shifted by a random amount so bubbles don't line up in rows.
  float column = floor(p.x * 14.0);
  vec2 g = vec2(p.x * 14.0, p.y * 7.0 - t * (0.7 + 0.5 * hash12(vec2(column, 4.0))) + hash12(vec2(column, 7.0)) * 7.0);
  vec2 id = floor(g);
  float h = hash12(id + u_seed);
  if (h > 1.0 - u_bubbles * 0.35) {
    vec2 f = fract(g) - 0.5;
    f.x += 0.15 * sin(g.y * 3.0 + h * 10.0);
    float r = 0.08 + 0.12 * hash12(id + 3.0);
    float d = length(f * vec2(1.0, 2.0));
    float ring = smoothstep(r, r * 0.8, d) - smoothstep(r * 0.8, r * 0.55, d);
    float glint = smoothstep(r * 0.3, 0.0, length(f * vec2(1.0, 2.0) - vec2(-r * 0.35, r * 0.35)));
    col += u_light * (ring * 0.5 + glint * 0.7);
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

export function create(ctx: PresetContext): PresetInstance {
  return createAutoShaderPreset(ctx, FRAGMENT);
}
