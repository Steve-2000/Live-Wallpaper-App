import { createCanvas, sizeCanvas } from '../../runtime/canvas';
import { hexToRgb } from '../../runtime/params';
import type { PresetContext, PresetInstance, ParamValues } from '../../runtime/types';

// Rendered with WebGL: star positions are computed in the vertex shader from
// (radius, angle), so animating thousands of stars costs no per-frame JavaScript.

const BACKGROUND_VS = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const BACKGROUND_FS = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform float u_R;
uniform vec3 u_core;
void main() {
  vec3 col = texture2D(u_tex, v_uv).rgb;
  vec2 d = (v_uv - 0.5) * u_res;
  d.y /= 0.55; // the disk is tilted, so the glow is an ellipse
  float r = length(d) / (u_R * 0.45);
  col += u_core * (0.55 * exp(-r * r * 9.0) + 0.18 * exp(-r * 2.8));
  gl_FragColor = vec4(col, 1.0);
}
`;

const STAR_VS = `
attribute vec4 a_star; // radius (0..1), angle, size, alpha
uniform vec2 u_res;
uniform float u_R;
uniform float u_rotation;
uniform float u_time;
uniform float u_twinkle;
uniform float u_dpr;
uniform vec3 u_core;
uniform vec3 u_arm;
varying vec4 v_color;
void main() {
  float r = a_star.x;
  // Inner stars orbit faster (differential rotation).
  float a = a_star.y + u_rotation / sqrt(0.08 + r);
  vec2 p = vec2(cos(a), sin(a) * 0.55) * r * u_R;
  gl_Position = vec4(p / (u_res * 0.5), 0.0, 1.0);
  gl_PointSize = a_star.z * u_dpr;
  float tw = mix(1.0, 0.7 + 0.3 * sin(u_time * 2.3 + a_star.y * 37.0), u_twinkle);
  v_color = vec4(mix(u_core, u_arm, pow(r, 0.7)), a_star.w * tw);
}
`;

const STAR_FS = `
precision mediump float;
varying vec4 v_color;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float fall = smoothstep(0.5, 0.15, length(c));
  gl_FragColor = vec4(v_color.rgb * v_color.a * fall, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`Galaxy shader: ${gl.getShaderInfoLog(shader)}`);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Galaxy link: ${gl.getProgramInfoLog(program)}`);
  return program;
}

export function create(ctx: PresetContext): PresetInstance {
  const canvas = createCanvas(ctx.host, ctx.width, ctx.height, ctx.dpr);
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
  if (!gl) throw new Error('WebGL is not available on this device.');
  const random = ctx.random;
  let params: ParamValues = ctx.params;
  let width = ctx.width;
  let height = ctx.height;
  let dpr = ctx.dpr;

  const bgProgram = compile(gl, BACKGROUND_VS, BACKGROUND_FS);
  const starProgram = compile(gl, STAR_VS, STAR_FS);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const starBuffer = gl.createBuffer();
  let starCount = 0;
  const bgTexture = gl.createTexture();

  const u = (program: WebGLProgram, name: string) => gl.getUniformLocation(program, name);

  const gaussian = () => {
    const v = Math.max(1e-6, random());
    return Math.sqrt(-2 * Math.log(v)) * Math.cos(2 * Math.PI * random());
  };

  function buildStars(): void {
    const count = Number(params.starCount);
    const arms = Number(params.arms);
    const twist = Number(params.twist);
    const data = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      // Dense core, exponentially thinning disk (resampled, not clamped, so no rim ring forms).
      let r = 2;
      while (r > 1) r = -Math.log(1 - random() * 0.999) / 2.6;
      const arm = Math.floor(random() * arms);
      const spread = (0.4 + r * 0.8) * gaussian() * 0.45;
      data[i * 4] = r;
      data[i * 4 + 1] = (arm / arms) * Math.PI * 2 + r * twist + spread;
      data[i * 4 + 2] = random() < 0.04 ? 2.2 + random() * 1.6 : 1.0 + random() * 1.2;
      data[i * 4 + 3] = 0.35 + random() * 0.65;
    }
    gl!.bindBuffer(gl!.ARRAY_BUFFER, starBuffer);
    gl!.bufferData(gl!.ARRAY_BUFFER, data, gl!.STATIC_DRAW);
    starCount = count;
  }

  /** The distant star field is static, so it's painted once into a texture. */
  function buildBackground(): void {
    const bg = document.createElement('canvas');
    sizeCanvas(bg, width, height, dpr);
    const g = bg.getContext('2d')!;
    g.fillStyle = String(params.background);
    g.fillRect(0, 0, bg.width, bg.height);
    const count = Math.round((bg.width * bg.height) / 2600);
    for (let i = 0; i < count; i++) {
      g.globalAlpha = 0.15 + random() * 0.6;
      g.fillStyle = random() < 0.15 ? '#ffe7c4' : '#cfd9ff';
      const s = (random() < 0.05 ? 1.6 : 0.8) * dpr;
      g.fillRect(random() * bg.width, random() * bg.height, s, s);
    }
    gl!.bindTexture(gl!.TEXTURE_2D, bgTexture);
    gl!.pixelStorei(gl!.UNPACK_FLIP_Y_WEBGL, true);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGB, gl!.RGB, gl!.UNSIGNED_BYTE, bg);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
  }

  buildStars();
  buildBackground();
  let rotation = 0;

  return {
    update(dt, time) {
      rotation += dt * Number(params.rotation);
      const w = canvas.width;
      const h = canvas.height;
      const R = Math.min(w, h) * 0.5 * Number(params.size);
      const core = hexToRgb(String(params.coreColor));
      gl.viewport(0, 0, w, h);

      gl.disable(gl.BLEND);
      gl.useProgram(bgProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      const aPos = gl.getAttribLocation(bgProgram, 'a_pos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      gl.bindTexture(gl.TEXTURE_2D, bgTexture);
      gl.uniform2f(u(bgProgram, 'u_res'), w, h);
      gl.uniform1f(u(bgProgram, 'u_R'), R);
      gl.uniform3f(u(bgProgram, 'u_core'), core[0], core[1], core[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disableVertexAttribArray(aPos);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE); // additive light
      gl.useProgram(starProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, starBuffer);
      const aStar = gl.getAttribLocation(starProgram, 'a_star');
      gl.enableVertexAttribArray(aStar);
      gl.vertexAttribPointer(aStar, 4, gl.FLOAT, false, 0, 0);
      const arm = hexToRgb(String(params.armColor));
      gl.uniform2f(u(starProgram, 'u_res'), w, h);
      gl.uniform1f(u(starProgram, 'u_R'), R);
      gl.uniform1f(u(starProgram, 'u_rotation'), rotation);
      gl.uniform1f(u(starProgram, 'u_time'), time);
      gl.uniform1f(u(starProgram, 'u_twinkle'), params.twinkle ? 1 : 0);
      gl.uniform1f(u(starProgram, 'u_dpr'), dpr);
      gl.uniform3f(u(starProgram, 'u_core'), core[0], core[1], core[2]);
      gl.uniform3f(u(starProgram, 'u_arm'), arm[0], arm[1], arm[2]);
      gl.drawArrays(gl.POINTS, 0, starCount);
      gl.disableVertexAttribArray(aStar);
    },
    resize(w, h, d) {
      width = w;
      height = h;
      dpr = d;
      sizeCanvas(canvas, w, h, d);
      buildBackground();
    },
    setParams(next) {
      const prev = params;
      params = next;
      if (prev.starCount !== next.starCount || prev.arms !== next.arms || prev.twist !== next.twist) buildStars();
      if (prev.background !== next.background) buildBackground();
    },
    dispose() {
      gl.deleteBuffer(quad);
      gl.deleteBuffer(starBuffer);
      gl.deleteTexture(bgTexture);
      gl.deleteProgram(bgProgram);
      gl.deleteProgram(starProgram);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.remove();
    },
  };
}
