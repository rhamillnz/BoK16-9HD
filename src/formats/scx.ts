import { Compression, decompress } from './compression';
import type { IndexedImage } from './bmx';
import { Reader } from './reader';

const SIG_SCREEN = 0x27b6;

/** .SCX full-screen 320x200 images: u16 0x27B6 signature, then an LZW stream. */
export function parseSCX(bytes: Uint8Array): IndexedImage {
  const r = new Reader(bytes);
  const sig = r.u16();
  if (sig !== SIG_SCREEN) throw new Error(`unknown SCX signature 0x${sig.toString(16)}`);
  const width = 320;
  const height = 200;
  const pixels = decompress(Compression.LZW, bytes.subarray(r.pos), width * height);
  if (pixels.length < width * height) throw new Error(`SCX decoded ${pixels.length} of ${width * height} bytes`);
  return { width, height, pixels: pixels.subarray(0, width * height) };
}

/** Row heights of the 8 terrain strips stacked in ZxxL.SCX (ground, road, waterfall, path, dirt, river, sand, bank). */
export const TERRAIN_STRIP_HEIGHTS = [70, 20, 20, 32, 20, 27, 6, 5] as const;

export const Terrain = {
  Ground: 0,
  Road: 1,
  Waterfall: 2,
  Path: 3,
  Dirt: 4,
  River: 5,
  Sand: 6,
  Bank: 7,
} as const;

/** Slice a terrain sheet into its 8 strips. */
export function terrainStrips(sheet: IndexedImage): IndexedImage[] {
  const strips: IndexedImage[] = [];
  let y = 0;
  for (const h of TERRAIN_STRIP_HEIGHTS) {
    strips.push({ width: sheet.width, height: h, pixels: sheet.pixels.slice(y * sheet.width, (y + h) * sheet.width) });
    y += h;
  }
  return strips;
}
