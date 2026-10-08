import { readFileSync } from 'node:fs';
import { ResourceArchive } from '../src/formats/archive';
import { parseTBL } from '../src/formats/tbl';

const D = process.env.BAK_DIR ?? 'C:/Program Files (x86)/GOG Galaxy/Games/Betrayal at Krondor';
const a = new ResourceArchive(readFileSync(`${D}/KRONDOR.RMF`), readFileSync(`${D}/KRONDOR.001`));
for (const e of a.entries.filter((x) => x.name.endsWith('.TBL'))) {
  try {
    const t = parseTBL(a.get(e.name));
    const ms = t.models.filter((m) => m);
    const sprites = ms.filter((m) => m!.sprite).length;
    const faces = ms.reduce((s, m) => s + m!.faces.length, 0);
    console.log(`${e.name}: ${ms.length}/${t.names.length} models, ${sprites} sprites, ${faces} faces`);
  } catch (err) {
    console.log(`${e.name}: FAIL ${(err as Error).message}`);
  }
}
const t = parseTBL(a.get('Z01.TBL'));
for (const n of ['ground', 'field', 'zero1', 'tree1', 'inn', 't010006', 'chest_nl', 'fence']) {
  const m = t.models[t.names.indexOf(n)]!;
  const xs = m.vertices.filter((_, i) => i % 3 === 0),
    zs = m.vertices.filter((_, i) => i % 3 === 2);
  console.log(
    n,
    `flags=${m.flags.toString(16)} scale=${m.scale} r=${m.radius} verts=${m.vertices.length / 3} faces=${m.faces.length} frames=${m.frames}`,
    m.sprite ? `sprite=${JSON.stringify(m.sprite)}` : '',
    `x[${Math.min(...xs)},${Math.max(...xs)}] z[${Math.min(...zs)},${Math.max(...zs)}]`,
    `mats=${[...new Set(m.faces.map((f) => f.material.toString(16)))].join(',')}`,
  );
}
