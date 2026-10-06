import * as THREE from 'three/webgpu';
import { createStage } from '../render/stage';
import { FlyCamera } from '../render/flyCamera';

const stageEl = document.getElementById('stage')!;
const hud = document.getElementById('hud')!;

const { renderer, camera, backend } = await createStage(stageEl);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fb4d8);
scene.fog = new THREE.Fog(0x8fb4d8, 20_000, 120_000);

const sun = new THREE.DirectionalLight(0xfff1d6, 2.5);
sun.position.set(30_000, 50_000, 20_000);
scene.add(sun, new THREE.HemisphereLight(0xbcd4f0, 0x4a3b28, 1.2));

// Placeholder ground until zone loading lands.
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200_000, 200_000).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x5d6e3a, roughness: 1 }),
);
scene.add(ground);

camera.position.set(0, 400, 0);
const fly = new FlyCamera(camera, renderer.domElement);

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
  hud.textContent = `${backend}  ${s.x}×${s.y}  ${fps.toFixed(0)} fps\npos ${camera.position.toArray().map((v) => v.toFixed(0)).join(', ')}`;
});
