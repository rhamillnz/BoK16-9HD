import { describe, expect, it } from 'vitest';
import { groundIsGrassy } from '../src/render/grassGround';
import type { ZoneData } from '../src/world/zone';

/** A zone whose Ground strip is one palette colour. */
const zoneWithGround = (rgb: [number, number, number]): ZoneData => {
  const palette = new Uint8Array(1024);
  palette.set([...rgb, 0], 4);
  return { palette, terrain: [{ width: 2, height: 1, pixels: new Uint8Array([1, 1]) }] } as unknown as ZoneData;
};

describe('groundIsGrassy', () => {
  it('grows grass on green ground, not on snow', () => {
    expect(groundIsGrassy(zoneWithGround([37, 78, 38]))).toBe(true);
    expect(groundIsGrassy(zoneWithGround([104, 124, 156]))).toBe(false);
  });
});
