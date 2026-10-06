import * as THREE from 'three/webgpu';
import { createStage } from '../render/stage';
import { FlyCamera } from '../render/flyCamera';
import { createSky, DOME_RADIUS } from '../render/sky';
import { buildHeightField } from '../world/heightField';
import { PartyController, PartyKeyboard, NO_INPUT } from '../world/partyController';
import { DEBUG_TIME_STEP, GameClock } from './clock';
import { buildZoneScene, collectTerrainTriangles } from '../render/zoneScene';
import { ResourceArchive } from '../formats/archive';
import { parseFNT } from '../formats/fnt';
import { parseGam } from '../formats/gam';
import { parseObjInfo } from '../formats/objinfo';
import { mountHud } from '../ui/hud';
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
const zoneData = loadZone(archive, start.zone);
const zone = buildZoneScene(zoneData);
const heightField = buildHeightField(collectTerrainTriangles(zoneData));
scene.add(zone.group);
const zoneInfo = `zone ${start.zone}: ${zone.stats.meshItems} meshes, ${zone.stats.sprites} sprites, ${Math.round(zone.stats.triangles / 1000)}k tris, ${zone.collision.length} colliders`;

// Game clock: the world state starts at the chapter's CHAP time; [ and ] step it by 30 minutes.
const startup = await fetch('/bak/STARTUP.GAM');
const save = parseGam(new Uint8Array(await startup.arrayBuffer()));
const clock = GameClock.forChapter(save, 1, start.timeElapsed);
sky.update(clock.minutes);
window.addEventListener('keydown', (e) => {
  if (e.code !== 'BracketLeft' && e.code !== 'BracketRight') return;
  clock.shift(e.code === 'BracketLeft' ? -DEBUG_TIME_STEP : DEBUG_TIME_STEP);
  sky.update(clock.minutes);
});

// Party controller drives the camera; F toggles the debug fly camera.
// Debug: ?x=&y=&h= (BaK units, 8-bit heading) overrides the chapter start position.
const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
const party = new PartyController(num('x', start.x), num('y', start.y), num('h', start.heading), heightField.getHeight);
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

// HUD screens: I inventory, C character sheet, Esc closes; movement is ignored while one is open.
const screens = mountHud(document.body, {
  font: parseFNT(archive.get('GAME.FNT')),
  save,
  items: parseObjInfo(archive.get('OBJINFO.DAT')).items,
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
    const px = party.x;
    const py = party.y;
    party.update(dt, screens.blocking ? NO_INPUT : partyKeys.read());
    if (party.x !== px || party.y !== py) {
      if (clock.walk(dt)) sky.update(clock.minutes);
    }
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
  hud.textContent = `${clock.label}  [ ] ±30 min  F: ${flyMode ? 'fly' : 'party'} cam  heading ${party.heading8}\n${zoneInfo}\n${backend}  ${s.x}×${s.y}  ${fps.toFixed(0)} fps\npos ${camera.position.toArray().map((v) => v.toFixed(1)).join(', ')}`;
});
