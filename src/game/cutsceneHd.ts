import type { TtmFrame } from '../formats/ttm';

/**
 * HD (4x) replacements for cutscene and book pictures.
 * - Cutscenes: whole frames, upscaled after the original renderer has composed them, so a moving piece (a
 *   talking head) always matches the picture it sits on. `scripts/export-cutscene-frames.ts` writes each distinct
 *   frame by its hash (sceneHash); tools/upscale puts them in art/reference/cutscene-frames-4x/, served from
 *   /art/cutscene-frames-4x/.
 * - Books: the drawn capitals and borders of BOOK.BMX, one picture per (image, palette), exported by
 *   `scripts/export-cutscene-art.ts` and served from /art/cutscenes-4x/.
 * A missing file means the original picture is used, enlarged.
 */

/** Upscale factor of the HD pictures. */
export const HD_SCALE = 4;

/** An upscaled picture as the browser holds it (an image or a canvas). */
export type HdPicture = CanvasImageSource & { width: number; height: number };

const stem = (name: string) => name.replace(/\.[A-Z0-9]+$/i, '').toUpperCase();

/** File stem of image `index` of BMX file `bmx` in palette `pal`: `INT_TITL-0-INT_TITL`. */
export const hdSpriteName = (bmx: string, index: number, pal: string): string => `${stem(bmx)}-${index}-${stem(pal)}`;

/** File stem of screen `scx` in palette `pal`: `C11-C11A`. */
export const hdScreenName = (scx: string, pal: string): string => `${stem(scx)}-${stem(pal)}`;

export const hdUrl = (stemName: string): string => `/art/cutscenes-4x/${stemName}.png`;

/** The player wants the upscaled art (Options > Cutscene art; `?hdart=0` turns it off for a test). */
export function hdArtWanted(setting: 'hd' | 'original'): boolean {
  return setting === 'hd' && new URLSearchParams(globalThis.location?.search ?? '').get('hdart') !== '0';
}

export interface HdUse {
  sprites: { bmx: string; index: number; pal: string }[];
  screens: { scx: string; pal: string }[];
}

/**
 * Which pictures a cutscene draws in which palette, by walking its ops in file order and tracking the image
 * and palette slots, as the renderer does.
 */
export function hdUses(frames: readonly TtmFrame[]): HdUse {
  const images = new Map<number, string>();
  const palettes = new Map<number, string>();
  let imageSlot = 0;
  let paletteSlot = 0;
  const sprites = new Map<string, HdUse['sprites'][number]>();
  const screens = new Map<string, HdUse['screens'][number]>();
  for (const f of frames) {
    for (const op of f.ops) {
      switch (op.op) {
        case 'slotImage':
          imageSlot = op.slot;
          break;
        case 'slotPalette':
          paletteSlot = op.slot;
          break;
        case 'loadImage':
          images.set(imageSlot, op.name);
          break;
        case 'loadPalette':
          palettes.set(paletteSlot, op.name);
          break;
        case 'loadScreen': {
          const pal = palettes.get(paletteSlot);
          if (pal) screens.set(hdScreenName(op.name, pal), { scx: op.name, pal });
          break;
        }
        case 'sprite':
        case 'spriteRotated': {
          const bmx = images.get(op.slot);
          const pal = palettes.get(paletteSlot);
          if (bmx && pal) sprites.set(hdSpriteName(bmx, op.index, pal), { bmx, index: op.index, pal });
          break;
        }
        default:
          break;
      }
    }
  }
  return { sprites: [...sprites.values()], screens: [...screens.values()] };
}

/** Every cutscene of the game with the chapter it plays in (for exporting its frames). */
export const ALL_CUTSCENES: readonly { ads: string; ttm: string; chapter: number }[] = [
  { ads: 'INTRO.ADS', ttm: 'INTRO.TTM', chapter: 1 },
  ...Array.from({ length: 9 }, (_, i) => ({ ads: `CHAPTER${i + 1}.ADS`, ttm: `CHAPTER${i + 1}.TTM`, chapter: i + 1 })),
  ...Array.from({ length: 9 }, (_, i) =>
    [1, 2, 3].map((k) => ({ ads: `C${i + 1}${k}.ADS`, ttm: `C${i + 1}${k}.TTM`, chapter: i + 1 })),
  ).flat(),
];

/**
 * A whole cutscene frame upscaled (scripts/export-cutscene-frames.ts), by the hash of the original frame's pixels
 * (sceneHash). Upscaling finished frames keeps moving pieces matched to the picture they are drawn on.
 */
export const cutsceneFrameUrl = (hash: string): string => `/art/cutscene-frames-4x/${hash}.png`;
