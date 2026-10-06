import * as THREE from 'three/webgpu';
import { createStage } from '../render/stage';
import { FlyCamera } from '../render/flyCamera';
import { createSky, DOME_RADIUS } from '../render/sky';
import { PartyController, PartyKeyboard } from '../world/partyController';
import { formatClock, shiftMinutes } from '../render/skyMath';
import { buildZoneScene } from '../render/zoneScene';
import { ResourceArchive } from '../formats/archive';
import { loadChapterStart, loadZone } from '../world/zone';

const stageEl = document.getElementById('stage')!;
const hud = document.getElementById('hud')!;

const { renderer, camera, backend } = await createStage(stageEl);
const scene = new THREE.Scene();
const sky = createSky(scene);

// World units: 1 unit = 100 game units.
camera.near = 0.1;
camera.far = DOME_RADIUS * 4;
camera.updateProjectionMatrix();

// Original game data, served by the dev server from the local install (see vite.config.ts).
hud.textContent = 'Loading game data…';
const [rmf, data] = await Promise.all([fetch('/bak/KRONDOR.RMF'), fetch('/bak/KRONDOR.001')]);
if (!rmf.ok || !data.ok) throw new Error('Game data not found: set BAK_DIR to your Betrayal at Krondor install');
const archive = new ResourceArchive(new Uint8Array(await rmf.arrayBuffer()), new Uint8Array(await data.arrayBuffer()));
const start = loadChapterStart(archive, 1);
const zone = buildZoneScene(loadZone(archive, start.zone));
scene.add(zone.group);
const zoneInfo = `zone ${start.zone}: ${zone.stats.meshItems} meshes, ${zone.stats.sprites} sprites, ${Math.round(zone.stats.triangles / 1000)}k tris, ${zone.collision.length} colliders`;

// Time of day: [ and ] step the clock by 30 minutes.
const TIME_STEP = 30;
let minutes = 10 * 60;
sky.update(minutes);
window.addEventListener('keydown', (e) => {
  if (e.code !== 'BracketLeft' && e.code !== 'BracketRight') return;
  minutes = shiftMinutes(minutes, e.code === 'BracketLeft' ? -TIME_STEP : TIME_STEP);
  sky.update(minutes);
});

// Party controller drives the camera; F toggles the debug fly camera.
// Debug: ?x=&y=&h= (BaK units, 8-bit heading) overrides the chapter start position.
const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
const party = new PartyController(num('x', start.x), num('y', start.y), num('h', start.heading)); // flat ground for now
party.polygons = zone.collision;
const partyKeys = new PartyKeyboard();
const fly = new FlyCamera(camera, renderer.domElement);
fly.speed = 20; // world units per second
let flyMode = false;
party.applyToCamera(camera);
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyF' || e.repeat) return;
  flyMode = !flyMode;
  if (flyMode) {
    fly.setHeading(camera.rotation.y);
  } else {
    document.exitPointerLock();
  }
  partyKeys.clear();
});

let last = performance.now();
let frames = 0;
let fpsTime = 0;
let fps = 0;
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (flyMode) {
    fly.update(dt);
  } else {
    party.update(dt, partyKeys.read());
    party.applyToCamera(camera);
  }
  renderer.render(scene, camera);

  frames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    fps = frames / fpsTime;
    frames = 0;
    fpsTime = 0;
  }
  const s = renderer.getDrawingBufferSize(new THREE.Vector2());
  hud.textContent = `${formatClock(minutes)}  [ ] ±30 min  F: ${flyMode ? 'fly' : 'party'} cam  heading ${party.heading8}\n${zoneInfo}\n${backend}  ${s.x}×${s.y}  ${fps.toFixed(0)} fps\npos ${camera.position.toArray().map((v) => v.toFixed(1)).join(', ')}`;
});
