import { describe, expect, it } from 'vitest';
import { ART_HEIGHT, ART_WIDTH, fadeAlpha, flicker, layoutTitle } from './titleScreen';

describe('layoutTitle', () => {
  for (const [w, h] of [
    [2560, 1440],
    [1920, 1080],
    [1280, 720],
  ] as const) {
    it(`fits ${w}x${h} at a whole scale, centred, with the menu below the heads`, () => {
      const l = layoutTitle(w, h);
      expect(Number.isInteger(l.scale)).toBe(true);
      expect(l.sheet.width).toBe(ART_WIDTH * l.scale);
      expect(l.sheet.height).toBe(ART_HEIGHT * l.scale);
      expect(l.sheet.x).toBeGreaterThanOrEqual(0);
      expect(l.sheet.y).toBeGreaterThanOrEqual(0);
      expect(l.sheet.x * 2 + l.sheet.width).toBeGreaterThanOrEqual(w - 1);
      expect(l.logo.x).toBeGreaterThanOrEqual(l.sheet.x);
      expect(l.logo.x + l.logo.width).toBeLessThanOrEqual(l.sheet.x + l.sheet.width);
      for (const hd of l.heads) expect(hd.y + hd.height).toBeLessThanOrEqual(l.menuTop);
      expect(l.heads[0]!.x).toBeGreaterThanOrEqual(l.sheet.x);
      expect(l.heads[2]!.x + l.heads[2]!.width).toBeLessThanOrEqual(l.sheet.x + l.sheet.width);
      expect(l.menuTop).toBeLessThan(l.sheet.y + l.sheet.height);
    });
  }
});

describe('animation helpers', () => {
  it('fades from 0 to 1 and clamps', () => {
    expect(fadeAlpha(-1)).toBe(0);
    expect(fadeAlpha(0.7, 1.4)).toBeCloseTo(0.5);
    expect(fadeAlpha(9)).toBe(1);
  });
  it('flicker stays in range', () => {
    for (let t = 0; t < 60; t += 0.07) {
      expect(flicker(t)).toBeGreaterThanOrEqual(0);
      expect(flicker(t)).toBeLessThanOrEqual(0.07);
    }
  });
});
