import { readFileSync } from 'node:fs';
import { ResourceArchive } from '../src/formats/archive';
import { parseTBL } from '../src/formats/tbl';
const D = 'C:/Program Files (x86)/GOG Galaxy/Games/Betrayal at Krondor';
const a = new ResourceArchive(readFileSync(`${D}/KRONDOR.RMF`), readFileSync(`${D}/KRONDOR.001`));
const t = parseTBL(a.get('Z01.TBL'));
for (const n of ['inn', 'house', 'church', 'ground', 'zero1', 'fence', 'chest_nl', 'bridge1']) {
  const i = t.names.indexOf(n); const m = t.models[i]!; const c = t.clips[i];
  const used = [...new Set(m.faces.flatMap((f) => f.indices))]; const v = used.flatMap((k) => m.vertices.slice(k * 3, k * 3 + 3)); const ax = (k: number) => { const s = v.filter((_, j) => j % 3 === k); return `[${Math.min(...s)},${Math.max(...s)}]`; };
  console.log(n.padEnd(9), `scale=2^${Math.log2(m.scale)} r=${m.radius} hdrMin=${m.min} hdrMax=${m.max} | verts x${ax(0)} y${ax(1)} z${ax(2)} | clip r=(${c?.radiusX},${c?.radiusY})`);
}
