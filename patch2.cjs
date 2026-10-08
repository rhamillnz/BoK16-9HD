const fs = require('fs');
let code = fs.readFileSync('src/e2e/harness.ts', 'utf8');
const imports = `import { installContainers } from '../game/containerControls';
import { createShops } from '../game/shopControls';
import { createTownHost } from '../game/townHost';
import { CombatEncounters } from '../game/combatEncounter';
import { EncounterType } from '../formats/encounters';
import type { ItemDef } from '../formats/objinfo';
import { QUERY_YES, runDialogSession } from '../game/encounterRunner';`;
code = code.replace(`import { resolveDialogOutcome } from '../game/dialogOutcome';`, `import { resolveDialogOutcome } from '../game/dialogOutcome';\n` + imports);

// We want to add setup code just before 'let prevX'.
const setup = `
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
  fetch: async (names) => (name) => archive.get(name),
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
  support: { defs: [], partyGrid: [], mnames: [], bnames: [], layout: [], palette: new Uint8Array(256 * 3) },
  items: objectItems,
  spells: [],
  position: () => ({ x: party.x, y: party.y, heading: party.heading }),
  placeParty: (x, y, h) => { party.setPosition(x, y, h); prevX = x; prevY = y; encounters.runner.enterAt(x, y); },
  getParty: () => partyState,
  setParty: (p) => { partyState = p; screens.setParty(p); },
  markDone: (e) => { encounters.runner.complete(e); clock.state = encounters.runner.world; },
});

const containerStore = await installContainers({
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
  playDialog: (key) => new Promise((done) => done()),
});
keys.onAction = (action) => {
  if (action === 'use') void containerStore.interact();
};
`;

code = code.replace('let prevX = party.x;', setup + '\nlet prevX = party.x;');

const hooksRe = /const encounters = new EncounterDriver\([\s\S]*?finished: \(ev, cancelled\) => \{[\s\S]*?\}\n  \}\n\);/;

const newHooks = `const encounters = new EncounterDriver(
  runner,
  showView,
  {
    other: (e) => {
      if (e.encounter.record.typeId === EncounterType.Combat) void combat.start(e.encounter);
    },
    town: (e) => {
      api.inTown = e.town.ref;
      void town.enter(e.town.ref.number, e.town.ref.letter);
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
        void town.enter(ev.town.ref.number, ev.town.ref.letter);
      } else {
        party.setPosition(prevX, prevY);
      }
    }
  }
);`;
code = code.replace(hooksRe, newHooks);

const rm1 = 'const screens = mountHud(document.body, { font: syntheticFont(), save, items: [] });\n';
const rm2 = 'screens.setPose({ x: party.x, y: party.y, heading: party.heading });\n';
const rm3 = 'const mapBytes = new Uint8Array(ZONE_MAP_BYTES);\nmapBytes[0] = 1; // tile (0, 0) is on the map\nscreens.setMap(parseZoneMap(mapBytes), zone.zone);\n';

code = code.replace(rm1, '');
code = code.replace(rm2, '');
code = code.replace(rm3, '');

code = code.replace('get gold() {', 'inTown: null as any,\n  transition: null as any,\n  get gold() {');

fs.writeFileSync('src/e2e/harness.ts', code);
