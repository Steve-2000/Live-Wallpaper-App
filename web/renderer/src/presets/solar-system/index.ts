import * as THREE from 'three';
import type { PresetContext, PresetInstance, ParamValues } from '../../runtime/types';

interface PlanetDef {
  radius: number;
  distance: number;
  period: number; // relative orbital period (Earth = 1), compressed for watchability
  color: string;
  bands?: string;
  ring?: boolean;
}

const PLANETS: PlanetDef[] = [
  { radius: 0.38, distance: 6, period: 0.24, color: '#9c8f86' },
  { radius: 0.62, distance: 8.5, period: 0.62, color: '#e3bb76' },
  { radius: 0.66, distance: 11, period: 1, color: '#3a7bd5' },
  { radius: 0.48, distance: 13.5, period: 1.88, color: '#c1440e' },
  { radius: 1.7, distance: 18.5, period: 4.5, color: '#d8ca9d', bands: '#a57c55' },
  { radius: 1.45, distance: 24, period: 7, color: '#e8d8a8', bands: '#c2a46b', ring: true },
  { radius: 1.0, distance: 29, period: 10, color: '#a6e3e9' },
  { radius: 0.98, distance: 33.5, period: 13, color: '#4b70dd' },
];

function bandTexture(base: string, band: string, random: () => number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, 8, 128);
  for (let y = 0; y < 128; y += 2 + Math.floor(random() * 6)) {
    g.globalAlpha = 0.15 + random() * 0.45;
    g.fillStyle = random() < 0.5 ? band : base;
    g.fillRect(0, y, 8, 1 + random() * 4);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function glowSprite(color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
  );
  sprite.scale.setScalar(14);
  return sprite;
}

export function create(ctx: PresetContext): PresetInstance {
  const random = ctx.random;
  let params: ParamValues = ctx.params;

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(ctx.dpr);
  renderer.setSize(ctx.width, ctx.height);
  ctx.host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#020308');
  const camera = new THREE.PerspectiveCamera(45, ctx.width / ctx.height, 0.1, 1000);

  scene.add(new THREE.AmbientLight(0xffffff, 0.12));
  const sunLight = new THREE.PointLight(0xffffff, 3, 0, 0);
  scene.add(sunLight);

  const sunMaterial = new THREE.MeshBasicMaterial({ color: String(params.sunColor) });
  const sun = new THREE.Mesh(new THREE.SphereGeometry(3, 48, 48), sunMaterial);
  scene.add(sun);
  const sunGlow = glowSprite(String(params.sunColor));
  scene.add(sunGlow);

  const orbitGroup = new THREE.Group();
  scene.add(orbitGroup);

  const planets = PLANETS.map((def) => {
    const material = new THREE.MeshStandardMaterial({
      color: def.bands ? '#ffffff' : def.color,
      map: def.bands ? bandTexture(def.color, def.bands, random) : null,
      roughness: 0.9,
      metalness: 0,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(def.radius, 32, 32), material);
    const pivot = new THREE.Group();
    pivot.add(mesh);
    mesh.position.x = def.distance;
    if (def.ring) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(def.radius * 1.4, def.radius * 2.3, 64),
        new THREE.MeshBasicMaterial({ color: '#d9c48f', side: THREE.DoubleSide, transparent: true, opacity: 0.55 }),
      );
      ring.rotation.x = Math.PI / 2.4;
      mesh.add(ring);
    }
    pivot.rotation.y = random() * Math.PI * 2;
    scene.add(pivot);

    const points = new THREE.EllipseCurve(0, 0, def.distance, def.distance).getPoints(128);
    const orbit = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(p.x, 0, p.y))),
      new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.12 }),
    );
    orbitGroup.add(orbit);
    return { def, mesh, pivot };
  });

  let stars: THREE.Points | null = null;
  function buildStars(): void {
    if (stars) {
      scene.remove(stars);
      stars.geometry.dispose();
      (stars.material as THREE.Material).dispose();
    }
    const count = Number(params.starCount);
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Uniform points on a large sphere shell.
      const u = random() * 2 - 1;
      const th = random() * Math.PI * 2;
      const r = 300 + random() * 200;
      const s = Math.sqrt(1 - u * u);
      positions.set([r * s * Math.cos(th), r * u, r * s * Math.sin(th)], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    stars = new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#cfd8ff', size: 1.4, sizeAttenuation: false }));
    scene.add(stars);
  }

  function applyParams(): void {
    const scale = Number(params.planetScale);
    for (const p of planets) p.mesh.scale.setScalar(scale);
    sunMaterial.color.set(String(params.sunColor));
    (sunGlow.material as THREE.SpriteMaterial).color.set(String(params.sunColor));
    orbitGroup.visible = Boolean(params.showOrbits);
  }

  buildStars();
  applyParams();
  let cameraAngle = 0.6;

  return {
    update(dt) {
      const speed = Number(params.orbitSpeed) * 0.25;
      for (const p of planets) {
        p.pivot.rotation.y += (dt * speed) / p.def.period;
        p.mesh.rotation.y += dt * 0.5;
      }
      cameraAngle += dt * Number(params.cameraOrbit);
      const dist = Number(params.cameraDistance);
      const tilt = THREE.MathUtils.degToRad(Number(params.cameraTilt));
      camera.position.set(
        Math.cos(cameraAngle) * dist * Math.cos(tilt),
        dist * Math.sin(tilt),
        Math.sin(cameraAngle) * dist * Math.cos(tilt),
      );
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    },
    resize(w, h, d) {
      renderer.setPixelRatio(d);
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    setParams(next) {
      const rebuildStars = next.starCount !== params.starCount;
      params = next;
      if (rebuildStars) buildStars();
      applyParams();
    },
    dispose() {
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        for (const m of mats) {
          (m as THREE.MeshStandardMaterial).map?.dispose();
          m.dispose();
        }
      });
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
