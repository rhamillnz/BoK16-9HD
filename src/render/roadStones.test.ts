import { describe, expect, it } from 'vitest';
import { DEFAULT_ROAD_STONES, ROAD_STONES, roadStonePlacements } from './roadStones';

const all = new Set<string>(ROAD_STONES);
const opts = { ...DEFAULT_ROAD_STONES, seed: 3 };
const points: [number, number][] = Array.from({ length: 400 }, (_, i) => [i % 20, Math.floor(i / 20)]);
const flat = () => 5;

describe('roadStonePlacements', () => {
  it('is deterministic and uses ground height', () => {
    const a = roadStonePlacements(points, flat, all, opts);
    const b = roadStonePlacements(points, flat, all, opts);
    expect(a.map((p) => p.matrix.elements.join())).toEqual(b.map((p) => p.matrix.elements.join()));
    expect(a.length).toBeGreaterThan(50);
    for (const p of a) expect(p.matrix.elements[13]).toBeCloseTo(5, 0);
  });
  it('keeps stones within the jitter radius of their cell', () => {
    for (const p of roadStonePlacements([[10, 10]], flat, all, { ...opts, keep: 1 })) {
      expect(Math.abs(p.matrix.elements[12]! - 10)).toBeLessThanOrEqual(opts.jitter);
      expect(Math.abs(p.matrix.elements[14]! - 10)).toBeLessThanOrEqual(opts.jitter);
    }
  });
  it('respects the cap and the set of loaded models', () => {
    expect(roadStonePlacements(points, flat, all, { ...opts, keep: 1, maxInstances: 30 }).length).toBeLessThanOrEqual(60);
    expect(roadStonePlacements(points, flat, new Set(), opts)).toEqual([]);
    const some = roadStonePlacements(points, flat, new Set(['scatter_stone2']), opts);
    expect(some.every((p) => p.name === 'scatter_stone2')).toBe(true);
  });
});
