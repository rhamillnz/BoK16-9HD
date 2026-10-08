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
import { layoutBook } from '../game/book';
import type { Book } from '../formats/book';
import '../ui/bookScreen'; // registers the book screen
import { mountHud } from '../ui/hud';

import { EncounterDriver, loadEncounterRunner } from '../game/encounterDriver';
import { makeDialogEnv } from '../game/dialogEnv';
import { resolveDialogOutcome } from '../game/dialogOutcome';
import { installContainers } from '../game/containerControls';
import { createShops } from '../game/shopControls';
import { createTownHost } from '../game/townHost';
import { CombatEncounters } from '../game/combatEncounter';
import { EncounterType } from '../formats/encounters';
import type { ItemDef } from '../formats/objinfo';
import { QUERY_YES, runDialogSession } from '../game/encounterRunner';
import { parseCombatTable } from '../combat/combatData';

import { syntheticArchive, syntheticFont, syntheticSave, syntheticZone } from './syntheticData';

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

const archive = syntheticArchive();

const runner = loadEncounterRunner({
  read: (name) => archive.has(name) ? archive.get(name) : undefined,
  zone: zone.zone,
  tiles: [[0, 0]],
  chapter: 1,
  world: clock.state,
  env: makeDialogEnv({
    getParty: () => partyState,
    zone: zone.zone,
    chapter: 1,
    extras: () => ({}),
    castSpell: () => false,
  }),
});

const objectItems = Array.from({length: 256}, (_, i) => ({
  index: i,
  name: i === 1 ? 'Sword' : 'Mock Item',
  flags: 0,
  level: 1,
  type: 0,
  baseValue: 10,
  conditionScale: 0,
  food: 0,
  spell: 0,
  modifies: 0
} as unknown as ItemDef));

const screens = mountHud(document.body, { font: syntheticFont(), save, items: [] });
screens.setPose({ x: party.x, y: party.y, heading: party.heading });
const mapBytes = new Uint8Array(ZONE_MAP_BYTES);
mapBytes[0] = 1;
screens.setMap(parseZoneMap(mapBytes), zone.zone);

const showView = (view: any, done: any) => screens.showDialog(view.snippet, view.options.map((o: any) => o.label), (r: any) => r.kind !== 'none' && done(r));

const town = createTownHost({
  shop: (ref) => shops.open(ref),
  fetch: async () => (name: string) => archive.get(name),
  hud: screens,
  get chapter() { return 1; },
  world: () => clock.state,
  playDialog: (key, done) => {
    encounters.runner.setWorld(clock.state);
    const session = encounters.runner.startDialog(key);
    runDialogSession(session, showView, (cancelled) => {
      encounters.runner.finish(session);
      done({ cancelled, endState: session.endOfDialogState, choice: session.lastChoice });
    });
  }
});

const shops = createShops({
  items: objectItems,
  scrollValues: Array(256).fill(100),
  saveBytes: save.bytes,
  hud: screens,
  getParty: () => partyState,
  setParty: (p) => { partyState = p; screens.setParty(p); },
  getWorld: () => clock.state,
  zone: () => zone.zone,
  playDialog: (key, done) => town.playDialog(key, done),
});

const combat = new CombatEncounters({
  scene,
  camera,
  canvas: renderer.domElement,
  getHeight: heightField.getHeight,
  support: { defs: parseCombatTable(archive.get('DEF_COMB.DAT') || new Uint8Array()), partyGrid: [], monsterNames: [], sprites: [], palette: new Uint8Array(256 * 3), save: save.bytes, archive },
  items: objectItems,
  spells: [],
  position: () => ({ x: party.x, y: party.y, heading: party.heading }),
  placeParty: (x, y, h) => { party.setPosition(x, y, h); prevX = x; prevY = y; encounters.runner.enterAt(x, y); },
  getParty: () => partyState,
  setParty: (p) => { partyState = p; screens.setParty(p); },
  markDone: (e) => { encounters.runner.complete(e); clock.state = encounters.runner.world; },
});

let prevX = party.x;
let prevY = party.y;

const encounters = new EncounterDriver(
  runner,
  showView,
  {
    other: (e) => {
      if (e.encounter.record.typeId === EncounterType.Combat) void combat.start(e.encounter);
    },
    town: (e) => {
      api.inTown = e.town.ref;
      void town.enter(e.town.ref);
    },
    zone: (e) => {
      api.transition = e.transition;
    },
    blocked: () => party.setPosition(prevX, prevY),
    finished: (ev, cancelled) => {
      const out = resolveDialogOutcome({
        session: ev.session,
        transition: ev.transition,
        cancelled,
        teleports: [],
        items: [],
        party: partyState,
        world: encounters.runner.world,
      });
      partyState = out.party;
      clock.state = out.world;
      encounters.runner.setWorld(out.world);
      screens.setParty(partyState);
      if (out.ticksElapsed > 0) sky.update(clock.minutes);
      
      if (!ev.town) {
        party.setPosition(prevX, prevY);
      } else if (!cancelled && ev.session.lastChoice === QUERY_YES) {
        api.inTown = ev.town.ref;
        void town.enter(ev.town.ref);
      } else {
        party.setPosition(prevX, prevY);
      }
    }
  }
);

