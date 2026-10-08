import { describe, expect, it } from 'vitest';
import { buildItemIconSet, colorizeIcon, fitScale, resolveItemIcon, resolveItemImage } from '../src/data/itemIcons';
import type { IndexedImage } from '../src/formats/bmx';

const img = (w: number, h: number, fill: number): IndexedImage => ({
  width: w,
  height: h,
  pixels: new Uint8Array(w * h).fill(fill),
});
const palette = new Uint8Array(256 * 4);
palette.set([10, 20, 30, 255], 1 * 4);
palette.set([200, 100, 50, 255], 2 * 4);

describe('item icon mapping', () => {
  const set = buildItemIconSet([[img(2, 2, 1), img(3, 1, 2)], [img(1, 1, 1)]], palette);
  it('concatenates INVSHP1 then INVSHP2', () => {
    expect(set.images).toHaveLength(3);
    expect(resolveItemImage(set, 1)?.width).toBe(3);
    expect(resolveItemImage(set, 2)?.width).toBe(1);
  });
  it('returns undefined out of range or for empty images', () => {
    expect(resolveItemImage(set, 3)).toBeUndefined();
    expect(resolveItemImage(set, -1)).toBeUndefined();
    expect(resolveItemImage(buildItemIconSet([[img(0, 0, 0)]], palette), 0)).toBeUndefined();
  });
  it('applies the palette with index 0 transparent', () => {
    const icon = colorizeIcon({ width: 2, height: 1, pixels: Uint8Array.of(0, 2) }, palette);
    expect(Array.from(icon.rgba)).toEqual([0, 0, 0, 0, 200, 100, 50, 255]);
    expect(resolveItemIcon(set, 0)?.rgba.slice(0, 4)).toEqual(new Uint8ClampedArray([10, 20, 30, 255]));
  });
  it('picks an integer nearest-neighbour scale', () => {
    expect(fitScale(32, 16, 100, 100)).toBe(3);
    expect(fitScale(32, 16, 40, 100)).toBe(1);
    expect(fitScale(32, 16, 10, 10)).toBe(1);
  });
});
