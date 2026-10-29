import { createAutoShaderPreset } from '../../runtime/canvas';
import type { PresetContext, PresetInstance } from '../../runtime/types';

const FRAGMENT = `
uniform vec2 u_res;
uniform float u_time;
uniform float u_seed;
uniform vec3 u_sky;
uniform vec3 u_haze;
uniform vec3 u_sandLight;
uniform vec3 u_sandShade;
uniform vec3 u_sun;
uniform float u_sunHeight;
uniform float u_drift;
uniform float u_flow;

// A dune profile: gentle windward slope, steep lee side, plus small ripples.
float dune(float x, float freq, float salt) {
  float s = x * freq + salt + 0.25 * sin(x * freq * 0.37 + salt);
  float f = fract(s);
  float shape = f < 0.6 ? f / 0.6 : (1.0 - f) / 0.4;   // asymmetric crest
  shape = shape * shape * (3.0 - 2.0 * shape);
  float height = 0.55 + 0.45 * vnoise(vec2(floor(s) + salt, 1.0));
  return shape * height;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = vec2(uv.x * u_res.x / u_res.y, uv.y);
  float t = u_time * u_flow;

  vec3 col = mix(u_haze, u_sky, smoothstep(0.35, 1.0, uv.y));
  vec2 sunPos = vec2(u_res.x / u_res.y * 0.28, 0.4 + u_sunHeight * 0.55);
  float sd = length(p - sunPos);
  col += u_sun * (smoothstep(0.05, 0.045, sd) + 0.35 * exp(-sd * 4.0));
  // Wispy high clouds.
  col = mix(col, vec3(1.0), 0.25 * smoothstep(0.55, 0.85, fbm(vec2(p.x * 1.2 - t * 0.01 + u_seed, p.y * 5.0))) * smoothstep(0.55, 0.9, uv.y));

  // Four layers, far to near. Farther layers are lower contrast and tinted by the haze.
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float freq = 0.9 + fi * 0.3;
    float base = 0.5 - fi * 0.12;
    float amp = 0.07 + fi * 0.03;
    float salt = u_seed + fi * 7.7;
    float x = p.x + fi * 0.37;
    float top = base + amp * dune(x, freq, salt);
    if (uv.y < top) {
      // Light from the sun's side: the slope of the profile decides lit or shaded.
      float slope = (dune(x + 0.004, freq, salt) - dune(x - 0.004, freq, salt)) * amp / 0.008;
      float lit = smoothstep(0.0, 1.0, 0.55 - slope * 0.7);
      vec3 sand = mix(u_sandShade, u_sandLight, lit);
      // Faces darken towards their foot, so slopes read as rounded rather than flat walls.
      sand *= 0.82 + 0.25 * clamp((uv.y - (top - amp * 1.2)) / (amp * 1.2), 0.0, 1.0);
      sand *= 0.9 + 0.1 * vnoise(vec2(x * 60.0, uv.y * 220.0)); // ripples and grain
      float haze = (3.0 - fi) / 3.0 * 0.55;
      col = mix(sand, u_haze, haze);
      // Sand blowing off the crest.
      float nearCrest = smoothstep(0.03, 0.0, top - uv.y);
      col = mix(col, u_sandLight, nearCrest * 0.25 * u_drift);
    }
    // Spray of sand just above the crest, streaming downwind.
    float above = uv.y - top;
    if (above > 0.0 && above < 0.05) {
      float streak = fbm(vec2((x - t * 0.3) * 18.0, above * 60.0 + fi));
      col = mix(col, u_sandLight, smoothstep(0.55, 0.85, streak) * smoothstep(0.05, 0.0, above) * u_drift * 0.35);
    }
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

export function create(ctx: PresetContext): PresetInstance {
  return createAutoShaderPreset(ctx, FRAGMENT);
}
