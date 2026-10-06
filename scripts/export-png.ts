// Export BMX images to PNG for inspection.
// Usage: npx vite-node scripts/export-png.ts <outDir> <NAME.BMX> [PALETTE.PAL] ...
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ResourceArchive } from '../src/formats/archive';
import { parseBMX, toRGBA } from '../src/formats/bmx';
import { parsePalette } from '../src/formats/palette';
import { guessPalette } from '../src/data/palettes';
import { encodePNG } from './png';

const D = process.env.BAK_DIR ?? 'C:/Program Files (x86)/GOG Galaxy/Games/Betrayal at Krondor';

const [outDir, ...names] = process.argv.slice(2);
if (!outDir || names.length === 0) {
  console.error('usage: export-png.ts <outDir> <NAME.BMX> [PALETTE.PAL] ...');
  process.exit(1);
}
const archive = new ResourceArchive(readFileSync(`${D}/KRONDOR.RMF`), readFileSync(`${D}/KRONDOR.001`));
mkdirSync(outDir, { recursive: true });
let palName: string | undefined;
for (const name of names) {
  if (name.toUpperCase().endsWith('.PAL')) {
    palName = name;
    continue;
  }
  const pn = palName ?? guessPalette(name, archive.entries.map((e) => e.name));
  const pal = parsePalette(archive.get(pn));
  parseBMX(archive.get(name)).forEach((img, i) => {
    const file = path.join(outDir, `${name}_${i}.png`);
    writeFileSync(file, encodePNG(img.width, img.height, toRGBA(img, pal), 3));
    console.log(`${file} ${img.width}x${img.height} pal=${pn}`);
  });
  palName = undefined;
}
