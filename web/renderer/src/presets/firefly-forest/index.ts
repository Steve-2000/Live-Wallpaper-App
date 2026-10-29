import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { hexToRgb } from '../../runtime/params';
import type { PresetContext, PresetInstance, ParamValues } from '../../runtime/types';

interface Firefly {
  sprite: Sprite;
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  blink: number;
  depth: number;
}

function mixHex(a: string, b: string, t: number): number {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const c = ca.map((v, i) => Math.round((v + (cb[i] - v) * t) * 255));
  return (c[0] << 16) | (c[1] << 8) | c[2];
}

function gradientTexture(top: string, bottom: string): Texture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  return Texture.from(c);
}

function glowTexture(): Texture {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.15, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return Texture.from(c);
}

export async function create(ctx: PresetContext): Promise<PresetInstance> {
  const app = new Application();
  await app.init({
    width: ctx.width,
    height: ctx.height,
    resolution: ctx.dpr,
    autoDensity: true,
    antialias: true,
    autoStart: false,
    sharedTicker: false,
    background: '#000000',
    preference: 'webgl',
    powerPreference: 'low-power',
  });
  ctx.host.appendChild(app.canvas);

  const random = ctx.random;
  let params: ParamValues = ctx.params;
  let width = ctx.width;
  let height = ctx.height;

  const sky = new Sprite();
  const moonLayer = new Graphics();
  const treeLayers = [new Graphics(), new Graphics(), new Graphics()];
  const flyLayers = [new Container(), new Container(), new Container()];
  // Interleave: far trees, far flies, mid trees, mid flies, near trees, near flies.
  app.stage.addChild(sky, moonLayer);
  for (let i = 0; i < 3; i++) app.stage.addChild(treeLayers[i], flyLayers[i]);

  const glow = glowTexture();
  let skyTexture: Texture | null = null;
  let flies: Firefly[] = [];

  function drawSky(): void {
    skyTexture?.destroy(true);
    skyTexture = gradientTexture(String(params.skyTop), String(params.skyBottom));
    sky.texture = skyTexture;
    sky.width = width;
    sky.height = height;

    moonLayer.clear();
    if (params.moon) {
      const mx = width * 0.78;
      const my = height * 0.2;
      const r = Math.min(width, height) * 0.055;
      for (let i = 6; i >= 1; i--) moonLayer.circle(mx, my, r * (1 + i * 0.5)).fill({ color: 0xfff4d6, alpha: 0.025 });
      moonLayer.circle(mx, my, r).fill({ color: 0xfff4d6 });
      moonLayer.circle(mx - r * 0.3, my - r * 0.2, r * 0.18).fill({ color: 0xe8dcb8, alpha: 0.6 });
      moonLayer.circle(mx + r * 0.25, my + r * 0.3, r * 0.12).fill({ color: 0xe8dcb8, alpha: 0.5 });
    }
  }

  function drawPine(g: Graphics, x: number, baseY: number, h: number, color: number): void {
    const w = h * (0.28 + random() * 0.1);
    const tiers = 4 + Math.floor(random() * 3);
    g.rect(x - w * 0.04, baseY - h * 0.15, w * 0.08, h * 0.15).fill({ color });
    for (let i = 0; i < tiers; i++) {
      const t = i / tiers;
      const tierBase = baseY - h * 0.1 - t * h * 0.8;
      const tierW = w * (1 - t * 0.75);
      const tierH = h * 0.3;
      g.poly([x - tierW / 2, tierBase, x + tierW / 2, tierBase, x, tierBase - tierH]).fill({ color });
    }
  }

  function drawTrees(): void {
    const top = String(params.skyTop);
    const bottom = String(params.skyBottom);
    const density = Number(params.treeDensity);
    const layers = [
      { color: mixHex(bottom, top, 0.35), base: 0.88, h: 0.28, n: 26 },
      { color: mixHex(top, '#000000', 0.45), base: 0.95, h: 0.42, n: 14 },
      { color: mixHex(top, '#000000', 0.85), base: 1.04, h: 0.62, n: 7 },
    ];
    layers.forEach((layer, i) => {
      const g = treeLayers[i];
      g.clear();
      const ground = height * layer.base;
      g.rect(0, ground - height * 0.02, width, height).fill({ color: layer.color });
      const count = Math.max(2, Math.round(layer.n * density * (width / height / 1.78)));
      for (let k = 0; k < count; k++) {
        const x = ((k + random() * 0.8) / count) * width * 1.05 - width * 0.025;
        drawPine(g, x, ground, height * layer.h * (0.7 + random() * 0.5), layer.color);
      }
    });
  }

  function spawnFlies(): void {
    for (const f of flies) f.sprite.destroy();
    flies = [];
    const count = Number(params.fireflies);
    for (let i = 0; i < count; i++) {
      const depth = random() < 0.45 ? 0 : random() < 0.6 ? 1 : 2;
      const sprite = new Sprite(glow);
      sprite.anchor.set(0.5);
      sprite.blendMode = 'add';
      flyLayers[depth].addChild(sprite);
      flies.push({
        sprite,
        x: random() * width,
        y: height * (0.35 + random() * 0.6),
        vx: (random() - 0.5) * 20,
        vy: (random() - 0.5) * 20,
        phase: random() * Math.PI * 2,
        blink: 0.4 + random() * 1.2,
        depth,
      });
    }
    applyFlyStyle();
  }

  function applyFlyStyle(): void {
    const [r, g, b] = hexToRgb(String(params.glowColor));
    const tint = (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
    const base = Number(params.glowSize) * Math.min(width, height) / 900;
    for (const f of flies) {
      f.sprite.tint = tint;
      f.sprite.scale.set(base * (0.35 + f.depth * 0.3));
    }
  }

  drawSky();
  drawTrees();
  spawnFlies();

  return {
    update(dt, time) {
      const drift = Number(params.drift);
      for (const f of flies) {
        // Smooth wandering: steer velocity with slow pseudo-noise.
        const n = time * 0.4 + f.phase;
        f.vx += Math.sin(n * 1.3 + f.phase * 2) * 18 * dt;
        f.vy += Math.cos(n * 0.9 + f.phase) * 14 * dt;
        f.vx *= 0.985;
        f.vy *= 0.985;
        f.x += f.vx * dt * drift * (0.6 + f.depth * 0.3);
        f.y += f.vy * dt * drift * (0.6 + f.depth * 0.3);
        if (f.x < -40) f.x = width + 40;
        if (f.x > width + 40) f.x = -40;
        if (f.y < height * 0.25) f.vy += 30 * dt;
        if (f.y > height * 1.02) f.vy -= 30 * dt;
        const pulse = Math.max(0, Math.sin(time * f.blink * 2 + f.phase));
        f.sprite.alpha = 0.15 + 0.85 * pulse * pulse;
        f.sprite.position.set(f.x, f.y);
      }
      app.render();
    },
    resize(w, h, d) {
      width = w;
      height = h;
      app.renderer.resolution = d;
      app.renderer.resize(w, h);
      drawSky();
      drawTrees();
      applyFlyStyle();
    },
    setParams(next) {
      const prev = params;
      params = next;
      if (prev.skyTop !== next.skyTop || prev.skyBottom !== next.skyBottom || prev.moon !== next.moon) drawSky();
      if (prev.skyTop !== next.skyTop || prev.skyBottom !== next.skyBottom || prev.treeDensity !== next.treeDensity) drawTrees();
      if (prev.fireflies !== next.fireflies) spawnFlies();
      else applyFlyStyle();
    },
    dispose() {
      skyTexture?.destroy(true);
      glow.destroy(true);
      app.destroy({ removeView: true }, { children: true });
    },
  };
}
