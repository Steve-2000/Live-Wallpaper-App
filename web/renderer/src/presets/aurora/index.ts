import { createShaderPreset } from '../../runtime/canvas';
import { hexToRgb } from '../../runtime/params';
import type { PresetContext, PresetInstance } from '../../runtime/types';

const FRAGMENT = `
uniform vec2 u_res;
uniform float u_time;
uniform vec3 u_colorA;
uniform vec3 u_colorB;
uniform vec3 u_sky;
uniform float u_intensity;
uniform float u_flow;
uniform float u_stars;
uniform float u_mountains;

// One aurora curtain: a sinuous lower edge high in the sky, fine vertical rays,
// a long fade upwards and slowly drifting gaps along its length.
float curtain(vec2 p, float offset, float t, out float edge) {
  float x = p.x + offset;
  float center = 0.58 + (fbm(vec2(x * 0.55, t * 0.08 + offset)) - 0.5) * 0.45;
  float d = p.y - center;
  edge = exp(-abs(d) * 60.0);
  float body = smoothstep(-0.012, 0.012, d) * exp(-max(d, 0.0) * 3.2);
  float warp = fbm(vec2(x * 1.5, t * 0.12)) * 6.0;
  float rays = pow(vnoise(vec2(x * 55.0 + warp, t * 0.35)), 2.0) * 0.8 + 0.25;
  float gaps = smoothstep(0.3, 0.65, fbm(vec2(x * 0.8 - t * 0.05, offset)));
  return body * rays * gaps;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = vec2(uv.x * u_res.x / u_res.y, uv.y);
  float t = u_time * u_flow;

  vec3 col = mix(u_sky * 0.3, u_sky * 1.5 + vec3(0.01, 0.015, 0.03), uv.y);

  float e1, e2, e3;
  float a = curtain(p, 0.0, t, e1) + 0.6 * curtain(p * vec2(1.25, 1.0) + vec2(0.0, 0.06), 5.0, t * 1.15, e2);
  float fringe = curtain(p * vec2(0.9, 1.0) + vec2(0.0, -0.04), 11.0, t * 0.9, e3);
  vec3 aur = (u_colorA * (a + e1 * 0.25) + u_colorB * fringe * 0.7) * u_intensity;

  // Small twinkling stars, hidden behind bright aurora.
  vec2 grid = p * 260.0;
  vec2 cell = floor(grid);
  float h = hash12(cell);
  if (h > 1.0 - u_stars * 0.035) {
    vec2 c = cell + 0.25 + 0.5 * vec2(hash12(cell + 3.1), hash12(cell + 7.7));
    float tw = 0.55 + 0.45 * sin(u_time * (1.0 + h * 3.0) + h * 40.0);
    float star = smoothstep(0.9, 0.0, length(grid - c)) * tw;
    col += vec3(0.85, 0.9, 1.0) * star * (1.0 - clamp(length(aur) * 1.5, 0.0, 1.0));
  }

  col += aur * smoothstep(0.2, 0.42, uv.y);

  if (u_mountains > 0.5) {
    float ridge = 0.2 + fbm(vec2(p.x * 1.4, 2.0)) * 0.12 + fbm(vec2(p.x * 7.0, 5.0)) * 0.025;
    float near = 0.1 + fbm(vec2(p.x * 2.4 + 10.0, 1.0)) * 0.08;
    // Far ridge catches a little aurora light; the near ridge is a silhouette.
    if (uv.y < ridge) col = u_sky * 0.35 + u_colorA * u_intensity * 0.04 * smoothstep(ridge - 0.08, ridge, uv.y);
    if (uv.y < near) col = u_sky * 0.1;
  }

  col = 1.0 - exp(-col * 1.4); // gentle tone mapping
  gl_FragColor = vec4(col, 1.0);
}
`;

export function create(ctx: PresetContext): PresetInstance {
  return createShaderPreset(ctx.host, ctx.width, ctx.height, ctx.dpr, ctx.params, {
    fragment: FRAGMENT,
    qualityKey: 'quality',
    uniforms: (p) => ({
      u_colorA: hexToRgb(String(p.colorA)),
      u_colorB: hexToRgb(String(p.colorB)),
      u_sky: hexToRgb(String(p.skyColor)),
      u_intensity: Number(p.intensity),
      u_flow: Number(p.flow),
      u_stars: Number(p.stars),
      u_mountains: p.mountains ? 1 : 0,
    }),
  });
}
