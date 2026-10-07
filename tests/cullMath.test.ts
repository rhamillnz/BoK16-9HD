import { describe, expect, it } from 'vitest';
import { beyondFar, chunkBillboards } from '../src/render/cullMath';

describe('chunkBillboards', () => {
  it('groups instances by ground chunk and keeps every float', () => {
    const data = [1, 0, 1, 2, 3, 40, 0, 2, 2, 3, 5, 9, 6, 2, 3];
    const chunks = chunkBillboards(data, 32);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual([1, 0, 1, 2, 3, 5, 9, 6, 2, 3]);
    expect(chunks[1]).toEqual([40, 0, 2, 2, 3]);
    expect(chunks.flat().length).toBe(data.length);
  });
  it('handles negative coordinates', () => {
    expect(chunkBillboards([-1, 0, -1, 1, 1, 1, 0, 1, 1, 1], 32)).toHaveLength(2);
  });
});

describe('beyondFar', () => {
  it('culls only chunks wholly past the far distance', () => {
    expect(beyondFar(0, 0, 100, 0, 10, 50)).toBe(true);
    expect(beyondFar(0, 0, 55, 0, 10, 50)).toBe(false);
    expect(beyondFar(0, 0, 0, 0, 10, 50)).toBe(false);
  });
});