await installContainers({
  archive,
  items: objectItems,
  get chapter() { return 1; },
  saveBytes: save.bytes,
  hud: screens,
  zone: () => zone.zone,
  position: () => ({ x: party.x, y: party.y }),
  getParty: () => partyState,
  setParty: (p) => { partyState = p; screens.setParty(p); },
  getWorld: () => clock.state,
  setWorld: (w) => { clock.state = w; encounters.runner.setWorld(w); },
  canInteract: () => !screens.blocking && !encounters.busy,
  modelName: () => undefined,
  playDialog: () => new Promise((done) => done()),
});

await installSaveControls({
  capture: () => ({
    savedAt: Date.now(),
    zone: zone.zone,
    x: party.x,
    y: party.y,
    heading: party.heading,
    world: clock.state,
    party: partyState,
  }),
  restore: async (d) => {
    clock.state = d.world;
    partyState = d.party;
    screens.setParty(partyState);
    party.setPosition(d.x, d.y, d.heading);
  },
  canQuickSave: () => !screens.blocking && !encounters.busy,
  setSaveHandler: (h) => {
    screens.saveHandler = h;
  },
});

let bookSpreads = 0;
let bookDone = 0;
let frames = 0;
let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  prevX = party.x; prevY = party.y;
  party.update(dt, screens.blocking || encounters.busy ? NO_INPUT : keys.read());
  if (!screens.blocking && !encounters.busy) { clock.walk(dt); encounters.runner.setWorld(clock.state); encounters.update(party.x, party.y); clock.state = encounters.runner.world; }
  party.applyToCamera(camera);
  screens.setPose({ x: party.x, y: party.y, heading: party.heading });
  sky.followShadow(camera.position.x, camera.position.y, camera.position.z);
  renderer.render(scene, camera);
  frames++;
});

const api = {
  backend,
  stats: zoneScene.stats,
  get frames() {
    return frames;
  },
  get pose() {
    return { x: party.x, y: party.y, heading: party.heading };
  },
  get screen() {
    return screens.screen;
  },
  inTown: null as any,
  transition: null as any,
  get gold() {
    return partyState.gold;
  },
  get ticks() {
    return clock.state.ticks;
  },
  /** Change something that is part of the save so a load visibly undoes it. */
  setGold(gold: number) {
    partyState = { ...partyState, gold };
  },
  /** True once the quick-save slot holds a save. */
  async quickSaved() {
    return (await screens.saveHandler!.list()).some((s) => s.slot === 'quick' && !!s.summary);
  },
  start: START,
  /** Time of day and the light spell, as the game's clock and spell effects drive them. */
  setMinutes(m: number) {
    sky.update(m);
  },
  setMagicLight(on: boolean) {
    sky.setMagicLight(on);
  },
  /** Point lights in the scene: how many are visible, and the strongest intensity. */
  get lights() {
    let visible = 0;
    let intensity = 0;
    scene.traverse((o) => {
      if (o instanceof THREE.PointLight && o.visible) {
        visible++;
        intensity = Math.max(intensity, o.intensity);
      }
    });
    return { visible, intensity };
  },
  /** Open the cutscene book viewer on a two-page synthetic book; `bookDone` counts finished readings. */
  openBook() {
    const page = (text: string) => ({
      x: 0,
      y: 0,
      width: 160,
      height: 32,
      displayNumber: 1,
      pageNumber: 1,
      previousPage: 0,
      nextPage: 0,
      showPageNumber: 0,
      reservedAreas: [],
      images: [],
      paragraphs: [
        {
          x: 0,
          y: 0,
          width: 100,
          lineSpacing: 0,
          wordSpacing: 0,
          startIndent: 0,
          alignment: 'left' as const,
          segments: [{ font: 1, yOffset: 0, color: 0, style: 1, text }],
        },
      ],
    });
    const book: Book = { pages: [page('AAAA BBBB'), page('CCCC DDDD')] };
    bookSpreads = layoutBook(book, syntheticFont()).length;
    screens.open('book', {
      book,
      images: [],
      done: () => {
        bookDone++;
        screens.end('book');
      },
    });
  },
  get bookSpreads() {
    return bookSpreads;
  },
  get bookDone() {
    return bookDone;
  },
  interact() {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
  },
  teleport(x: number, y: number, heading?: number) {
    party.setPosition(x, y, heading ?? party.heading);
  },
  activeEncounters(x: number, y: number) {
    return encounters.runner.update(x, y).map((e) => e.type);
  },
  debugEncounters() {
    return encounters.runner.o.map.tileEncounters(0, 0);
  }
};
(window as unknown as { __e2e: typeof api }).__e2e = api;
export type E2eApi = typeof api;
