import { makeDialogEnv } from './dialogEnv';
import * as THREE from 'three/webgpu';
import { createStage } from '../render/stage';
import { FlyCamera } from '../render/flyCamera';
import { createPost } from '../render/post';
import { parseQuality } from '../render/postSettings';
import { createSky, DOME_RADIUS } from '../render/sky';
import { PartyController, NO_INPUT } from '../world/partyController';
import { DEBUG_TIME_STEP, GameClock } from './clock';
import { ResourceArchive } from '../formats/archive';
import { parseFNT } from '../formats/fnt';
import { parseFMapTowns, parseFMapXY, generateZoneNames } from '../formats/fullMap';
import { parseBMX } from '../formats/bmx';
import { parsePalette } from '../formats/palette';
import { parseGam } from '../formats/gam';
import { parseObjInfo } from '../formats/objinfo';
import { loadItemIcons } from '../data/itemIcons';
import {
  EncounterDriver,
  dialogFileName,
  encounterResourceNames,
  loadEncounterRunner,
  prefetchResources,
} from './encounterDriver';
import { mountHud } from '../ui/hud';
import { createBrowserMusicPlayer } from '../audio/music';
import {
  COMBAT_SONGS,
  EXPLORE_SONGS,
  SONG_TITLE,
  UNDERGROUND_SONGS,
  ZONE_SONGS,
  songFromSoundIndex,
} from '../audio/songs';
import { installSfx } from '../audio/sfxWiring';
import { portraitCanvases } from '../ui/partyBar';
import { speakerPortraitLoader } from '../ui/speakerPortraits';
import { clothingColors } from './npcLook';
import { roadEdgePoints } from '../render/grassGround';
import { WeatherAmbience } from '../audio/ambience';
import { Weather } from '../render/weather';
import { parseWeatherParam, WEATHER_KINDS, type WeatherKind } from '../render/weatherPlan';
import { TICKS_PER_DAY, hourOfDay } from './state';
import { isUndergroundZone } from '../world/underground';
import { NpcFigures } from '../render/npcFigures';
import { loadChapterStart } from '../world/zone';
import { warnIfOffMap } from './chapterStartCheck';
import { TILE_SIZE } from '../formats/world';
import { loadZoneMap } from '../formats/zoneMap';
import { ZoneHost } from './zoneHost';
import { CombatEncounters } from './combatEncounter';
import { loadCombatSupport } from './combatController';
import { EncounterType } from '../formats/encounters';
import { giveItem, partyFromSave } from './party';
import { resolveDialogOutcome } from './dialogOutcome';
import {
  entryPointForZone,
  parseTeleports,
  planTransition,
  type Destination,
  type ZoneTransition,
} from './transitions';
import { QUERY_YES, runDialogSession, type DialogSession, type ShowDialog } from './encounterRunner';
import { HotspotAction, gdsLetter, type TownEntry } from '../formats/gds';
import { createTownHost, townExit } from './townHost';
import type { PlacedEncounter } from '../world/encounters';
import type { WorldState } from './state';
import { installSaveControls } from './saveControls';
import { createInnHost } from './inn';
import { findShop, parseShopContainers } from '../formats/gdsContainers';
import { ruleFor } from './dialogEffects';
import { createNotice } from '../ui/notice';
import { installCamp } from './campControls';
import { installChestAmbushes } from './ambushes';
import { installContainers } from './containerControls';
import { installItemControls } from './itemControls';
import { installTempleControls } from './templeControls';
import { installCast, justCast } from './castControls';
import { parseSpells } from '../formats/spells';
import { createShops } from './shopControls';
import { installChapters, loadDialogStore } from './chapterControls';
import { LAST_CHAPTER } from './chapters';
import { installJournal } from './journalControls';
import { installPerf } from '../render/perf';
import { installBookPlayer } from './bookControls';
import { installCutscenes } from './cutsceneControls';
import { overheadPolygons } from '../world/overheadMap';
import { installUnderground } from './undergroundMode';
import { pointInPolygon } from '../world/collision';
import { currentLight } from './spells';
import { installMainMenu } from './mainMenuControls';
import { DEFAULT_SETTINGS } from './mainMenu';
import { loadTitleArt } from './titleArt';
import { ensureGameData } from '../ui/dataPicker';
import { GameDataError, installBootScreen } from '../ui/bootScreen';
import { drawTitleScreen, layoutTitle } from '../ui/titleScreen';
import { installInput } from './inputControls';
import { loadZone } from '../world/zone';
import type { JumpMapScreen } from '../ui/jumpMapScreen';

