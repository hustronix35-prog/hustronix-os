/**
 * Vanilla Three.js port of apps/web HeroCanvas.tsx
 */
import * as THREE from "three";

const GOLD = 0xc6a85a;
const GOLD_BRIGHT = 0xe8d9a0;
const GOLD_DIM = 0x8a7340;
const TERRAIN_BASE_Y = -1.42;
const COLS = 96;
const ROWS = 44;

const ARCS = [
  { r: 2.55, opacity: 0.22 },
  { r: 2.78, opacity: 0.32 },
  { r: 3.02, opacity: 0.42 },
  { r: 3.26, opacity: 0.52 },
  { r: 3.5, opacity: 0.62 },
  { r: 3.74, opacity: 0.48 },
  { r: 3.98, opacity: 0.32 },
];

const STEMS = [
  { x: -2.85, z: 0.35, h: 0.95 },
  { x: -2.05, z: -0.15, h: 0.72 },
  { x: -1.25, z: 0.55, h: 1.15 },
  { x: -0.45, z: -0.35, h: 0.88 },
  { x: 0.35, z: 0.25, h: 1.05 },
  { x: 1.15, z: -0.2, h: 0.78 },
  { x: 1.95, z: 0.45, h: 1.22 },
  { x: 2.75, z: -0.1, h: 0.92 },
  { x: -1.65, z: 0.05, h: 0.65 },
  { x: 0.85, z: 0.6, h: 0.7 },
];

function terrainHeight(x, z, t = 0) {
  return (
    TERRAIN_BASE_Y +
    Math.sin(x * 0.72 + t * 0.35) * 0.11 +
    Math.sin(z * 1.05 + x * 0.35 + t * 0.28) * 0.08 +
    Math.sin(x * 1.85 + z * 0.55) * 0.045 +
    Math.cos(x * 0.4 - z * 0.9 + t * 0.2) * 0.05
  );
}

function buildArcCurve(radius, yScale = 0.52, yOffset = 0.72, z = -1.35, segments = 140) {
  const start = Math.PI * 0.58;
  const end = Math.PI * 1.42;
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const a = start + ((end - start) * i) / segments;
    pts.push(
      Math.cos(a) * radius,
      Math.sin(a) * radius * yScale + yOffset,
      z,
    );
  }
  return pts;
}

function makeLine(points, color, opacity) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  const mat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
  });
  return new THREE.Line(geo, mat);
}

function buildTerrainGrid(t = 0) {
  const pts = [];
  for (let i = 0; i < COLS; i++) {
    for (let j = 0; j < ROWS; j++) {
      const x = (i / (COLS - 1) - 0.5) * 7.2;
      const z = (j / (ROWS - 1) - 0.5) * 3.6 - 0.85;
      const y = terrainHeight(x, z, t);
      pts.push(x, y, z);
    }
  }
  return new Float32Array(pts);
}

function init() {
  const canvas = document.getElementById("hero-canvas");
  const root = document.getElementById("hero-canvas-root");
  if (!canvas || !root) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion) return;

  const mouse = { x: 0, y: 0 };
  const smooth = { x: 0, y: 0 };
  const heroSection = document.querySelector(".landing-zone-hero");
  if (heroSection) {
    heroSection.addEventListener("pointermove", (e) => {
      const r = heroSection.getBoundingClientRect();
      mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      mouse.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    });
  }

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
  camera.position.set(0, 0.35, 5.65);

  const rootGroup = new THREE.Group();
  scene.add(rootGroup);

  scene.add(new THREE.AmbientLight(0xffffff, 0.45));
  const key = new THREE.PointLight(GOLD_BRIGHT, 1.1);
  key.position.set(0, 2, 3);
  scene.add(key);
  const fill = new THREE.PointLight(GOLD_DIM, 0.45);
  fill.position.set(-3, -1, 2);
  scene.add(fill);

  for (const a of ARCS) {
    rootGroup.add(makeLine(buildArcCurve(a.r), GOLD_BRIGHT, a.opacity));
  }

  const baseTerrain = buildTerrainGrid(0);
  const terrainGeo = new THREE.BufferGeometry();
  terrainGeo.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(baseTerrain), 3),
  );
  const terrainMat = new THREE.PointsMaterial({
    color: GOLD_BRIGHT,
    size: 0.022,
    transparent: true,
    opacity: 0.78,
    sizeAttenuation: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const terrain = new THREE.Points(terrainGeo, terrainMat);
  rootGroup.add(terrain);

  const starPts = [];
  for (let i = 0; i < 120; i++) {
    starPts.push(
      (Math.random() - 0.5) * 8,
      (Math.random() - 0.5) * 4 + 0.3,
      (Math.random() - 0.5) * 4 - 1.5,
    );
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starPts, 3));
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({
      color: GOLD,
      size: 0.018,
      transparent: true,
      opacity: 0.28,
      sizeAttenuation: true,
      depthWrite: false,
    }),
  );
  rootGroup.add(stars);

  for (const s of STEMS) {
    const y0 = terrainHeight(s.x, s.z);
    rootGroup.add(
      makeLine([s.x, y0, s.z, s.x, y0 + s.h, s.z], GOLD, 0.35),
    );
  }
  const tops = STEMS.flatMap((s) => {
    const y0 = terrainHeight(s.x, s.z);
    return [s.x, y0 + s.h, s.z];
  });
  const topGeo = new THREE.BufferGeometry();
  topGeo.setAttribute("position", new THREE.Float32BufferAttribute(tops, 3));
  rootGroup.add(
    new THREE.Points(
      topGeo,
      new THREE.PointsMaterial({
        color: GOLD_BRIGHT,
        size: 0.065,
        transparent: true,
        opacity: 0.95,
        sizeAttenuation: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    ),
  );

  function resize() {
    const w = root.clientWidth || window.innerWidth;
    const h = root.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener("resize", resize);

  let time = 0;
  let last = performance.now();

  function frame(now) {
    const delta = Math.min((now - last) / 1000, 0.05);
    last = now;
    time += delta;

    smooth.x = THREE.MathUtils.lerp(smooth.x, mouse.x, 0.06);
    smooth.y = THREE.MathUtils.lerp(smooth.y, mouse.y, 0.06);
    const breathe = 1 + Math.sin(time * 0.7) * 0.012;
    rootGroup.rotation.y = smooth.x * 0.14;
    rootGroup.rotation.x = smooth.y * 0.07;
    rootGroup.position.x = smooth.x * 0.18;
    rootGroup.position.y = smooth.y * 0.06;
    rootGroup.scale.setScalar(breathe);

    const attr = terrainGeo.attributes.position;
    const arr = attr.array;
    for (let i = 0; i < COLS; i++) {
      for (let j = 0; j < ROWS; j++) {
        const idx = (i * ROWS + j) * 3;
        const bx = baseTerrain[idx];
        const bz = baseTerrain[idx + 2];
        const wave = terrainHeight(bx, bz, time);
        const dx = bx - mouse.x * 3.2;
        const dz = bz - mouse.y * 1.4;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const ripple =
          dist < 2.2
            ? Math.cos(dist * 3.2 - time * 4) * 0.06 * (1 - dist / 2.2)
            : 0;
        arr[idx + 1] = wave + ripple;
      }
    }
    attr.needsUpdate = true;
    stars.rotation.y += delta * 0.012;

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
