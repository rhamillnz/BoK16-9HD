import { readFileSync } from 'node:fs';
import { ResourceArchive } from '../src/formats/archive';
import { parseTBL } from '../src/formats/tbl';
const D = 'C:/Program Files (x86)/GOG Galaxy/Games/Betrayal at Krondor';
const a = new ResourceArchive(readFileSync(`${D}/KRONDOR.RMF`), readFileSync(`${D}/KRONDOR.001`));
const seen = new Map<string, string>();
for (let zone = 1; zone <= 12; zone++) {
  const n = `Z${String(zone).padStart(2, '0')}.TBL`; if (!a.has(n)) continue;
  const t = parseTBL(a.get(n));
  t.models.forEach((m) => {
    if (!m || m.sprite || !m.min || !m.max || !(m.flags & 0x40) || m.name.startsWith('tree') || seen.has(m.name)) return;
    const w = (m.max[0] - m.min[0]) * m.scale / 100, d = (m.max[1] - m.min[1]) * m.scale / 100, h = (m.max[2] - m.min[2]) * m.scale / 100;
    if (w < 4 || h < 4) return;
    seen.set(m.name, `${m.name}: ${w.toFixed(1)} x ${d.toFixed(1)} x ${h.toFixed(1)} (z${zone})`);
  });
}
console.log([...seen.values()].join('\n'));