const stageEl = document.getElementById('stage')!;
const hud = document.getElementById('hud')!;
const boot = installBootScreen(); // loading and error screens
boot.loading('Starting graphics…');

const { renderer, camera, backend } = await createStage(stageEl);
boot.backend(backend);
const scene = new THREE.Scene();
const sky = createSky(scene);

// World units: 1 unit = 100 game units.
camera.near = 0.1;
camera.far = DOME_RADIUS * 4;
camera.updateProjectionMatrix();

// Original game data, served by the dev server from the local install (see vite.config.ts).
await ensureGameData(); // standalone build: folder picker + OPFS cache
boot.loading('Loading game data…', 0.2);
const [rmf, data] = await Promise.all([fetch('/bak/KRONDOR.RMF'), fetch('/bak/KRONDOR.001')]);
if (!rmf.ok || !data.ok) throw new GameDataError(rmf.ok ? 'KRONDOR.001' : 'KRONDOR.RMF', (rmf.ok ? data : rmf).status);
const archive = new ResourceArchive(new Uint8Array(await rmf.arrayBuffer()), new Uint8Array(await data.arrayBuffer()));
// Debug: ?zone=N starts in zone N at the centre of its first tile; ?x=&y=&h= (BaK units,
// 8-bit heading) override the start position.
const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
// ?chapter=N loads that chapter's start up front, so the party spawns at the real start position and no
// teleport races the scene load; the chapter transition (flags, items, start script) runs once the game is wired.
const debugChapter = Math.min(LAST_CHAPTER, Math.max(1, Math.trunc(num('chapter', 1)) || 1));
const chapterStart = {
  ...loadChapterStart(archive, debugChapter),
  timeElapsed: loadChapterStart(archive, 1).timeElapsed,
};
const startZone = num('zone', chapterStart.zone);
// The title screen's art behind the loading bar while the world is built.
const titleArt = loadTitleArt(archive);
try {
  const titleFont = parseFNT(archive.get('GAME.FNT'));
  boot.backdrop((ctx, width, height) => {
    const layout = layoutTitle(width, height);
    drawTitleScreen(ctx, titleFont, titleArt, layout, 10, width, height);
    return layout.menuTop / height;
  });
} catch (err) {
  console.warn('Loading screen art unavailable:', err);
}
boot.loading('Building the world…', 0.5);
const zoneHost = await ZoneHost.create(scene, archive, startZone);
const [firstTileX, firstTileY] = zoneHost.current.data.tiles[0] ?? [0, 0];
const entry =
  startZone === chapterStart.zone || !archive.has('TELEPORT.DAT')
    ? undefined
    : entryPointForZone(startZone, parseTeleports(archive.get('TELEPORT.DAT')));
const start =
  startZone === chapterStart.zone
    ? chapterStart
    : entry
      ? { ...chapterStart, zone: startZone, x: entry.x, y: entry.y, heading: entry.heading }
      : { ...chapterStart, zone: startZone, x: (firstTileX + 0.5) * TILE_SIZE, y: (firstTileY + 0.5) * TILE_SIZE };

// Game clock: the world state starts at the chapter's CHAP time; [ and ] step it by 30 minutes.
const startup = await fetch('/bak/STARTUP.GAM');
if (!startup.ok) throw new GameDataError('STARTUP.GAM', startup.status);
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
const tickPerf = installPerf(renderer, scene);

// Weather: a seeded schedule per zone and time (mostly clear); ?weather=rain|drizzle|mist|clear or F8 forces one.
const weather = new Weather(scene);
weather.force(parseWeatherParam(new URLSearchParams(location.search).get('weather')));
window.addEventListener('keydown', (e) => {
  if (e.code !== 'F8' || e.repeat) return;
  e.preventDefault();
  const order: (WeatherKind | undefined)[] = [undefined, ...WEATHER_KINDS];
  weather.force(order[(order.indexOf(weather.forcedKind) + 1) % order.length]);
});
const updateUnderground = installUnderground(sky, party);
const fly = new FlyCamera(camera, renderer.domElement);
fly.speed = 20; // world units per second
let flyMode = false;
// Rebindable keys, gamepad, mouse-look, field of view and UI scale (Options in the main menu).
const partyKeys = installInput({
  party,
  camera,
  canvas: renderer.domElement,
  blocking: () => screens.blocking,
  combatActive: () => combat.active,
  flyMode: () => flyMode,
});
party.applyToCamera(camera);
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyF' || e.repeat) return;
  flyMode = !flyMode;
  fly.enabled = flyMode;
  if (flyMode) {
    fly.setHeading(camera.rotation.y);
  } else {
    document.exitPointerLock();
  }
  partyKeys.clear();
});

