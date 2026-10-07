import { describe, expect, it } from 'vitest';
import { buildGroundMask, cellInView, cellsAround, hash2, lodKeep, scatterCell } from './grassMath';

describe('hash2', () => {
  it('is deterministic and within [0, 1)', () => {
    expect(hash2(3, 4, 5)).toBe(hash2(3, 4, 5));
    for (let i = 0; i < 200; i++) {
      const h = hash2(i, -i * 3, 1);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
    expect(hash2(1, 2, 0)).not.toBe(hash2(2, 1, 0));
  });
});

describe('scatterCell', () => {
  it('is stable, stays inside its cell and drops points off the ground', () => {
    const everywhere = () => 2;
    const a = scatterCell(2, -3, 8, 1, everywhere);
    expect(a).toEqual(scatterCell(2, -3, 8, 1, everywhere));
    expect(a.length / 8).toBe(64);
    for (let i = 0; i < a.length; i += 8) {
      expect(a[i]).toBeGreaterThanOrEqual(2 * 8);
      expect(a[i]).toBeLessThan(3 * 8);
      expect(a[i + 2]).toBeGreaterThanOrEqual(-3 * 8);
      expect(a[i + 2]).toBeLessThan(-2 * 8);
      expect(a[i + 1]).toBe(2);
    }
    const half = scatterCell(2, -3, 8, 1, (x) => (x < 20 ? 0 : null));
    expect(half.length).toBeGreaterThan(0);
    expect(half.length).toBeLessThan(a.length);
    for (let i = 0; i < half.length; i += 8) expect(half[i]).toBeLessThan(20);
    expect(scatterCell(0, 0, 8, 1, () => null).length).toBe(0);
  });
});

describe('lodKeep', () => {
  it('falls linearly from 1 at the centre to farKeep at the ring edge', () => {
    expect(lodKeep(0, 6, 0.2)).toBe(1);
    expect(lodKeep(3, 6, 0.2)).toBeCloseTo(0.6);
    expect(lodKeep(6, 6, 0.2)).toBeCloseTo(0.2);
    expect(lodKeep(99, 6, 0.2)).toBeCloseTo(0.2);
  });
});

describe('cellsAround', () => {
  it('returns a round ring sorted nearest first, centred on the camera cell', () => {
    const cells = cellsAround(17, -3, 8, 3);
    expect(cells[0]).toEqual([2, -1, 0]);
    expect(cells.length).toBeLessThan(49);
    expect(cells.length).toBeGreaterThan(25);
    for (let i = 1; i < cells.length; i++) expect(cells[i]![2]).toBeGreaterThanOrEqual(cells[i - 1]![2]);
  });
});

describe('cellInView', () => {
  const view = (cx: number, cz: number) => cellInView(cx, cz, 8, 0, 0, 0, -1, Math.PI / 4);
  it('keeps cells ahead and near the camera, culls cells behind', () => {
    expect(view(0, -4)).toBe(true);
    expect(view(0, 3)).toBe(false);
    expect(view(0, 0)).toBe(true);
    expect(view(0, -1)).toBe(true);
    expect(view(10, 0)).toBe(false);
  });
});

describe('buildGroundMask', () => {
  // Ground square (0..1000)^2 as two triangles, with a road strip x in 400..600 covering it.
  const quad = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y0, 0, x1, y1, 0, x0, y1, 0];
  const mask = buildGroundMask(quad(0, 0, 1000, 1000), quad(400, 0, 600, 1000));
  it('is on over ground and off over cover and outside', () => {
    expect(mask.get(100, 500)).toBe(true);
    expect(mask.get(900, 900)).toBe(true);
    expect(mask.get(500, 500)).toBe(false);
    expect(mask.get(-500, 500)).toBe(false);
    expect(mask.get(5000, 5000)).toBe(false);
  });
  it('handles an empty ground set', () => {
    expect(buildGroundMask([], []).get(0, 0)).toBe(false);
  });
});
