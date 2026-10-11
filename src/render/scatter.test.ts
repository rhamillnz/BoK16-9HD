import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCATTER,
  SCATTER_COVER,
  SCATTER_MODELS,
  SCATTER_PINES,
  SCATTER_ROCKS,
  SCATTER_SCREE,
  SCATTER_SHRUBS,
  chunkPlacements,
  clumpField,
  rng,
  scatterOnTriangles,
} from './scatter';

const all = new Set(SCATTER_MODELS);
const opts = { ...DEFAULT_SCATTER, seed: 1 };
const inList = (list: readonly string[]) => (n: string) => list.includes(n);
const isRock = inList(SCATTER_ROCKS);
const isCover = inList(SCATTER_COVER);
const isShrub = inList(SCATTER_SHRUBS);
const isPlant = (n: string) => isCover(n) || isShrub(n);
const isPine = inList(SCATTER_PINES);
const isScree = (n: string) => isRock(n) || inList(SCATTER_SCREE)(n);

/** A horizontal square (two upward triangles) of side `size` at height `y`, corner at (x0, z0). */
function square(x0: number, z0: number, size: number, y: number): number[] {
  const x1 = x0 + size;
  const z1 = z0 + size;
  return [x0, y, z0, x0, y, z1, x1, y, z0, x1, y, z0, x0, y, z1, x1, y, z1];
}
/** A vertical wall along +x facing +z (normal.z = 1), from y = 0 up to `height`. */
function wall(length: number, height: number, z = 0): number[] {
  return [0, 0, z, length, 0, z, 0, height, z, length, 0, z, length, height, z, 0, height, z];
}

const flat = square(0, 0, 40, 2);
const underside = [0, 0, 0, 40, 0, 0, 0, 40, 10, 40, 0, 0, 40, 40, 10, 0, 40, 10];
const countBy = (res: { name: string }[], f: (n: string) => boolean) => res.filter((p) => f(p.name)).length;
const pos = (m: { matrix: { elements: ArrayLike<number> } }) => ({
  x: m.matrix.elements[12]!,
  y: m.matrix.elements[13]!,
  z: m.matrix.elements[14]!,
});

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

describe('clumpField', () => {
  it('is in [0, 1] and depends only on position and seed', () => {
    for (let i = 0; i < 200; i++) {
      const f = clumpField(i * 1.7, i * 0.9, 3, opts);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
      expect(f).toBe(clumpField(i * 1.7, i * 0.9, 3, opts));
    }
  });
  it('is zero over a good part of the ground and high at some centres', () => {
    let zero = 0;
    let high = 0;
    for (let x = 0; x < 100; x += 0.5) {
      for (let z = 0; z < 100; z += 0.5) {
        const f = clumpField(x, z, 2, opts);
        if (f === 0) zero++;
        if (f > 0.9) high++;
      }
    }
    expect(zero).toBeGreaterThan(0.3 * 200 * 200);
    expect(high).toBeGreaterThan(0);
  });
});

