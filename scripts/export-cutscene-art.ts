// Export every picture the cutscenes (ADS/TTM) and the chapter books draw, once per palette it is drawn in,
// for tools/upscale. Names come from src/game/cutsceneHd.ts. Cutscene pictures (photographs and paintings) and
// the drawn book art go to separate folders because they get different upscale models:
//   npx tsx scripts/export-cutscene-art.ts
//   tools/upscale/.venv/Scripts/python tools/upscale/upscale.py art/derived/cutscenes/paintings art/reference/cutscenes-4x --scenes
//   tools/upscale/.venv/Scripts/python tools/upscale/upscale.py art/derived/cutscenes/sprites art/reference/cutscenes-4x
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { ResourceArchive } from '../src/formats/archive';
import { parseBMX, type IndexedImage } from '../src/formats/bmx';
import { parsePalette, type Palette } from '../src/formats/palette';
import { parseSCX } from '../src/formats/scx';
import { parseTtmFrames } from '../src/formats/ttm';
import { hdScreenName, hdSpriteName, hdUses } from '../src/game/cutsceneHd';
import { encodePNG } from './png';

const D = process.env.BAK_DIR ?? 'C:/Program Files (x86)/GOG Galaxy/Games/Betrayal at Krondor';
const archive = new ResourceArchive(readFileSync(`${D}/KRONDOR.RMF`), readFileSync(`${D}/KRONDOR.001`));
const OUT = 'art/derived/cutscenes';
for (const d of ['paintings', 'sprites']) mkdirSync(`${OUT}/${d}`, { recursive: true });

const cache = new Map<string, unknown>();
const cached = <T>(key: string, f: () => T): T => {
  if (!cache.has(key)) cache.set(key, f());
  return cache.get(key) as T;
};
const palette = (name: string) => cached(`pal:${name}`, () => parsePalette(archive.get(name)));
const bmx = (name: string) => cached(`bmx:${name}`, () => parseBMX(archive.get(name)));
const scx = (name: string) => cached(`scx:${name}`, () => parseSCX(archive.get(name)));

/** RGBA of an indexed image; index 0 is transparent for sprites, every pixel opaque for screens. */
function rgba(img: IndexedImage, pal: Palette, transparentZero: boolean): Uint8ClampedArray {
  const out = new Uint8ClampedArray(img.width * img.height * 4);
  for (let i = 0; i < img.pixels.length; i++) {
    const c = img.pixels[i]!;
    out.set([pal[c * 4]!, pal[c * 4 + 1]!, pal[c * 4 + 2]!, transparentZero && c === 0 ? 0 : 255], i * 4);
  }
  return out;
}

const written = new Set<string>();
/**
 * Cutscene pictures are digitised photographs and paintings: x4plus keeps their grain. Only the drawn book art
 * (initials and vines of BOOK.BMX) goes to the sprite model, which keeps its inked edges clean.
 */
const isDrawnArt = (name: string) => name.startsWith('BOOK-');
const write = (name: string, img: IndexedImage, pal: Palette, transparentZero: boolean) => {
  if (written.has(name) || img.width === 0 || img.height === 0) return;
  written.add(name);
  const folder = isDrawnArt(name) ? 'sprites' : 'paintings';
  writeFileSync(`${OUT}/${folder}/${name}.png`, encodePNG(img.width, img.height, rgba(img, pal, transparentZero)));
};

let failed = 0;
for (const { name } of archive.entries) {
  if (!/\.TTM$/i.test(name)) continue;
  try {
    const uses = hdUses(parseTtmFrames(archive.get(name)));
    for (const s of uses.screens) {
      if (!archive.has(s.scx) || !archive.has(s.pal)) continue;
      write(hdScreenName(s.scx, s.pal), scx(s.scx), palette(s.pal), false);
    }
    for (const s of uses.sprites) {
      if (!archive.has(s.bmx) || !archive.has(s.pal)) continue;
      const img = bmx(s.bmx)[s.index];
      if (img) write(hdSpriteName(s.bmx, s.index, s.pal), img, palette(s.pal), true);
    }
  } catch (err) {
    failed++;
    console.warn(`${name}: ${(err as Error).message}`);
  }
}

// The chapter books: the pictures and initials of BOOK.BMX in BOOK.PAL (BOOK.SCX is a format parseSCX does not
// read; the game draws plain paper instead).
bmx('BOOK.BMX').forEach((img, i) => write(hdSpriteName('BOOK.BMX', i, 'BOOK.PAL'), img, palette('BOOK.PAL'), true));

console.log(`${written.size} pictures written to ${OUT} (${failed} cutscenes unreadable)`);
