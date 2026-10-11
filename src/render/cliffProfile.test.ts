import { describe, expect, it } from 'vitest';
import { cliffProfile, cliffStyle } from './hillDetail';

describe('cliffProfile', () => {
  const styles = [cliffStyle(20, 0.3), cliffStyle(8, 0.2), cliffStyle(8, 0.8)];

  it('keeps the foot and the summit where they are', () => {
    for (const s of styles) {
      expect(cliffProfile(0, 10, s)).toBe(0);
      expect(cliffProfile(10, 10, s)).toBeCloseTo(10);
    }
  });

  it('only ever rises, so no slope folds over itself', () => {
    for (const s of styles) {
      let last = -1;
      for (let h = 0; h <= 10; h += 0.05) {
        const y = cliffProfile(h, 10, s);
        expect(y).toBeGreaterThanOrEqual(last - 1e-9);
        last = y;
      }
    }
  });

  it('makes steep risers and gentle treads', () => {
    const s = cliffStyle(8, 0.2); // two bands
    const band = 10 / s.bands;
    const slope = (h: number) => (cliffProfile(h + 0.01, 10, s) - cliffProfile(h, 10, s)) / 0.01;
    expect(slope(band * s.riser * 0.5)).toBeGreaterThan(2); // inside a riser
    expect(slope(band * (s.riser + (1 - s.riser) / 2))).toBeLessThan(0.5); // on a tread
  });

  it('gives big hills one sheer wall and smaller ones terraces', () => {
    expect(cliffStyle(20, 0.5).bands).toBe(1);
    expect(cliffStyle(8, 0.2).bands).toBe(2);
    expect(cliffStyle(8, 0.9).bands).toBe(3);
  });
});
