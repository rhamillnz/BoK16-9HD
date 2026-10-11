import type { TtmFrame } from '../formats/ttm';

/**
 * HD (4x) replacements for cutscene and book pictures. Every picture a cutscene draws is an image of a BMX
 * file (a sprite) or an SCX screen, coloured by the palette active when it is drawn. Each (picture, palette)
 * pair is exported by `scripts/export-cutscene-art.ts` to art/derived/cutscenes/{screens,sprites}, upscaled by
 * tools/upscale into art/reference/cutscenes-4x/, and served from /art/cutscenes-4x/. A missing file means
 * the original picture is used, enlarged.
 */

/** Upscale factor of the HD pictures. */
export const HD_SCALE = 4;

const stem = (name: string) => name.replace(/\.[A-Z0-9]+$/i, '').toUpperCase();

/** File stem of image `index` of BMX file `bmx` in palette `pal`: `INT_TITL-0-INT_TITL`. */
export const hdSpriteName = (bmx: string, index: number, pal: string): string => `${stem(bmx)}-${index}-${stem(pal)}`;

/** File stem of screen `scx` in palette `pal`: `C11-C11A`. */
export const hdScreenName = (scx: string, pal: string): string => `${stem(scx)}-${stem(pal)}`;

export const hdUrl = (stemName: string): string => `/art/cutscenes-4x/${stemName}.png`;

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
