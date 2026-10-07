import * as THREE from 'three/webgpu';
import { createStage } from '../render/stage';
import { FlyCamera } from '../render/flyCamera';
import { createPost } from '../render/post';
import { parseQuality } from '../render/postSettings';
import { createSky, DOME_RADIUS } from '../render/sky';
import { PartyController, PartyKeyboard, NO_INPUT } from '../world/partyController';
import { DEBUG_TIME_STEP, GameClock } from './clock';
import { ResourceArchive } from '../formats/archive';
import { parseFNT } from '../formats/fnt';
import { parseBMX } from '../formats/bmx';
import { parsePalette } from '../formats/palette';
import { parseGam } from '../formats/gam';
import { parseObjInfo } from '../formats/objinfo';
import { loadItemIcons } from '../data/itemIcons';
import { EncounterDriver, encounterResourceNames, loadEncounterRunner, prefetchResources } from './encounterDriver';
import { mountHud } from '../ui/hud';
import { createBrowserMusicPlayer } from '../audio/music';
import { songForZone } from '../audio/songs';
import { portraitCanvases } from '../ui/partyBar';
import { loadChapterStart } from '../world/zone';
import { TILE_SIZE } from '../formats/world';
import { ZoneHost } from './zoneHost';
import { partyFromSave } from './party';
import { resolveDialogOutcome } from './dialogOutcome';
import { parseTeleports, planTransition, type Destination } from './transitions';
import type { WorldState } from './state';

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
// Debug: ?zone=N starts in zone N at the centre of its first tile; ?x=&y=&h= (BaK units,
// 8-bit heading) override the start position.
const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
const chapterStart = loadChapterStart(archive, 1);
const startZone = num('zone', chapterStart.zone);
const zoneHost = await ZoneHost.create(scene, archive, startZone);
const [firstTileX, firstTileY] = zoneHost.current.data.tiles[0] ?? [0, 0];
const start =
  startZone === chapterStart.zone
    ? chapterStart
    : { ...chapterStart, zone: startZone, x: (firstTileX + 0.5) * TILE_SIZE, y: (firstTileY + 0.5) * TILE_SIZE };

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
const party = new PartyController(num('x', start.x), num('y', start.y), num('h', start.heading), zoneHost.getHeight);
party.polygons = zoneHost.current.scene.collision;
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
  icons: loadItemIcons(archive),
  portraits: portraitCanvases(parseBMX(archive.get('HEADS.BMX')), parsePalette(archive.get('OPTIONS.PAL'))),
});

// Zone music: the player resumes on the first gesture; M toggles mute. ?song=N overrides the zone song.
const music = createBrowserMusicPlayer({ volume: 0.7 });
void music.play(num('song', songForZone(start.zone))).catch((err) => console.warn('Music unavailable:', err));
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && !e.repeat) music.toggleMute();
});

let prevX = party.x;
let prevY = party.y;

// Encounters: dialogue and other triggers fire as the party walks into their rectangles.
// A finished dialogue applies its actions to the world and party, and may send the party elsewhere.
const objectItems = parseObjInfo(archive.get('OBJINFO.DAT')).items;
let partyState = partyFromSave(save);
let teleports: Destination[] = [];
let travelling = false;

const makeEncounters = async (zoneNumber: number, tiles: readonly (readonly [number, number])[], world: WorldState) => {
  const read = await prefetchResources(archive, encounterResourceNames(zoneNumber, tiles));
  const table = read('TELEPORT.DAT');
  teleports = table ? parseTeleports(table) : [];
  return new EncounterDriver(
    loadEncounterRunner({ read, zone: zoneNumber, tiles, chapter: start.chapter, world }),
    (view, done) => screens.showDialog(view.snippet, view.options.map((o) => o.label), (r) => r.kind !== 'none' && done(r)),
    {
      other: (e) => console.log('encounter (not run yet):', e.encounter.record.action, e.encounter.record),
      zone: (e) => void travelTo(e.transition),
      blocked: () => party.setPosition(prevX, prevY),
      finished: (ev, cancelled) => {
        const out = resolveDialogOutcome({
          session: ev.session, transition: ev.transition, cancelled, teleports, items: objectItems,
          party: partyState, world: encounters.runner.world,
        });
        partyState = out.party;
        clock.state = out.world;
        encounters.runner.setWorld(out.world);
        screens.setParty(partyState);
        if (out.ticksElapsed > 0) sky.update(clock.minutes);
        if (out.unhandled.length) console.log('dialogue actions with no effect yet:', out.unhandled.map((a) => a.name ?? a.type));
        if (out.warnings.length) console.warn(out.warnings);
        if (out.destination) void travelTo(out.destination);
      },
    },
  );
};

// Zone transitions and teleports: reload the zone scene when the zone changes, then place the party.
async function travelTo(d: Destination): Promise<void> {
  if (travelling) return;
  travelling = true;
  try {
    const plan = planTransition(zoneHost.current.zone, d);
    if (plan.hotspot !== undefined) console.log('teleport into a town scene (not run yet):', plan.hotspot);
    if (plan.reload) {
      const next = await zoneHost.switchTo(plan.zone);
      party.polygons = next.scene.collision;
      encounters = await makeEncounters(plan.zone, next.data.tiles, clock.state);
      void music.play(songForZone(plan.zone)).catch((err) => console.warn('Music unavailable:', err));
    }
    party.setPosition(plan.x, plan.y, plan.heading);
    prevX = plan.x;
    prevY = plan.y;
    encounters.runner.enterAt(plan.x, plan.y);
  } finally {
    travelling = false;
  }
}

let encounters = await makeEncounters(start.zone, zoneHost.current.data.tiles, clock.state);

// Post-processing: P cycles low/medium/high (?post=low|medium|high sets the start).
const post = createPost(renderer, scene, camera, parseQuality(new URLSearchParams(location.search).get('post'), 'medium'));
window.addEventListener('keydown', (e) => { if (e.code === 'KeyP' && !e.repeat) post.cycle(); });

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
    prevX = px;
    prevY = py;
    party.update(dt, screens.blocking ? NO_INPUT : partyKeys.read());
    if (party.x !== px || party.y !== py) {
      if (clock.walk(dt)) sky.update(clock.minutes);
    }
    party.applyToCamera(camera);
    if (!screens.blocking && !encounters.busy && !travelling) {
      // The clock owns the shared world state: hand it over for the check, take back the flags it set.
      encounters.runner.setWorld(clock.state);
      encounters.update(party.x, party.y);
      clock.state = encounters.runner.world;
    }
  }
  sky.followShadow(camera.position.x, camera.position.y, camera.position.z);
  post.render();

  frames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    fps = frames / fpsTime;
    frames = 0;
    fpsTime = 0;
  }
  const s = renderer.getDrawingBufferSize(new THREE.Vector2());
  hud.textContent = `${clock.label}  [ ] ±30 min  M: music ${music.isMuted ? 'off' : 'on'}  F: ${flyMode ? 'fly' : 'party'} cam  heading ${party.heading8}\n${zoneHost.current.info}\n${backend}  post ${post.quality} (P)  ${s.x}×${s.y}  ${fps.toFixed(0)} fps\npos ${camera.position.toArray().map((v) => v.toFixed(1)).join(', ')}`;
});