// Testing aid: G toggles 10x walking speed (`?speed=N` starts with N).
const SPRINT = 10;
party.sprint = Math.max(1, num('speed', 1)) || 1;
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyG' || e.repeat || screens.blocking || combat.active) return;
  party.sprint = party.sprint > 1 ? 1 : SPRINT;
});

// HUD screens: I inventory, C character sheet, Esc closes; movement is ignored while one is open.
const screens = mountHud(document.body, {
  font: parseFNT(archive.get('GAME.FNT')),
  save,
  items: parseObjInfo(archive.get('OBJINFO.DAT')).items,
  icons: loadItemIcons(archive),
  portraits: portraitCanvases(parseBMX(archive.get('HEADS.BMX')), parsePalette(archive.get('OPTIONS.PAL'))),
  speakerPortrait: speakerPortraitLoader(archive),
});

screens.setMap(
  loadZoneMap(archive, start.zone, zoneHost.current.data.tiles),
  start.zone,
  overheadPolygons(zoneHost.current.data),
); // Tab: map screen + compass

// Jump map screen (F7): debug tool to teleport to any zone/tile
const jumpMapScreen = screens.screenHandler<JumpMapScreen>('jumpmap');
let zoneNamesCache: string[] | undefined;
jumpMapScreen.setCallbacks(
  async (zone: number) => {
    const zoneData = loadZone(archive, zone);
    return { map: loadZoneMap(archive, zone, zoneData.tiles), tiles: zoneData.tiles };
  },
  (d: Destination) => void travelTo(d),
  async () => {
    if (!zoneNamesCache) {
      const towns = parseFMapTowns(archive.get('FMAP_TWN.DAT'));
      const zones = parseFMapXY(archive.get('FMAP_XY.DAT'));
      zoneNamesCache = generateZoneNames(towns, zones);
    }
    return zoneNamesCache;
  },
);

// Zone music: the player resumes on the first gesture; M toggles mute. ?song=N overrides the zone song.
const music = createBrowserMusicPlayer({ volume: DEFAULT_SETTINGS.volume });
/** Exploring music: `?song=N` loops file N, a zone with its own song loops that, otherwise the rotation. */
const zoneMusic = (zone: number): void => {
  const forced = new URLSearchParams(location.search).get('song');
  const own = forced !== null ? Number(forced) : ZONE_SONGS[zone];
  const started =
    own !== undefined
      ? music.play(own)
      : music.playRotation(
          isUndergroundZone(zone) ? UNDERGROUND_SONGS : EXPLORE_SONGS,
          Math.floor(Math.random() * EXPLORE_SONGS.length),
        );
  void started.catch((err) => console.warn('Music unavailable:', err));
};
zoneMusic(start.zone);
/** Whether the fight music is on; the frame loop switches it with `combat.active`. */
let combatMusic = false;
const updateCombatMusic = (active: boolean): void => {
  if (active === combatMusic) return;
  combatMusic = active;
  if (!active) return zoneMusic(zoneHost.current.zone);
  const song = COMBAT_SONGS[Math.floor(Math.random() * COMBAT_SONGS.length)]!;
  void music.play(song).catch((err) => console.warn('Music unavailable:', err));
};
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && !e.repeat) {
    music.toggleMute();
    ambience.setMuted(music.isMuted);
  }
});
const ambience = new WeatherAmbience(); // synthesised rain and wind, scaled by the weather; M mutes it with the music
installSfx({ onSong: (song) => void music.play(song, true).catch((err) => console.warn('Song unavailable:', err)) }); // sound effects from frp.sx; other modules play through src/audio/sfxBus.ts
installJournal({ hud: screens, zone: () => zoneHost.current.zone }); // J: dialogue lines seen

