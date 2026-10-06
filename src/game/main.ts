import * as THREE from 'three/webgpu';
import { createStage } from '../render/stage';
import { FlyCamera } from '../render/flyCamera';
import { createSky, DOME_RADIUS } from '../render/sky';
import { formatClock, shiftMinutes } from '../render/skyMath';

const stageEl = document.getElementById('stage')!;
const hud = document.getElementById('hud')!;

const { renderer, camera, backend } = await createStage(stageEl);
const scene = new THREE.Scene();
const sky = createSky(scene);

// World units: 1 unit = 100 game units.
camera.near = 0.1;
camera.far = DOME_RADIUS * 4;
camera.updateProjectionMatrix();

// Placeholder ground until zone loading lands.
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(4_000, 4_000).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x5d6e3a, roughness: 1 }),
);
scene.add(ground);

// Time of day: [ and ] step the clock by 30 minutes.
const TIME_STEP = 30;
let minutes = 10 * 60;
sky.update(minutes);
window.addEventListener('keydown', (e) => {
  if (e.code !== 'BracketLeft' && e.code !== 'BracketRight') return;
  minutes = shiftMinutes(minutes, e.code === 'BracketLeft' ? -TIME_STEP : TIME_STEP);
  sky.update(minutes);
});

camera.position.set(0, 4, 0);
const fly = new FlyCamera(camera, renderer.domElement);
fly.speed = 20; // world units per second

let last = performance.now();
let frames = 0;
let fpsTime = 0;
let fps = 0;
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  fly.update(dt);
  renderer.render(scene, camera);

  frames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    fps = frames / fpsTime;
    frames = 0;
    fpsTime = 0;
  }
  const s = renderer.getDrawingBufferSize(new THREE.Vector2());
  hud.textContent = `${formatClock(minutes)}  [ ] ±30 min\n${backend}  ${s.x}×${s.y}  ${fps.toFixed(0)} fps\npos ${camera.position.toArray().map((v) => v.toFixed(1)).join(', ')}`;
});
