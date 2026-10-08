import * as fs from 'fs';
let code = fs.readFileSync('src/e2e/harness.ts', 'utf8');

const imports = `
import { EncounterDriver, loadEncounterRunner } from '../game/encounterDriver';
import { makeDialogEnv } from '../game/dialogEnv';
import { resolveDialogOutcome } from '../game/dialogOutcome';
import { runDialogSession } from '../game/encounterRunner';
import { syntheticArchive } from './syntheticData';
`;

code = code.replace("import { syntheticFont, syntheticSave, syntheticZone } from './syntheticData';", imports + "\nimport { syntheticFont, syntheticSave, syntheticZone } from './syntheticData';");

const logic = `
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
    extras: [],
    castSpell: () => {},
  }),
});

let prevX = party.x;
let prevY = party.y;

const encounters = new EncounterDriver(
  runner,
  (view, done) => screens.showDialog(view.snippet, view.options.map(o => o.label), r => r.kind !== 'none' && done(r)),
  {
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
      
      party.setPosition(prevX, prevY);
    }
  }
);
`;

code = code.replace("const screens = mountHud(document.body, { font: syntheticFont(), save, items: [] });", logic + "\nconst screens = mountHud(document.body, { font: syntheticFont(), save, items: [] });");

code = code.replace("party.update(dt, screens.blocking ? NO_INPUT : keys.read());", "prevX = party.x; prevY = party.y;\n  party.update(dt, screens.blocking || encounters.busy ? NO_INPUT : keys.read());");
code = code.replace("if (!screens.blocking) clock.walk(dt);", "if (!screens.blocking && !encounters.busy) { clock.walk(dt); encounters.runner.setWorld(clock.state); encounters.update(party.x, party.y); clock.state = encounters.runner.world; }");
code = code.replace("canQuickSave: () => !screens.blocking,", "canQuickSave: () => !screens.blocking && !encounters.busy,");

fs.writeFileSync('src/e2e/harness.ts', code);
console.log('Done');