let prevX = party.x;
let prevY = party.y;

// Encounters: dialogue and other triggers fire as the party walks into their rectangles.
// A finished dialogue applies its actions to the world and party, and may send the party elsewhere.
const objectItems = parseObjInfo(archive.get('OBJINFO.DAT')).items;
let partyState = partyFromSave(save);
let teleports: Destination[] = [];
let travelling = false;

const showView: ShowDialog = (view, done) =>
  screens.showDialog(
    { ...view.snippet, speaker: view.speaker },
    view.options.map((o) => o.label),
    (r) => r.kind !== 'none' && done(r),
  );

// A finished dialogue (from the world or a town scene): apply its effects and move the party if it asks.
const applyDialog = (session: DialogSession, transition: ZoneTransition | undefined, cancelled: boolean) => {
  const out = resolveDialogOutcome({
    session,
    transition,
    cancelled,
    teleports,
    items: objectItems,
    party: partyState,
    world: encounters.runner.world,
  });
  partyState = out.party;
  clock.state = out.world;
  encounters.runner.setWorld(out.world);
  screens.setParty(partyState);
  if (out.ticksElapsed > 0) sky.update(clock.minutes);
  if (out.unhandled.length)
    console.log(
      'dialogue actions with no effect yet:',
      out.unhandled.map((a) => a.name ?? a.type),
    );
  if (out.warnings.length) console.warn(out.warnings);
  if (out.destination) {
    town.dismiss();
    void travelTo(out.destination);
  }
  void chapters.afterDialog();
};

// Shops: buy, sell and haggle at shop hotspots of town scenes.
const shops = createShops({
  items: objectItems,
  scrollValues: parseObjInfo(archive.get('OBJINFO.DAT')).scrollValues,
  saveBytes: save.bytes,
  hud: screens,
  getParty: () => partyState,
  setParty: (p) => {
    partyState = p;
    screens.setParty(p);
  },
  getWorld: () => clock.state,
  zone: () => zoneHost.current.zone,
  playDialog: (key, done) => town.playDialog(key, done),
});

// Inns: the innkeeper's offer, then nights of rest (see docs/formats/inns.md).
const gdsContainers = parseShopContainers(save.bytes);
const inns = createInnHost({
  stats: (ref) => findShop(gdsContainers, ref)?.stats,
  chapter: () => start.chapter,
  world: () => clock.state,
  setWorld: (w) => {
    clock.state = w;
    encounters.runner.setWorld(w);
    sky.update(clock.minutes);
  },
  party: () => partyState,
  setParty: (p) => {
    partyState = p;
    screens.setParty(p);
  },
  playDialog: (key, done) => town.playDialog(key, done),
  itemRule: (i) => ruleFor(objectItems, i),
  notify: createNotice(),
});

// Town and temple scenes: a 2D screen on the HUD whose hotspots open dialogues.
const town = createTownHost({
  shop: (ref) => shops.open(ref),
  fetch: (names) => prefetchResources(archive, names),
  hud: screens,
  get chapter() {
    return start.chapter;
  },
  world: () => clock.state,
  playDialog: (key, done) => {
    encounters.runner.setWorld(clock.state);
    const session = encounters.runner.startDialog(key);
    runDialogSession(session, showView, (cancelled) => {
      encounters.runner.finish(session);
      applyDialog(session, undefined, cancelled);
      done({ cancelled, endState: session.endOfDialogState, choice: session.lastChoice });
    });
  },
  inn: (ref) => inns.enter(ref),
  // Towns, temples, taverns and shops play the song their scene names (KRONDOR, TEMPLE, MDHAPPY, ...).
  song: (index) => {
    const song = songFromSoundIndex(index);
    if (song !== null) void music.play(song).catch((err) => console.warn('Music unavailable:', err));
  },
  closed: () => zoneMusic(zoneHost.current.zone),
});

// Entering a town: the party stands at the entry's exit position outside the door, then the scene opens.
const enterTown = async (e: PlacedEncounter, t: TownEntry) => {
  await town.enter(t.ref, t.exitDialog);
  if (!town.active) return;
  const exit = townExit(t, e.tileX, e.tileY);
  party.setPosition(exit.x, exit.y, exit.heading);
  prevX = exit.x;
  prevY = exit.y;
  encounters.runner.enterAt(exit.x, exit.y);
};

