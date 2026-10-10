import { describe, expect, it } from 'vitest';
import { placeEncounter } from '../world/encounters';
import { clothingColors, npcPlacement, npcVariant } from './npcLook';

describe('npcVariant', () => {
  it('reads the title words', () => {
    expect(npcVariant('Brother Marc')).toBe('monk');
    expect(npcVariant('Squire Phillip')).toBe('noble');
    expect(npcVariant('Captain Gardan')).toBe('guard');
    expect(npcVariant('Lady Elise')).toBe('woman');
    expect(npcVariant('Isaac')).toBe('man');
  });
});

describe('clothingColors', () => {
  it('ignores skin and dark pixels and finds tunic and trousers', () => {
    const w = 4;
    const h = 10;
    const px = new Uint8Array(w * h * 4);
    const put = (y: number, rgb: number[]) => {
      for (let x = 0; x < w; x++) px.set([...rgb, 255], (y * w + x) * 4);
    };
    for (let y = 0; y < h; y++) put(y, [220, 160, 130]); // skin
    for (let y = 3; y < 7; y++) put(y, [30, 60, 200]); // blue tunic
    for (let y = 7; y < 9; y++) put(y, [160, 40, 30]); // red trousers
    put(9, [5, 5, 5]); // near-black
    const c = clothingColors(px, w, h);
    expect(c.primary[2]).toBeGreaterThan(0.6);
    expect(c.primary[0]).toBeLessThan(0.3);
    expect(c.secondary[0]).toBeGreaterThan(0.5);
  });

  it('falls back to brown with no usable pixels', () => {
    expect(clothingColors(new Uint8Array(16), 2, 2).primary[0]).toBeGreaterThan(0);
  });
});

describe('npcPlacement', () => {
  it('is the centre of the trigger rectangle', () => {
    const rec = { left: 2, right: 3, top: 5, bottom: 4 } as Parameters<typeof placeEncounter>[0];
    const e = placeEncounter(rec, 1, 0);
    expect(npcPlacement(e)).toEqual({ x: 68800, y: 8000 });
  });
});
