import { readFileSync } from 'node:fs';
import { ResourceArchive } from '../src/formats/archive';
import { loadZone } from '../src/world/zone';
const D = 'C:/Program Files (x86)/GOG Galaxy/Games/Betrayal at Krondor';
const a = new ResourceArchive(readFileSync(`${D}/KRONDOR.RMF`), readFileSync(`${D}/KRONDOR.001`));
const manifest = JSON.parse(readFileSync('public/models/manifest.json', 'utf8')).models;
const totals = new Map<string, number>();
for (let zone = 1; zone <= 12; zone++) {
  let z; try { z = loadZone(a, zone); } catch { continue; }
  const counts = new Map<string, number>();
  for (const it of z.items) { const m = z.table.models[it.type]; if (m?.sprite && !manifest[m.name.toLowerCase()]) counts.set(m.name, (counts.get(m.name) ?? 0) + 1); }
  for (const [k, v] of counts) totals.set(k, (totals.get(k) ?? 0) + v);
  console.log(`Z${String(zone).padStart(2, '0')}: ` + [...counts].sort((x, y) => y[1] - x[1]).slice(0, 14).map(([k, v]) => `${k}:${v}`).join(' '));
}
console.log('TOTAL ' + [...totals].sort((x, y) => y[1] - x[1]).slice(0, 30).map(([k, v]) => `${k}:${v}`).join(' '));