const spellDefs = archive.has('SPELLS.DAT') ? parseSpells(archive.get('SPELLS.DAT')) : [];

// Combat encounters: a fight on the combat grid, then wounds applied and the encounter marked done (or a retreat).
const combat = new CombatEncounters({
  scene,
  camera,
  canvas: renderer.domElement,
  getHeight: zoneHost.getHeight,
  blocked: (x, y) =>
    zoneHost.current.scene.collision.some(
      (p) => x >= p.minX && x <= p.maxX && y >= p.minY && y <= p.maxY && pointInPolygon(p, x, y),
    ),
  surface: zoneHost.surfaceHeight,
  support: await loadCombatSupport(archive, save.bytes),
  items: objectItems,
  spells: spellDefs,
  position: () => ({ x: party.x, y: party.y, heading: party.heading8 }),
  placeParty: (x, y, h) => {
    party.setPosition(x, y, h);
    prevX = x;
    prevY = y;
    encounters.runner.enterAt(x, y);
  },
  getParty: () => partyState,
  setParty: (p) => {
    partyState = p;
    screens.setParty(p);
  },
  markDone: (e) => {
    encounters.runner.setWorld(clock.state);
    encounters.runner.complete(e);
    clock.state = encounters.runner.world;
  },
});

const makeEncounters = async (zoneNumber: number, tiles: readonly (readonly [number, number])[], world: WorldState) => {
  const read = await prefetchResources(archive, encounterResourceNames(zoneNumber, tiles));
  const table = read('TELEPORT.DAT');
  teleports = table ? parseTeleports(table) : [];
  return new EncounterDriver(
    loadEncounterRunner({
      read,
      zone: zoneNumber,
      tiles,
      chapter: start.chapter,
      world,
      env: makeDialogEnv({
        getParty: () => partyState,
        zone: zoneNumber,
        chapter: start.chapter,
        extras: shops.textExtras,
        castSpell: (n) => justCast(n, clock.state.ticks),
      }),
    }),
    showView,
    {
      other: (e) => {
        if (e.encounter.record.typeId === EncounterType.Combat) void combat.start(e.encounter);
        else console.log('encounter (not run yet):', e.encounter.record.action, e.encounter.record);
      },
      zone: (e) => void travelTo(e.transition),
      town: (e) => void enterTown(e.encounter, e.town),
      blocked: () => party.setPosition(prevX, prevY),
      finished: (ev, cancelled) => {
        applyDialog(ev.session, ev.transition, cancelled);
        if (!ev.town) return;
        if (!cancelled && ev.session.lastChoice === QUERY_YES) void enterTown(ev.encounter, ev.town);
        else party.setPosition(prevX, prevY);
      },
    },
  );
};

// Zone transitions and teleports: reload the zone scene when the zone changes, then place the party.
async function travelTo(d: Destination): Promise<void> {
  if (travelling) return;
  travelling = true;
  try {
    const plan = planTransition(zoneHost.current.zone, d, { x: party.x, y: party.y, heading: party.heading });
    if (plan.reload) {
      boot.loading(`Loading zone ${plan.zone}…`);
      const next = await zoneHost.switchTo(plan.zone);
      party.polygons = next.scene.collision;
      next.grass.setQuality(post.quality);
      screens.setMap(loadZoneMap(archive, plan.zone, next.data.tiles), plan.zone, overheadPolygons(next.data));
      encounters = await makeEncounters(plan.zone, next.data.tiles, clock.state);
      zoneMusic(plan.zone);
    }
    party.setPosition(plan.x, plan.y, plan.heading);
    prevX = plan.x;
    prevY = plan.y;
    encounters.runner.enterAt(plan.x, plan.y);
    if (plan.hotspot !== undefined) void town.enter({ number: plan.hotspot, letter: gdsLetter(plan.hotspotChar ?? 0) });
  } finally {
    boot.done();
    travelling = false;
  }
  if (d.zone !== undefined) autosave();
}
let autosave = (): void => {}; // set once the save controls are installed

let encounters = await makeEncounters(start.zone, zoneHost.current.data.tiles, clock.state);

