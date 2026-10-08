import { readFileSync } from 'fs';
import { ResourceArchive } from '../src/formats/archive.ts';
import { parseChapterStart } from '../src/formats/world.ts';
import { loadDialogStore } from '../src/game/chapterControls.ts';
import { startOfChapterActions } from '../src/game/chapters.ts';
import { parseTeleports } from '../src/game/transitions.ts';

async function run() {
  const rmf = readFileSync('C:\\Program Files (x86)\\GOG Galaxy\\Games\\Betrayal at Krondor\\KRONDOR.RMF');
  const data = readFileSync('C:\\Program Files (x86)\\GOG Galaxy\\Games\\Betrayal at Krondor\\KRONDOR.001');
  const archive = new ResourceArchive(new Uint8Array(rmf), new Uint8Array(data));

  const start = parseChapterStart(archive.get('CHAP2.DAT'));
  console.log('Chapter 2 start:', start);

  const store = loadDialogStore((name) => archive.has(name) ? archive.get(name) : undefined);
  const world = { chapter: 2, ticks: 0, ticksLastSlept: 0, bytes: new Uint8Array(0x4000), expiringEvents: [] } as any;
  const actions = startOfChapterActions(store, world, 2);
  console.log('Teleport index:', actions.teleport);

  if (actions.teleport !== undefined) {
    const teleports = parseTeleports(archive.get('TELEPORT.DAT'));
    console.log('Teleport record:', teleports[actions.teleport]);
  }
}
run().catch(console.error);
