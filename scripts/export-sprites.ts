// Export a zone's sprite-slot images (trees, bodies, props, wall textures) as RGBA PNGs.
// Usage: npx vite-node scripts/export-sprites.ts [zone=1] [outDir=art/reference]
// Writes <outDir>/Zxx/slots/<index>.png, numbered like ZoneData.slotImages.
// Derived from the original game data: gitignored, never commit.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ResourceArchive } from '../src/formats/archive';
import { toRGBA } from '../src/formats/bmx';
import { zonePrefix } from '../src/formats/tbl';
import { loadZone } from '../src/world/zone';
import { encodePNG } from './png';

const D = process.env.BAK_DIR ?? 'C:/Program Files (x86)/GOG Galaxy/Games/Betrayal at Krondor';
const zone = Number(process.argv[2] ?? 1);
const outDir = path.join(process.argv[3] ?? 'art/reference', zonePrefix(zone), 'slots');
const a = new ResourceArchive(readFileSync(`${D}/KRONDOR.RMF`), readFileSync(`${D}/KRONDOR.001`));
const z = loadZone(a, zone);
mkdirSync(outDir, { recursive: true });
z.slotImages.forEach((img, i) => {
  writeFileSync(path.join(outDir, `${i}.png`), encodePNG(img.width, img.height, toRGBA(img, z.palette)));
});
console.log(`exported ${z.slotImages.length} slot images to ${outDir}`);