// Standing figures at NPC dialogue encounters, tinted from the actor's portrait.
const npcPortrait = speakerPortraitLoader(archive);
const npcRoadPoints = () => roadEdgePoints(zoneHost.current.data).map(([x, z]) => [x * 100, -z * 100] as const);
const npcFigures = new NpcFigures(scene, (actor) => {
  const c = npcPortrait(actor);
  const ctx = c?.getContext('2d');
  if (!c || !ctx) return undefined;
  return clothingColors(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
});

// Save and load: F5 quick-save, F9 quick-load, F6 slot screen, and the autosave.
let cutsceneActive = () => false; // the cutscene player is installed further down
const saves = await installSaveControls({
  capture: () => ({
    savedAt: Date.now(),
    zone: zoneHost.current.zone,
    x: party.x,
    y: party.y,
    heading: party.heading,
    world: clock.state,
    party: partyState,
    shops: shops.snapshot(),
  }),
  restore: async (d) => {
    shops.restore(d.shops);
    clock.state = d.world;
    partyState = d.party;
    screens.setParty(partyState);
    sky.update(clock.minutes);
    await travelTo({ zone: d.zone, tileX: 0, tileY: 0, x: d.x, y: d.y, heading: d.heading });
  },
  canQuickSave: () => !screens.blocking && !encounters.busy && !travelling && !combat.active && !cutsceneActive(),
  setSaveHandler: (h) => {
    screens.saveHandler = h;
  },
});
autosave = () => void saves.autosave();

// Camping: R rests with healing, rations and time passing.
installCamp({
  items: objectItems,
  getParty: () => partyState,
  setParty: (p) => {
    partyState = p;
    screens.setParty(p);
  },
  getWorld: () => clock.state,
  setWorld: (w) => {
    clock.state = w;
    encounters.runner.setWorld(w);
  },
  canCamp: () => !screens.blocking && !encounters.busy && !travelling && !combat.active && !town.active && !flyMode,
  menu: (text, choices) =>
    new Promise((resolve) =>
      screens.showDialog({ text, displayStyle3: 0 }, choices, (r) => resolve(r.kind === 'choose' ? r.index : -1)),
    ),
  onTimePassed: () => sky.update(clock.minutes),
});
installItemControls({
  items: objectItems,
  spells: spellDefs,
  getParty: () => partyState,
  setParty: (p) => {
    partyState = p;
    screens.setParty(p);
  },
  setItemHandler: (h) => {
    screens.itemHandler = h;
  },
});

// ?screen=inventory (or sheet, map...) opens a HUD screen once the game is up; used by screenshot scripts.
const openScreen = q.get('screen');
if (openScreen) setTimeout(() => screens.open(openScreen), 4000);

// Spells: V casts healing and light spells outside combat (combat casting lives in the fight panel, C).
const cast = installCast({
  spells: spellDefs,
  getParty: () => partyState,
  setParty: (p) => {
    partyState = p;
    screens.setParty(p);
  },
  getTicks: () => clock.state.ticks,
  canCast: () => !screens.blocking && !encounters.busy && !travelling && !combat.active && !town.active && !flyMode,
  menu: (text, choices) =>
    new Promise((resolve) =>
      screens.showDialog({ text, displayStyle3: 0 }, choices, (r) => resolve(r.kind === 'choose' ? r.index : -1)),
    ),
});

// Temples: cure, bless and teleport at temple hotspots.
installTempleControls({
  town: town.controller,
  screens,
  items: objectItems,
  saveBytes: save.bytes,
  getParty: () => partyState,
  setParty: (p) => {
    partyState = p;
    screens.setParty(p);
  },
  getWorld: () => clock.state,
  setWorld: (w) => {
    clock.state = w;
    encounters.runner.setWorld(w);
  },
  playDialog: (key, done) => town.playDialog(key, done),
  teleportLayout: archive.has('REQ_TELE.DAT') ? archive.get('REQ_TELE.DAT') : undefined,
  travel: (i) => {
    const d = teleports[i];
    if (d) void travelTo(d);
  },
});

// Chests and containers: E opens the one the party stands next to (locks, riddles, traps, take and put).
// Remake-only fights at chests (ambushes.ts): the first chest near the start is watched by moredhel.
const chestAmbush = installChestAmbushes({
  menu: (text, choices) =>
    new Promise((resolve) =>
      screens.showDialog({ text, displayStyle3: 0 }, choices, (r) => resolve(r.kind === 'choose' ? r.index : -1)),
    ),
  fight: (n) => combat.ambush(n),
  give: (item, quantity) => {
    const r = giveItem(partyState, item, quantity, ruleFor(objectItems, item));
    if (r.lost) return false;
    partyState = r.party;
    screens.setParty(partyState);
    return true;
  },
});
const containerStore = await installContainers({
  beforeOpen: chestAmbush,
  archive,
  items: objectItems,
  get chapter() {
    return start.chapter;
  },
  saveBytes: save.bytes,
  hud: screens,
  zone: () => zoneHost.current.zone,
  position: () => ({ x: party.x, y: party.y }),
  getParty: () => partyState,
  setParty: (p) => {
    partyState = p;
    screens.setParty(p);
  },
  getWorld: () => clock.state,
  setWorld: (w) => {
    clock.state = w;
    encounters.runner.setWorld(w);
  },
  canInteract: () => !screens.blocking && !encounters.busy && !travelling && !combat.active && !town.active && !flyMode,
  modelName: (model) => zoneHost.current.data.table.names[model],
  playDialog: (key) =>
    new Promise<void>((done) => {
      encounters.runner.setWorld(clock.state);
      const session = encounters.runner.startDialog(key);
      runDialogSession(session, showView, (cancelled) => {
        encounters.runner.finish(session);
        applyDialog(session, undefined, cancelled);
        done();
      });
    }),
});

// Cutscenes: ADS/TTM animations full screen (?cutscene=CHAPTER1.ADS,CHAPTER1.TTM plays one at start).
const cutscenes = installCutscenes({
  fetch: (names) => prefetchResources(archive, names),
  hud: screens,
  chapter: () => start.chapter,
  music,
  ...installBookPlayer({ fetch: (names) => prefetchResources(archive, names), hud: screens }),
});
cutsceneActive = () => cutscenes.active;

// Chapter transitions: a dialogue or chapter-end hotspot ends the chapter (cutscenes, reset, start script, new start).
const chapters = installChapters({
  items: objectItems,
  containers: containerStore,
  getParty: () => partyState,
  setParty: (p) => {
    partyState = p;
    screens.setParty(p);
  },
  getWorld: () => clock.state,
  setWorld: (w) => {
    clock.state = w;
    encounters.runner.setWorld(w);
  },
  playCutscenes: async (from, to) => {
    await cutscenes.playChapterFinish(from);
    await cutscenes.playChapterStart(to);
  },
  loadStart: (n) => loadChapterStart(archive, n),
  loadStore: async () =>
    loadDialogStore(
      await prefetchResources(
        archive,
        Array.from({ length: 32 }, (_, n) => dialogFileName(n)),
      ),
    ),
  showText: (key) =>
    new Promise<void>((done) => {
      const session = encounters.runner.startDialog(key);
      runDialogSession(session, showView, () => done());
    }),
  arrive: async (c, teleport) => {
    town.dismiss();
    while (travelling) await new Promise((r) => setTimeout(r, 16)); // travelTo ignores calls while one runs
    start.chapter = c.chapter;
    encounters = await makeEncounters(zoneHost.current.zone, zoneHost.current.data.tiles, clock.state);
    await travelTo({ zone: c.zone, tileX: c.tileX, tileY: c.tileY, x: c.x, y: c.y, heading: c.heading });
    warnIfOffMap(c, zoneHost.current.data.tiles, teleport);
    if (teleport !== undefined && teleports[teleport]) await travelTo(teleports[teleport]!);
  },
  onTransitioned: () => sky.update(clock.minutes),
});
town.controller.handle(HotspotAction.ChapterEnd, ({ done }) => void chapters.begin().finally(done));
if (debugChapter > 1) {
  await new Promise<void>(
    (placed) =>
      void chapters
        .begin(debugChapter, { cutscenes: false, arriveFirst: true, onArrived: placed })
        .then((ok) => ok || placed()),
  );
}

// Graphics quality: P cycles low/medium/high (?post=low|medium|high sets the start). One setting
// drives post-processing, sun shadows (off on low) and grass density, and is shown briefly on screen.
const post = createPost(
  renderer,
  scene,
  camera,
  parseQuality(new URLSearchParams(location.search).get('post'), 'medium'),
);
const toast = Object.assign(document.createElement('div'), { id: 'toast' });
Object.assign(toast.style, {
  position: 'absolute',
  top: '12%',
  left: '50%',
  transform: 'translateX(-50%)',
  padding: '10px 22px',
  background: 'rgba(20,16,10,0.75)',
  border: '2px solid #c9a24a',
  color: '#f3e6c4',
  font: '600 22px system-ui, sans-serif',
  borderRadius: '6px',
  pointerEvents: 'none',
  transition: 'opacity 0.4s',
  opacity: '0',
});
document.body.append(toast);
let toastTimer = 0;
const applyGraphics = (announce: boolean) => {
  const q = post.quality;
  sky.setShadows(q !== 'low');
  zoneHost.current.grass.setQuality(q);
  if (!announce) return;
  const detail = {
    low: 'no post-processing, no shadows, sparse grass',
    medium: 'bloom + colour grade, shadows, normal grass',
    high: 'adds ambient occlusion, dense grass',
  }[q];
  toast.textContent = `Graphics: ${q.toUpperCase()} - ${detail}`;
  toast.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.style.opacity = '0'), 2200);
};
applyGraphics(false);
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyP' && !e.repeat) {
    post.cycle();
    applyGraphics(true);
  }
});

