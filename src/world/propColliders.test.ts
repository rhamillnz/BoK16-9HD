import { describe, expect, it } from 'vitest';
import { pointInPolygon } from './collision';
import { SOLID_PROPS, footprintPolygon } from './propColliders';

describe('footprintPolygon', () => {
  it('blocks the middle of the footprint and leaves its rim free', () => {
    const p = footprintPolygon(100, 200, 300, 600);
    expect(pointInPolygon(p, 200, 400)).toBe(true);
    expect(pointInPolygon(p, 105, 205)).toBe(false);
    expect(p.minX).toBeCloseTo(120);
    expect(p.maxY).toBeCloseTo(560);
  });
  it('names the stand-up props only', () => {
    for (const n of ['dirtpile', 'tstone1', 'tstone5']) expect(SOLID_PROPS.test(n)).toBe(true);
    for (const n of ['fireold', 'dbody2', 'corn', 'tstone']) expect(SOLID_PROPS.test(n)).toBe(false);
  });
});
