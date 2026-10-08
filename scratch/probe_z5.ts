import { readFileSync } from 'fs';
import { ResourceArchive } from '../src/formats/archive.ts';
import { loadZone } from '../src/world/zone.ts';
import { buildZoneScene } from '../src/render/zoneScene.ts';
import { CHUNK_SIZE } from '../src/render/cullMath.ts';

async function run() {
  console.log("CHUNK_SIZE is", CHUNK_SIZE);
  const rmf = readFileSync('C:\\Program Files (x86)\\GOG Galaxy\\Games\\Betrayal at Krondor\\KRONDOR.RMF');
  const data = readFileSync('C:\\Program Files (x86)\\GOG Galaxy\\Games\\Betrayal at Krondor\\KRONDOR.001');
  const archive = new ResourceArchive(new Uint8Array(rmf), new Uint8Array(data));

  const z5 = loadZone(archive, 5);
  const scene = buildZoneScene(z5);
  console.log("Meshes in group:", scene.group.children.length);
}
run().catch(console.error);
