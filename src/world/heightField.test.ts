import { describe, expect, it } from 'vitest';
import { buildHeightField } from './heightField';

// Right triangle covering x,y in the (0,0)-(1000,1000) corner, sloping from z=0 to z=100 along x.
const slope = [0, 0, 0, 1000, 0, 100, 0, 1000, 0];

describe('buildHeightField', () => {
  it('interpolates height inside a triangle', () => {
    const f = buildHeightField(slope);
    expect(f.getHeight(500, 200)).toBeCloseTo(50);
    expect(f.getHeight(100, 100)).toBeCloseTo(10);
  });

  it('returns 0 outside every triangle', () => {
    const f = buildHeightField(slope);
    expect(f.getHeight(900, 900)).toBe(0);
    expect(f.getHeight(-50, 10)).toBe(0);
    expect(f.getHeight(99999, 99999)).toBe(0);
    expect(buildHeightField([]).getHeight(0, 0)).toBe(0);
  });

  it('returns the highest of overlapping triangles', () => {
    const flat = (z: number) => [0, 0, z, 1000, 0, z, 0, 1000, z];
    const f = buildHeightField([...flat(10), ...flat(300), ...flat(50)]);
    expect(f.getHeight(100, 100)).toBeCloseTo(300);
  });

  it('finds triangles spanning several grid cells and negative coordinates', () => {
    const big = [-5000, -5000, 20, 5000, -5000, 20, 0, 5000, 20];
    const f = buildHeightField(big, 1600);
    expect(f.getHeight(0, 0)).toBeCloseTo(20);
    expect(f.getHeight(-3000, -4000)).toBeCloseTo(20);
    expect(f.getHeight(4500, 4500)).toBe(0);
  });

  it('ignores vertical and degenerate triangles', () => {
    const f = buildHeightField([0, 0, 0, 0, 0, 100, 0, 0, 50]);
    expect(f.getHeight(0, 0)).toBe(0);
  });
});
