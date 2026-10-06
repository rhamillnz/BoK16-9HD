// Export a zone's original models as OBJ/MTL reference geometry for the art pipeline.
// Usage: npx vite-node scripts/export-models.ts [zone=1] [outDir=art/reference]
// Output is derived from the original game data, so it is gitignored and must never be committed.
// Units: 1 OBJ unit = 100 BaK units (same as the renderer); Y up, north = -Z.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ResourceArchive } from '../src/formats/archive';
import { parsePalette } from '../src/formats/palette';
import { parseTBL, zonePrefix } from '../src/formats/tbl';

const D = process.env.BAK_DIR ?? 'C:/Program Files (x86)/GOG Galaxy/Games/Betrayal at Krondor';
const zone = Number(process.argv[2] ?? 1);
const outDir = path.join(process.argv[3] ?? 'art/reference', zonePrefix(zone));
const a = new ResourceArchive(readFileSync(`${D}/KRONDOR.RMF`), readFileSync(`${D}/KRONDOR.001`));
const palette = parsePalette(a.get(`${zonePrefix(zone)}.PAL`));
const table = parseTBL(a.get(`${zonePrefix(zone)}.TBL`));
mkdirSync(outDir, { recursive: true });

const S = 100;
const seen = new Set<string>();
let count = 0;
const manifest: Record<string, unknown> = {};
table.models.forEach((m, i) => {
  if (!m || m.faces.length === 0 || seen.has(m.name)) return;
  seen.add(m.name);
  const used = [...new Set(m.faces.flatMap((f) => f.indices))].sort((x, y) => x - y);
  const remap = new Map(used.map((v, k) => [v, k + 1]));
  const lines = [`# ${m.name} (zone ${zone}, model ${i}); 1 unit = 100 BaK units`, `mtllib ${m.name}.mtl`, `o ${m.name}`];
  for (const v of used) {
    const x = m.vertices[v * 3]!, y = m.vertices[v * 3 + 1]!, z = m.vertices[v * 3 + 2]!;
    lines.push(`v ${(x / S).toFixed(4)} ${(z / S).toFixed(4)} ${(-y / S).toFixed(4)}`);
  }
  const mats = new Set<number>();
  let current = -1;
  for (const f of m.faces) {
    if (f.indices.length < 3) continue;
    if (f.color !== current) {
      lines.push(`usemtl c${f.color}`);
      current = f.color;
      mats.add(f.color);
    }
    lines.push(`f ${f.indices.map((v) => remap.get(v)).join(' ')}`);
  }
  const mtl = [...mats].map((c) => {
    const r = palette[c * 4]! / 255, g = palette[c * 4 + 1]! / 255, b = palette[c * 4 + 2]! / 255;
    return `newmtl c${c}\nKd ${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)}\nKa 0 0 0\nKs 0 0 0\nd 1\n`;
  });
  writeFileSync(path.join(outDir, `${m.name}.obj`), lines.join('\n') + '\n');
  writeFileSync(path.join(outDir, `${m.name}.mtl`), mtl.join('\n'));
  manifest[m.name] = { model: i, flags: m.flags, scale: m.scale, min: m.min, max: m.max, faces: m.faces.length };
  count++;
});
writeFileSync(path.join(outDir, 'models.json'), JSON.stringify(manifest, null, 2));
console.log(`exported ${count} models to ${outDir}`);
