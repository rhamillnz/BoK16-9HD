import * as fs from 'fs';
let main = fs.readFileSync('src/game/main.ts', 'utf8');

const importsToAdd = `
import { setupEncounters } from './setup/encounters';
import { gdsLetter } from '../formats/gds';
import { planTransition } from './transitions';
import { HotspotAction } from '../formats/gds';
`;

main = main.replace("import { setupGraphics } from './setup/graphics';", importsToAdd + "import { setupGraphics } from './setup/graphics';");

const extractStart = main.indexOf('let prevX = party.x;');
const extractEnd = main.indexOf('// Save and load: F5 quick-save, F9 quick-load, F6 slot screen.');

const replacement = `
  const encSetup = await setupEncounters({
    archive,
    saveBytes: save.bytes,
    objectItems: parseObjInfo(archive.get('OBJINFO.DAT')).items,
    partyState: partyFromSave(save),
    setPartyState: (p) => {},
    clock,
    sky,
    screens,
    zoneHost,
    scene,
    camera,
    renderer,
    party,
    startChapter: start.chapter,
    chapters: undefined // Will be set later
  });

  let encounters = await encSetup.makeEncounters(start.zone, zoneHost.current.data.tiles, clock.state);
  encSetup.setEncounters(encounters);

  // Zone transitions and teleports: reload the zone scene when the zone changes, then place the party.
  async function travelTo(d: Destination): Promise<void> {
    if (encSetup.isTravelling()) return;
    encSetup.setTravelling(true);
    try {
      const plan = planTransition(zoneHost.current.zone, d);
      if (plan.reload) {
        const splash = document.getElementById('splash')!;
        splash.style.display = 'flex';
        setSplash(\`Loading Zone \${plan.zone}...\`);
        await new Promise(r => setTimeout(r, 10));
        const next = await zoneHost.switchTo(plan.zone);
        splash.style.display = 'none';
        party.polygons = next.scene.collision;
        next.grass.setQuality(post.quality);
        screens.setMap(loadZoneMap(archive, plan.zone, next.data.tiles), plan.zone);
        encounters = await encSetup.makeEncounters(plan.zone, next.data.tiles, clock.state);
        encSetup.setEncounters(encounters);
        void music.play(songForZone(plan.zone)).catch((err) => console.warn('Music unavailable:', err));
      }
      party.setPosition(plan.x, plan.y, plan.heading);
      encSetup.updatePrevPos(plan.x, plan.y);
      encounters.runner.enterAt(plan.x, plan.y);
      if (plan.hotspot !== undefined) void encSetup.town.enter({ number: plan.hotspot, letter: gdsLetter(plan.hotspotChar ?? 0) });
    } finally {
      encSetup.setTravelling(false);
    }
  }
  encSetup.setTravelTo(travelTo);

`;

main = main.substring(0, extractStart) + replacement + main.substring(extractEnd);

// Fix setPartyState
main = main.replace('setPartyState: (p) => {},', 'setPartyState: (p) => { partyState = p; },');

// We need to define partyState and objectItems before encSetup
main = main.replace(
  'const encSetup = await setupEncounters({',
  'const objectItems = parseObjInfo(archive.get(\'OBJINFO.DAT\')).items;\n  let partyState = partyFromSave(save);\n  const encSetup = await setupEncounters({'
);
main = main.replace(
  "objectItems: parseObjInfo(archive.get('OBJINFO.DAT')).items,\n    partyState: partyFromSave(save),",
  "objectItems,\n    partyState,"
);

// Fix shops, combat, encounters, town, chapters usages in the rest of main.ts
main = main.replace(/ shops\.snapshot/g, ' encSetup.shops.snapshot');
main = main.replace(/ shops\.restore/g, ' encSetup.shops.restore');
main = main.replace(/!encounters\.busy/g, '!encounters.busy');
main = main.replace(/ encounters\.runner/g, ' encounters.runner');
main = main.replace(/ combat\.active/g, ' encSetup.combat.active');
main = main.replace(/ combat\.applyCamera/g, ' encSetup.combat.applyCamera');
main = main.replace(/ combat\.update/g, ' encSetup.combat.update');
main = main.replace(/ town\.active/g, ' encSetup.town.active');
main = main.replace(/ town\.controller/g, ' encSetup.town.controller');
main = main.replace(/ town\.dismiss/g, ' encSetup.town.dismiss');
main = main.replace(/ town\.playDialog/g, ' encSetup.town.playDialog');
main = main.replace(/ spellDefs/g, ' encSetup.spellDefs');
main = main.replace(/ teleports\[/g, ' encSetup.teleports[');
main = main.replace(/ travelling/g, ' encSetup.isTravelling()');

// Fix chapters
main = main.replace('encSetup.setTravelTo(travelTo);', 'encSetup.setTravelTo(travelTo);\n  let chapters: any;');
main = main.replace('encSetup.setEncounters(encounters);', 'encSetup.setEncounters(encounters);\n      if (chapters) chapters.onTransitioned();');
main = main.replace('chapters = installChapters', 'chapters = installChapters');
main = main.replace('encSetup.chapters = undefined', 'get chapters() { return chapters; }'); // wait, this is inside object literal.
main = main.replace('chapters: undefined // Will be set later', 'get chapters() { return chapters; }');

// We also need to fix `town.dismiss()` inside `arrive`
main = main.replace('town.dismiss();', 'encSetup.town.dismiss();');

fs.writeFileSync('src/game/main.ts', main);
console.log('done');
