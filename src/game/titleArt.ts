import { parseBMX, toRGBA, type IndexedImage } from '../formats/bmx';
import { parsePalette } from '../formats/palette';
import { parseSCX } from '../formats/scx';
import type { TitleArt } from '../ui/titleScreen';

interface Archive {
  has(name: string): boolean;
  get(name: string): Uint8Array;
}

const toCanvas = (img: IndexedImage, palette: Uint8Array): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext('2d')!.putImageData(new ImageData(toRGBA(img, palette), img.width, img.height), 0, 0);
  return canvas;
};

/** Overwrites a block with plain parchment copied from `fromY` rows lower (or higher, if negative). */
export function paintOut(img: IndexedImage, x0: number, x1: number, y0: number, y1: number, fromY: number): void {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) img.pixels[y * img.width + x] = img.pixels[(y + fromY) * img.width + x]!;
}

/**
 * The title screen's pictures from the player's own game data: the parchment of the original main menu
 * (OPTIONS0.SCX, minus its lettering), the gold title logo (INT_TITL.BMX) and the three heroes' portraits.
 * Whatever is missing is left out and the screen draws a plain stand-in.
 */
export function loadTitleArt(archive: Archive): TitleArt {
  const art: TitleArt = { heads: [] };
  const attempt = (what: string, f: () => void) => {
    try {
      f();
    } catch (err) {
      console.warn(`Title art (${what}) unavailable:`, err);
    }
  };
  attempt('parchment', () => {
    const img = parseSCX(archive.get('OPTIONS0.SCX'));
    paintOut(img, 20, 300, 4, 44, 46); // "Betrayal at Krondor" lettering
    paintOut(img, 44, 276, 150, 194, -58); // the credit lines (redrawn in the game font)
    art.sheet = toCanvas(img, parsePalette(archive.get('OPTIONS.PAL')));
  });
  attempt('logo', () => {
    const img = parseBMX(archive.get('INT_TITL.BMX'))[0];
    if (img) art.logo = toCanvas(img, parsePalette(archive.get('INT_TITL.PAL')));
  });
  attempt('heroes', () => {
    const pal = parsePalette(archive.get('OPTIONS.PAL'));
    art.heads = parseBMX(archive.get('HEADS.BMX'))
      .slice(0, 3)
      .map((img) => toCanvas(img, pal));
  });
  return art;
}
