import { readFileSync } from 'node:fs';
import { ResourceArchive } from '../src/formats/archive';
import { loadZone } from '../src/world/zone';
const D = 'C:/Program Files (x86)/GOG Galaxy/Games/Betrayal at Krondor';
const a = new ResourceArchive(readFileSync(`${D}/KRONDOR.RMF`), readFileSync(`${D}/KRONDOR.001`));
const z = loadZone(a, 1);
for (const n of ['inn', 'house', 'house1', 'blcksmth', 'church', 'temple', 'bridge1']) {
  const t = z.table.names.indexOf(n);
  const hits = z.items.filter((i) => i.type === t);
  console.log(n, hits.length, hits.slice(0, 3).map((i) => `(${i.x},${i.y} r${i.zRot})`).join(' '));
}
