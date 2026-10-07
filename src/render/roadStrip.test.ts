import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { stripAcross } from './zoneScene';

const v = (x: number, z: number) => new THREE.Vector3(x, 0, z);

describe('stripAcross', () => {
  it('puts the corners of each long edge on the same side', () => {
    // A road running along x: edges 0-1 and 2-3 are the long sides.
    expect(stripAcross([v(0, 0), v(50, 0), v(50, 18), v(0, 18)])).toEqual([0, 0, 1, 1]);
    // The same road listed from a corner on a short edge: 0-1 and 2-3 cross it.
    expect(stripAcross([v(0, 18), v(0, 0), v(50, 0), v(50, 18)])).toEqual([0, 1, 1, 0]);
  });
  it('marks anything but a quad as unknown', () => {
    expect(stripAcross([v(0, 0), v(1, 0), v(1, 1), v(0.5, 2), v(0, 1)])).toEqual([-1, -1, -1, -1, -1]);
  });
});
