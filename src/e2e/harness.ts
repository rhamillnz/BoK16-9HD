import * as THREE from 'three/webgpu';
import { createStage } from '../render/stage';
import { createSky, DOME_RADIUS } from '../render/sky';
import { buildZoneScene, collectTerrainTriangles } from '../render/zoneScene';
import { buildHeightField } from '../world/heightField';
import { NO_INPUT, PartyController, PartyKeyboard } from '../world/partyController';
import { GameClock } from '../game/clock';
import { partyFromSave } from '../game/party';
import { installSaveControls } from '../game/saveControls';
import { ZONE_MAP_BYTES, parseZoneMap } from '../formats/zoneMap';
import { mountHud } from '../ui/hud';
import { syntheticFont, syntheticSave, syntheticZone } from './syntheticData';

/**
 * End-to-end harness: the real stage, sky, zone scene, party controller, HUD and save controls,
 * fed with synthetic data instead of the original game files. Playwright drives it through the
 * keyboard and reads `window.__e2e`. See docs/e2e.md.
 */

const { renderer, camera, backend } = await createStage(document.getElementById('stage')!);
const scene = new THREE.Scene();
const sky = createSky(scene);
camera.near = 0.1;
camera.far = DOME_RADIUS * 4;
camera.updateProjectionMatrix();

const zone = syntheticZone();
const zoneScene = buildZoneScene(zone);
scene.add(zoneScene.group);
const heightField = buildHeightField(collectTerrainTriangles(zone));

const save = syntheticSave();
const clock = GameClock.forChapter(save, 1, 0);
sky.update(clock.minutes);

const START = { x: 0, y: -1200, heading: 0 };
const party = new PartyController(START.x, START.y, START.heading, heightField.getHeight);
party.polygons = zoneScene.collision;
const keys = new PartyKeyboard();
let partyState = partyFromSave(save);

const screens = mountHud(document.body, { font: syntheticFont(), save, items: [] });
screens.setPose({ x: party.x, y: party.y, heading: party.heading });
const mapBytes = new Uint8Array(ZONE_MAP_BYTES);
mapBytes[0] = 1; // tile (0, 0) is on the map
screens.setMap(parseZoneMap(mapBytes), zone.zone);

await installSaveControls({
  capture: () => ({ savedAt: Date.now(), zone: zone.zone, x: party.x, y: party.y, heading: party.heading, world: clock.state, party: partyState }),
  restore: async (d) => {
    clock.state = d.world;
    partyState = d.party;
    screens.setParty(partyState);
    party.setPosition(d.x, d.y, d.heading);
  },
  canQuickSave: () => !screens.blocking,
  setSaveHandler: (h) => { screens.saveHandler = h; },
});

let frames = 0;
let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  party.update(dt, screens.blocking ? NO_INPUT : keys.read());
  if (!screens.blocking) clock.walk(dt);
  party.applyToCamera(camera);
  screens.setPose({ x: party.x, y: party.y, heading: party.heading });
  sky.followShadow(camera.position.x, camera.position.y, camera.position.z);
  renderer.render(scene, camera);
  frames++;
});

const api = {
  backend,
  stats: zoneScene.stats,
  get frames() { return frames; },
  get pose() { return { x: party.x, y: party.y, heading: party.heading }; },
  get screen() { return screens.screen; },
  get gold() { return partyState.gold; },
  get ticks() { return clock.state.ticks; },
  /** Change something that is part of the save so a load visibly undoes it. */
  setGold(gold: number) { partyState = { ...partyState, gold }; },
  /** True once the quick-save slot holds a save. */
  async quickSaved() { return (await screens.saveHandler!.list()).some((s) => s.slot === 'quick' && !!s.summary); },
  start: START,
};
(window as unknown as { __e2e: typeof api }).__e2e = api;
export type E2eApi = typeof api;
