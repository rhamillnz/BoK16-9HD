import { describe, expect, it } from 'vitest';
import { sceneHash, sceneHdUrl } from './sceneHd';

describe('sceneHash', () => {
  it('is stable, 8 hex digits and sensitive to colour changes', () => {
    const a = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]);
    const b = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 7, 255]);
    expect(sceneHash(a)).toMatch(/^[0-9a-f]{8}$/);
    expect(sceneHash(a)).toBe(sceneHash(new Uint8ClampedArray(a)));
    expect(sceneHash(a)).not.toBe(sceneHash(b));
  });
  it('ignores alpha', () => {
    expect(sceneHash([1, 2, 3, 255])).toBe(sceneHash([1, 2, 3, 0]));
  });
  it('maps to a path under /art/scenes-4x', () => {
    expect(sceneHdUrl('0123abcd')).toBe('/art/scenes-4x/0123abcd.png');
  });
});