describe('scatterOnTriangles', () => {
  it('is repeatable for a seed and differs between seeds', () => {
    const run = (seed: number) =>
      scatterOnTriangles(flat, all, { ...opts, seed }).map((p) => p.name + p.matrix.elements.join());
    expect(run(1)).toEqual(run(1));
    expect(run(1)).not.toEqual(run(2));
  });

  it('puts mostly plants on gentle ground', () => {
    const res = scatterOnTriangles(square(0, 0, 100, 2), all, opts);
    expect(countBy(res, isPlant)).toBeGreaterThan(countBy(res, isRock));
  });

  it('clumps plants: none outside a clump without a floor, and cell counts vary strongly', () => {
    const none = { ...opts, clumpFloor: 0 };
    const res = scatterOnTriangles(square(0, 0, 200, 2), all, none).filter((p) => isPlant(p.name));
    expect(res.length).toBeGreaterThan(100);
    for (const p of res) {
      const { x, z } = pos(p);
      expect(clumpField(x, z, none.seed, none)).toBeGreaterThan(0);
    }
    // 10 x 10 unit cells: variance well above the mean (a uniform scatter would have variance ~ mean).
    const cells = new Map<string, number>();
    for (const p of res) {
      const { x, z } = pos(p);
      const k = `${Math.floor(x / 10)},${Math.floor(z / 10)}`;
      cells.set(k, (cells.get(k) ?? 0) + 1);
    }
    const counts: number[] = [];
    for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) counts.push(cells.get(`${i},${j}`) ?? 0);
    const mean = counts.reduce((s, v) => s + v, 0) / counts.length;
    const variance = counts.reduce((s, v) => s + (v - mean) ** 2, 0) / counts.length;
    expect(variance).toBeGreaterThan(2 * mean);
  });

  it('keeps plants off steep ground and out of faces that point down', () => {
    // A ramp rising 1 in 1 (normal.y ~ 0.71 < 0.75): rocks only, no plants.
    const ramp = [0, 0, 0, 0, 40, 40, 40, 0, 0, 40, 0, 0, 0, 40, 40, 40, 40, 40];
    const res = scatterOnTriangles(ramp, all, opts);
    expect(res.length).toBeGreaterThan(0);
    expect(countBy(res, isPlant)).toBe(0);
    expect(scatterOnTriangles(underside, all, opts)).toEqual([]);
  });

  it('puts pines only on big flat tops well above the foot, scaled down', () => {
    // A 64 x 64 top at height 10 with a low patch beyond each corner (the hill's foot).
    const foot = [
      ...square(-20, -20, 20, 0),
      ...square(64, -20, 20, 0),
      ...square(-20, 64, 20, 0),
      ...square(64, 64, 20, 0),
    ];
    const bigTop = scatterOnTriangles([...foot, ...square(0, 0, 64, 10)], all, opts);
    const pines = bigTop.filter((p) => isPine(p.name));
    expect(pines.length).toBeGreaterThan(0);
    for (const p of pines) {
      const { x, z } = pos(p);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(64);
      expect(z).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThanOrEqual(64);
      const e = p.matrix.elements;
      const sx = Math.hypot(e[0]!, e[1]!, e[2]!);
      expect(sx).toBeGreaterThanOrEqual(0.5 - 1e-6);
      expect(sx).toBeLessThanOrEqual(0.8 + 1e-6);
    }
    // Same top only 2 units above the foot, or a small flat patch: no pines.
    expect(countBy(scatterOnTriangles([...foot, ...square(0, 0, 64, 2)], all, opts), isPine)).toBe(0);
    expect(countBy(scatterOnTriangles([...foot, ...square(0, 0, 6, 10)], all, opts), isPine)).toBe(0);
  });

  it('piles scree at the foot of a wall and nowhere higher up', () => {
    const res = scatterOnTriangles(wall(60, 30), all, opts);
    const scree = res.filter((p) => isScree(p.name));
    expect(scree.length).toBeGreaterThan(20);
    expect(countBy(res, isPlant)).toBe(0);
    for (const p of scree) {
      const { x, y, z } = pos(p);
      expect(y).toBeLessThanOrEqual(opts.screeBand);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(60);
      // Pushed out from the wall into open ground (the wall faces +z).
      expect(z).toBeGreaterThan(0);
    }
    // Loose stones as well as boulders.
    expect(scree.some((p) => !isRock(p.name))).toBe(true);
    expect(scree.some((p) => isRock(p.name))).toBe(true);
  });

  it('respects the per-category caps and the overall cap', () => {
    const big = square(0, 0, 200, 2);
    const capped = { ...opts, maxCover: 7, maxShrubs: 3, maxRocks: 2, maxPines: 1, maxScree: 4 };
    const res = scatterOnTriangles([...big, ...wall(100, 20)], all, capped);
    expect(countBy(res, isCover)).toBeLessThanOrEqual(7);
    expect(countBy(res, isShrub)).toBeLessThanOrEqual(3);
    expect(res.length).toBeLessThanOrEqual(7 + 3 + 2 + 1 + 4);
    expect(scatterOnTriangles(big, all, { ...opts, maxInstances: 5 }).length).toBeLessThanOrEqual(20);
  });

  it('only uses models that loaded', () => {
    const res = scatterOnTriangles(flat, new Set(['bush1']), opts);
    expect(res.length).toBeGreaterThan(0);
    expect(res.every((p) => p.name === 'bush1')).toBe(true);
  });
});

describe('chunkPlacements', () => {
  it('groups by model and ground cell, keeping every placement once', () => {
    const res = scatterOnTriangles(square(0, 0, 150, 2), all, opts);
    const chunks = chunkPlacements(res, 50);
    expect(chunks.reduce((s, c) => s + c.matrices.length, 0)).toBe(res.length);
    for (const c of chunks) {
      for (const m of c.matrices) {
        expect(Math.floor(m.elements[12]! / 50)).toBe(c.cx);
        expect(Math.floor(m.elements[14]! / 50)).toBe(c.cz);
      }
    }
    const keys = chunks.map((c) => `${c.name}|${c.cx}|${c.cz}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('boulders on sheer walls', () => {
  it('puts none on a vertical face above the scree band', () => {
    // A tall wall whose foot is far below (the scree band ends 2 units above the foot).
    const placed = scatterOnTriangles(wall(40, 30), all, { ...opts, screeDensity: 0, rockDensity: 0.5 });
    expect(countBy(placed, isRock)).toBe(0);
  });
});
