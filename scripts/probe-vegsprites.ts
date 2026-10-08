import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { ResourceArchive } from '../src/formats/archive';
import { toRGBA } from '../src/formats/bmx';
import { loadZone } from '../src/world/zone';
import { encodePNG } from './png';
const D = 'C:/Program Files (x86)/GOG Galaxy/Games/Betrayal at Krondor';
const a = new ResourceArchive(readFileSync(`${D}/KRONDOR.RMF`), readFileSync(`${D}/KRONDOR.001`));
const want = [
  'tree4',
  'tree5',
  'tree6',
  'tree6a',
  'tree7',
  'tree7a',
  'tree8',
  'tree8a',
  'tree9',
  'tree9a',
  'grove',
  'fern',
  'bush1',
  'bush2',
  'bush4',
  'stump',
];
const found: Record<string, { zone: number; slot: number; height: number; width: number }> = {};
mkdirSync('art/reference/sprites', { recursive: true });
for (let zone = 1; zone <= 12; zone++) {
  let z;
  try {
    z = loadZone(a, zone);
  } catch {
    continue;
  }
  z.table.models.forEach((m) => {
    if (!m?.sprite || !want.includes(m.name) || found[m.name]) return;
    const img = z.slotImages[m.sprite.index];
    if (!img) return;
    const sf = m.sprite.scale === 0 ? 256 : m.sprite.scale;
    const major = ((2 * m.radius * sf) / 256) * m.scale;
    const maxDim = Math.max(img.width, img.height);
    found[m.name] = {
      zone,
      slot: m.sprite.index,
      height: +(((img.height / maxDim) * major * 1.2) / 100).toFixed(2),
      width: +(((img.width / maxDim) * major) / 100).toFixed(2),
    };
    writeFileSync(`art/reference/sprites/${m.name}.png`, encodePNG(img.width, img.height, toRGBA(img, z.palette), 1));
  });
}
console.log(JSON.stringify(found));
