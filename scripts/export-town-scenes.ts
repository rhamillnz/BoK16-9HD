// Export every town/shop/inn/temple scene picture (GDS scenes, all chapters, deduplicated) as PNGs named by
// content hash, ready for tools/upscale. Writes art/derived/scenes/<hash>.png; the upscaled results go to
// art/reference/scenes-4x/<hash>.png (see src/game/sceneHd.ts).
//   npx tsx scripts/export-town-scenes.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ResourceArchive } from '../src/formats/archive';
import { loadTownScene } from '../src/game/townScene';
import { sceneHash } from '../src/game/sceneHd';
import { encodePNG } from './png';

const D = process.env.BAK_DIR ?? 'C:/Program Files (x86)/GOG Galaxy/Games/Betrayal at Krondor';
const archive = new ResourceArchive(readFileSync(`${D}/KRONDOR.RMF`), readFileSync(`${D}/KRONDOR.001`));
const out = 'art/derived/scenes';
mkdirSync(out, { recursive: true });

const fetchResources = async (names: readonly string[]) => {
  const found = new Map<string, Uint8Array>();
  for (const n of names) {
    if (archive.has(n)) found.set(n, archive.get(n));
    else if (existsSync(path.join(D, n))) found.set(n, new Uint8Array(readFileSync(path.join(D, n))));
  }
  return (n: string) => found.get(n);
};

const seen = new Set<string>();
let scenes = 0;
for (const e of archive.entries) {
  const m = /^GDS(\d+)([A-Z])\.DAT$/.exec(e.name);
  if (!m) continue;
  scenes++;
  for (let chapter = 1; chapter <= 9; chapter++) {
    try {
      const { image } = await loadTownScene(fetchResources, { number: Number(m[1]), letter: m[2]! }, chapter);
      const hash = sceneHash(image.rgba);
      if (seen.has(hash)) continue;
      seen.add(hash);
      writeFileSync(path.join(out, `${hash}.png`), encodePNG(image.width, image.height, image.rgba));
    } catch (err) {
      console.warn(`${e.name} chapter ${chapter}: ${(err as Error).message}`);
    }
  }
}
console.log(`${scenes} scenes, ${seen.size} distinct pictures -> ${out}`);
