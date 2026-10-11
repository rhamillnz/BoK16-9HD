import { describe, expect, it } from 'vitest';
import { closeOpenSides, openEdges } from './hillCliffs';
import type { DetailedHill } from './hillDetail';

/** A lean-to: two triangles rising from the ground to a ridge, open at both ends and along the ridge. */
const leanTo = (): DetailedHill => ({
  positions: [0, 0, 0, 4, 0, 0, 0, 3, -2, 4, 0, 0, 4, 3, -2, 0, 3, -2],
  normals: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
  source: [0, 1],
});

describe('closeOpenSides', () => {
  it('finds the edges that stop above the ground', () => {
    // The two sloping ends and the ridge; the foot along the ground does not count.
    expect(openEdges(leanTo(), 0)).toHaveLength(3);
  });

  it('hangs a wall from each, leaving no open edge above the ground', () => {
    const closed = closeOpenSides(leanTo(), 0);
    expect(closed.positions.length).toBeGreaterThan(leanTo().positions.length);
    expect(openEdges(closed, 0)).toEqual([]);
    expect(closed.normals.length).toBe(closed.positions.length);
    expect(closed.source.length * 9).toBe(closed.positions.length);
    // Walls reach below the ground.
    expect(Math.min(...closed.positions.filter((_, i) => i % 3 === 1))).toBeLessThan(0);
  });

  it('leaves a closed hill alone', () => {
    const closed = closeOpenSides(leanTo(), 0);
    expect(closeOpenSides(closed, 0)).toBe(closed);
  });
});
