import { readFileSync } from 'fs';
import { ResourceArchive } from '../src/formats/archive.ts';
import { parseTeleports, parseZoneTransitions } from '../src/game/transitions.ts';

const rmf = readFileSync('C:\\Program Files (x86)\\GOG Galaxy\\Games\\Betrayal at Krondor\\KRONDOR.RMF');
const data = readFileSync('C:\\Program Files (x86)\\GOG Galaxy\\Games\\Betrayal at Krondor\\KRONDOR.001');
const archive = new ResourceArchive(new Uint8Array(rmf), new Uint8Array(data));

if (archive.has('DEF_ZONE.DAT')) {
  const transitions = parseZoneTransitions(archive.get('DEF_ZONE.DAT'));
  console.log("Transitions to zone 10:", transitions.filter(t => t.zone === 10));
}

if (archive.has('TELEPORT.DAT')) {
  const teleports = parseTeleports(archive.get('TELEPORT.DAT'));
  console.log("Teleports to zone 10:", teleports.filter(t => t.zone === 10));
}
