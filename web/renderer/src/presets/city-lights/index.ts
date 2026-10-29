import { createAutoShaderPreset } from '../../runtime/canvas';
import type { PresetContext, PresetInstance } from '../../runtime/types';

const FRAGMENT = `
uniform vec2 u_res;
uniform float u_time;
uniform float u_seed;
uniform vec3 u_skyTop;
uniform vec3 u_skyBottom;
uniform vec3 u_building;
uniform vec3 u_window;
uniform float u_lights;
uniform float u_traffic;
uniform float u_stars;
uniform float u_flow;

const float ROAD = 0.07;

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = vec2(uv.x * u_res.x / u_res.y, uv.y);
  float t = u_time * u_flow;

  vec3 col = mix(u_skyBottom, u_skyTop, smoothstep(0.05, 0.85, uv.y));
  vec2 sg = gl_FragCoord.xy / 4.0;
  float sh = hash12(floor(sg) + u_seed);
  if (sh > 1.0 - u_stars * 0.03) col += vec3(0.8) * smoothstep(0.5, 0.0, length(fract(sg) - 0.5)) * smoothstep(0.45, 0.8, uv.y);

  // Three rows of buildings, far to near: wider, taller and darker as they come closer.
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float w = 0.05 + fi * 0.035;
    float x = p.x / w + fi * 13.7 + u_seed;
    float id = floor(x);
    float h1 = hash12(vec2(id, fi + 1.0));
    float h2 = hash12(vec2(id, fi + 5.0));
    float height = ROAD + 0.12 + (0.22 - fi * 0.05) * h1 + 0.25 * pow(h2, 6.0);
    float gap = 0.06 + 0.1 * hash12(vec2(id, fi + 9.0));
    float ux = fract(x);
    if (uv.y < height && ux > gap && uv.y > ROAD) {
      float shade = 1.0 - fi * 0.25;
      col = mix(u_skyBottom * 0.45, u_building, 0.55 + fi * 0.22) * (0.8 + 0.2 * shade);
      // Windows: a grid in each building; each one switches every so often.
      float cols = 3.0 + floor(h2 * 4.0);
      float rowH = 0.012 + fi * 0.004;
      float wx = fract((ux - gap) / (1.0 - gap) * cols);
      float wy = fract((uv.y - ROAD) / rowH);
      vec2 win = vec2(floor((ux - gap) / (1.0 - gap) * cols), floor((uv.y - ROAD) / rowH));
      float hw = hash12(win + vec2(id * 7.0, fi * 31.0));
      float flip = hash12(win + vec2(id, floor(t * 0.05 + hw * 20.0)));
      float lit = step(1.0 - u_lights, flip) * step(0.25, wx) * step(wx, 0.75) * step(0.3, wy) * step(wy, 0.75)
                * step(uv.y, height - rowH);
      vec3 wc = mix(u_window, vec3(0.75, 0.88, 1.0), step(0.85, hw));
      col = mix(col, wc * (0.55 + 0.45 * hw), lit * (0.45 + fi * 0.25));
    }
    // Blinking red light on top of the tallest towers.
    if (h2 > 0.82) {
      vec2 dtip = vec2((x - id - (1.0 + gap) * 0.5) * w, uv.y - height - 0.006);
      float blink = step(0.5, fract(t * 0.5 + h1));
      col += vec3(1.0, 0.15, 0.1) * blink * smoothstep(0.005, 0.0, length(dtip));
    }
    // Light glow over the skyline.
    col += u_skyBottom * 0.08 * smoothstep(0.4, 0.0, uv.y);
  }

  // Street with headlights and tail lights streaming in both directions.
  if (uv.y < ROAD) {
    col = u_building * 0.6;
    if (u_traffic > 0.5) {
      float laneA = smoothstep(0.004, 0.0, abs(uv.y - ROAD * 0.35));
      float laneB = smoothstep(0.004, 0.0, abs(uv.y - ROAD * 0.65));
      float ca = step(0.6, hash12(vec2(floor(p.x * 30.0 - t * 1.4), 1.0))) * smoothstep(0.5, 0.0, abs(fract(p.x * 30.0 - t * 1.4) - 0.5));
      float cb = step(0.6, hash12(vec2(floor(p.x * 30.0 + t * 1.1), 2.0))) * smoothstep(0.5, 0.0, abs(fract(p.x * 30.0 + t * 1.1) - 0.5));
      col += vec3(1.0, 0.95, 0.8) * laneA * ca + vec3(1.0, 0.2, 0.15) * laneB * cb;
    }
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

export function create(ctx: PresetContext): PresetInstance {
  return createAutoShaderPreset(ctx, FRAGMENT);
}
