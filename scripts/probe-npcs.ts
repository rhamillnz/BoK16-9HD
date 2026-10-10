// List the NPC dialogue encounters of each zone: actor, name, tile cell rectangle. Usage: npx vite-node scripts/probe-npcs.ts [zone...]
import { readFileSync } from 'node:fs';
import { ResourceArchive } from '../src/formats/archive';
import { loadZone } from '../src/world/zone';
import { loadEncounterRunner } from '../src/game/encounterDriver';

const D = 'C:/Program Files (x86)/GOG Galaxy/Games/Betrayal at Krondor';
const a = new ResourceArchive(readFileSync(`${D}/KRONDOR.RMF`), readFileSync(`${D}/KRONDOR.001`));
const zones = process.argv.length > 2 ? process.argv.slice(2).map(Number) : [1, 2, 3, 4, 5, 6, 7, 8, 9];
for (const zone of zones) {
  const data = loadZone(a, zone);
  const read = (n: string) => {
    if (a.has(n)) return a.get(n);
    try {
      return new Uint8Array(readFileSync(`${D}/${n}`));
    } catch {
      return undefined;
    }
  };
  const runner = loadEncounterRunner({
    read,
    zone,
    tiles: data.tiles,
    chapter: Number(process.env.CH ?? 1),
    world: { chapter: 1, ticks: 0, ticksLastSlept: 0, bytes: new Uint8Array(0x20000), expiringEvents: [] },
  });
  for (const n of runner.npcEncounters()) {
    const r = n.encounter.record;
    console.log(
      zone,
      n.actor,
      n.name,
      `tile ${n.encounter.tileX},${n.encounter.tileY}`,
      `cells ${r.left}-${r.right} x ${r.bottom}-${r.top}`,
      `req ${r.requiredState} inh ${r.inhibitState}`,
    );
  }
}