// Main menu: shown at start and on Escape (new game, continue, load, options).
installMainMenu({
  screens,
  music,
  post,
  applyGraphics,
  titleArt,
  canOpen: () => !encounters.busy && !travelling && !combat.active && !flyMode && !cutscenes.active,
  titleSong: SONG_TITLE,
  startGameMusic: () => zoneMusic(zoneHost.current.zone),
  playIntro: () => cutscenes.playIntro(),
});

let last = performance.now();
let frames = 0;
let fpsTime = 0;
let fps = 0;
boot.done();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  updateUnderground(zoneHost.current.zone, currentLight(cast.lights, clock.state.ticks) !== undefined);
  if (flyMode) {
    fly.update(dt);
  } else {
    const px = party.x;
    const py = party.y;
    prevX = px;
    prevY = py;
    party.update(dt, screens.blocking || combat.active ? NO_INPUT : partyKeys.read());
    if (party.x !== px || party.y !== py) {
      if (clock.walk(dt)) sky.update(clock.minutes);
    }
    combat.update(dt);
    updateCombatMusic(combat.active);
    if (combat.active) combat.applyCamera();
    else party.applyToCamera(camera);
    screens.setPose({ x: party.x, y: party.y, heading: party.heading });
    if (!screens.blocking && !encounters.busy && !travelling && !combat.active) {
      // The clock owns the shared world state: hand it over for the check, take back the flags it set.
      encounters.runner.setWorld(clock.state);
      encounters.update(party.x, party.y);
      clock.state = encounters.runner.world;
    }
    npcFigures.update(encounters.runner, zoneHost.getHeight, npcRoadPoints, party.x, party.y);
  }
  weather.schedule(
    zoneHost.current.zone,
    Math.floor(clock.state.ticks / TICKS_PER_DAY),
    hourOfDay(clock.state.ticks),
    isUndergroundZone(zoneHost.current.zone),
  );
  weather.update(dt);
  sky.setOvercast(weather.overcast);
  ambience.update(weather.amounts, isUndergroundZone(zoneHost.current.zone));
  tickPerf(camera, dt);
  sky.followShadow(camera.position.x, camera.position.y, camera.position.z);
  // Full-screen cutscenes and books cover the world: don't draw it underneath (it stalled the intro while the
  // world's shaders compiled on its first frames).
  if (!cutscenes.active) post.render();

  frames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    fps = frames / fpsTime;
    frames = 0;
    fpsTime = 0;
  }
  const s = renderer.getDrawingBufferSize(new THREE.Vector2());
  hud.textContent = `${clock.label}  [ ] ±30 min  M: music ${music.isMuted ? 'off' : `on (${music.songId ?? '-'})`}  F: ${flyMode ? 'fly' : 'party'} cam  G: speed x${party.sprint}  heading ${party.heading8}\n${zoneHost.current.info}\n${backend}  post ${post.quality} (P)  ${s.x}×${s.y}  ${fps.toFixed(0)} fps\npos ${camera.position
    .toArray()
    .map((v) => v.toFixed(1))
    .join(', ')}`;
});
