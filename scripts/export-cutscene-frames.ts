// Export every distinct whole frame the cutscenes (ADS/TTM) show, named by content hash, for tools/upscale.
// Upscaling finished frames keeps a moving piece (a talking head) matched to the picture it is drawn on; the
// player looks each frame up by the same hash (src/game/cutsceneHd.ts, cutsceneFrameUrl).
//   npx tsx scripts/export-cutscene-frames.ts
//   tools/upscale/.venv/Scripts/python tools/upscale/smooth.py art/derived/cutscene-frames art/reference/cutscene-frames-4x
// (smooth enlargement, chosen over Real-ESRGAN, which made the digitised actors look waxy)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { ResourceArchive } from '../src/formats/archive';
import { parseAds, parseTtmFrames } from '../src/formats/ttm';
import { CutsceneRenderer, CutsceneRunner } from '../src/game/cutscene';
import { ALL_CUTSCENES } from '../src/game/cutsceneHd';
import { sceneHash } from '../src/game/sceneHd';
import { SCENE_HEIGHT, SCENE_WIDTH } from '../src/game/townScene';
import { encodePNG } from './png';

const D = process.env.BAK_DIR ?? 'C:/Program Files (x86)/GOG Galaxy/Games/Betrayal at Krondor';
const archive = new ResourceArchive(readFileSync(`${D}/KRONDOR.RMF`), readFileSync(`${D}/KRONDOR.001`));
const read = (n: string) => (archive.has(n) ? archive.get(n) : undefined);
const OUT = 'art/derived/cutscene-frames';
mkdirSync(OUT, { recursive: true });

const seen = new Set<string>();
const index: Record<string, string[]> = {};
for (const { ads, ttm, chapter } of ALL_CUTSCENES) {
  if (!archive.has(ads) || !archive.has(ttm)) continue;
  const runner = new CutsceneRunner(parseAds(archive.get(ads)), parseTtmFrames(archive.get(ttm)), chapter);
  const renderer = new CutsceneRenderer(read);
  const mine: string[] = [];
  for (let ops = runner.next(), n = 0; ops && n < 5000; ops = runner.next(), n++) {
    const rgba = renderer.draw(ops);
    const hash = sceneHash(rgba);
    if (!mine.includes(hash)) mine.push(hash);
    if (seen.has(hash)) continue;
    seen.add(hash);
    writeFileSync(`${OUT}/${hash}.png`, encodePNG(SCENE_WIDTH, SCENE_HEIGHT, rgba));
  }
  index[ttm] = mine;
}
writeFileSync(`${OUT}/index.json`, JSON.stringify(index, null, 1));
console.log(`${Object.keys(index).length} cutscenes, ${seen.size} distinct frames -> ${OUT}`);
