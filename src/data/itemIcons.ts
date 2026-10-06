import type { ResourceArchive } from '../formats/archive';
import { parseBMX, type IndexedImage } from '../formats/bmx';
import { parsePalette, type Palette } from '../formats/palette';

/**
 * Inventory item images. Per BaKGL's icon loader, INVSHP1.BMX and INVSHP2.BMX are appended into one
 * image list, drawn with OPTIONS.PAL, and `ItemDef.imageIndex` indexes that list directly.
 * The images carry their own sizes, so `ItemDef.imageSize` is not needed to draw them.
 */
export const ITEM_ICON_FILES = ['INVSHP1.BMX', 'INVSHP2.BMX'] as const;
export const ITEM_ICON_PALETTE = 'OPTIONS.PAL';

export interface ItemIconSet {
  images: IndexedImage[];
  palette: Palette;
}

export interface ItemIcon {
  width: number;
  height: number;
  /** RGBA, row-major; palette index 0 is transparent. */
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

/** Concatenate the per-file image lists in file order, as the game's combined icon list. */
export function buildItemIconSet(files: IndexedImage[][], palette: Palette): ItemIconSet {
  return { images: files.flat(), palette };
}

export function loadItemIcons(archive: ResourceArchive): ItemIconSet {
  const files = ITEM_ICON_FILES.map((name) => parseBMX(archive.get(name)));
  return buildItemIconSet(files, parsePalette(archive.get(ITEM_ICON_PALETTE)));
}

/** The icon image for an item's `imageIndex`, or undefined when out of range or empty. */
export function resolveItemImage(set: ItemIconSet, imageIndex: number): IndexedImage | undefined {
  const img = set.images[imageIndex];
  return img && img.width > 0 && img.height > 0 ? img : undefined;
}

export function colorizeIcon(image: IndexedImage, palette: Palette): ItemIcon {
  const rgba = new Uint8ClampedArray(image.width * image.height * 4);
  for (let i = 0; i < image.pixels.length; i++) {
    const p = image.pixels[i]! * 4;
    rgba.set(palette.subarray(p, p + 4), i * 4);
  }
  return { width: image.width, height: image.height, rgba };
}

/** Resolve and colourise an item's icon. */
export function resolveItemIcon(set: ItemIconSet, imageIndex: number): ItemIcon | undefined {
  const img = resolveItemImage(set, imageIndex);
  return img ? colorizeIcon(img, set.palette) : undefined;
}

/** Largest integer scale at which `width`x`height` fits the box (at least 1). */
export function fitScale(width: number, height: number, boxWidth: number, boxHeight: number): number {
  return Math.max(1, Math.floor(Math.min(boxWidth / Math.max(1, width), boxHeight / Math.max(1, height))));
}
