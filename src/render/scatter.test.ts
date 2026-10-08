import { describe, expect, it } from 'vitest';
import { DEFAULT_SCATTER, SCATTER_MODELS, rng, scatterOnTriangles } from './scatter';

const all = new Set(SCATTER_MODELS);
const opts = { ...DEFAULT_SCATTER, seed: 1 };
// A 40 x 40 flat patch at height 2, a steep upward slope, and the same slope seen from below.
const flat = [0, 2, 0, 0, 2, 40, 40, 2, 0, 40, 2, 0, 0, 2, 40, 40, 2, 40];
const wall = [0, 0, 0, 0, 40, 10, 40, 0, 0, 40, 0, 0, 0, 40, 10, 40, 40, 10];
const underside = [0, 0, 0, 40, 0, 0, 0, 40, 10, 40, 0, 0, 40, 40, 10, 0, 40, 10];
const isRock = (n: string) => n.startsWith('scatter_rock');

describe('rng', () => {
  it('is deterministic and in [0, 1)', () => {
    const a = rng(7);
    const b = rng(7);
    for (let i = 0; i < 50; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('scatterOnTriangles', () => {
  it('is repeatable for a seed', () => {
    const x = scatterOnTriangles(flat, all, opts).map((p) => p.matrix.elements.join());
    const y = scatterOnTriangles(flat, all, opts).map((p) => p.matrix.elements.join());
    expect(x).toEqual(y);
  });
  it('puts mostly bushes on gentle ground and only rocks on a steep wall', () => {
    const gentle = scatterOnTriangles(flat, all, opts);
    expect(gentle.filter((p) => !isRock(p.name)).length).toBeGreaterThan(gentle.filter((p) => isRock(p.name)).length);
    const steep = scatterOnTriangles(wall, all, opts);
    expect(steep.length).toBeGreaterThan(0);
    expect(steep.every((p) => isRock(p.name))).toBe(true);
  });
  it('ignores faces that point downwards', () => {
    expect(scatterOnTriangles(underside, all, opts)).toEqual([]);
  });
  it('keeps placements on the triangle and inside the cap', () => {
    const res = scatterOnTriangles(flat, all, { ...opts, maxInstances: 5 });
    expect(res.length).toBeLessThanOrEqual(20);
    for (const p of res) {
      const e = p.matrix.elements;
      expect(e[12]).toBeGreaterThanOrEqual(0);
      expect(e[12]).toBeLessThanOrEqual(40);
      // On the surface (y = 2); rocks sink up to 0.8 x their largest scale (2.0) into it.
      expect(e[13]).toBeLessThanOrEqual(2 + 1e-9);
      expect(e[13]).toBeGreaterThanOrEqual(2 - 1.6 - 1e-9);
    }
  });
  it('only uses models that loaded', () => {
    const res = scatterOnTriangles(flat, new Set(['bush1']), opts);
    expect(res.length).toBeGreaterThan(0);
    expect(res.every((p) => p.name === 'bush1')).toBe(true);
  });
});
