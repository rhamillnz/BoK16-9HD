import { describe, expect, it } from 'vitest';
import { SurfaceIndex } from './surfaceIndex';

describe('SurfaceIndex', () => {
  // A 10 x 10 square at height 5 (two triangles), and a slope from 0 to 10 over x = 20..30.
  const tris = new Float32Array([
    0, 5, 0, 10, 5, 0, 10, 5, 10, 0, 5, 0, 10, 5, 10, 0, 5, 10, 20, 0, 0, 30, 10, 0, 30, 10, 10,
  ]);
  const index = new SurfaceIndex(tris, 4);

  it('finds the height inside a triangle and nothing outside', () => {
    expect(index.heightAt(3, 7)).toBeCloseTo(5);
    expect(index.heightAt(25, 1)).toBeCloseTo(5);
    expect(index.heightAt(15, 5)).toBeUndefined();
    expect(index.heightAt(-50, -50)).toBeUndefined();
  });

  it('takes the highest of overlapping triangles and skips vertical walls', () => {
    const stacked = new SurfaceIndex(
      new Float32Array([0, 1, 0, 8, 1, 0, 0, 1, 8, 0, 3, 0, 8, 3, 0, 0, 3, 8, 0, 0, 0, 0, 9, 0, 8, 0, 0]),
    );
    expect(stacked.heightAt(1, 1)).toBeCloseTo(3);
  });
});
