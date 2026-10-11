import { describe, expect, it } from 'vitest';
import { RED_LEAF_MATERIAL, redLeavesToOlive } from './foliageColour';

describe('redLeavesToOlive', () => {
  it('turns red leaf pixels olive green and keeps light, dark and alpha', () => {
    const px = new Uint8ClampedArray([166, 23, 23, 255, 80, 10, 10, 0]);
    redLeavesToOlive(px);
    const [r, g, b, a, r2, g2] = px;
    expect(g).toBeGreaterThan(r!);
    expect(r).toBeGreaterThan(b! * 2);
    expect(a).toBe(255);
    expect(px[7]).toBe(0);
    expect(g2).toBeLessThan(g!);
    expect(r2).toBeLessThan(r!);
  });
  it('matches the twisted-tree leaf material only', () => {
    expect(RED_LEAF_MATERIAL.test('Leaves_TwistedTree')).toBe(true);
    expect(RED_LEAF_MATERIAL.test('Leaves_NormalTree')).toBe(false);
  });
});
