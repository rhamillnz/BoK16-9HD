import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { isHillModel, smoothNormals } from './hillMesh';

describe('isHillModel', () => {
  it('matches landscape models only', () => {
    for (const n of ['zero1', 'zero9', 'one2', 'landscp4', 'genmtn', 'stonemtn']) expect(isHillModel(n)).toBe(true);
    for (const n of ['house', 'tree1', 'ground', 'g01', 'onefoo', 'zeroes']) expect(isHillModel(n)).toBe(false);
  });
});

describe('smoothNormals', () => {
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  it('gives a flat quad an up normal', () => {
    // Clockwise seen from above, like the original models.
    const quad = [v(0, 0, 0), v(0, 0, -1), v(1, 0, -1), v(1, 0, 0)];
    const n = smoothNormals([[0, 1, 2, 3]], [quad]);
    for (let i = 0; i < 4; i++) expect(n.get(i)!.y).toBeCloseTo(1);
  });
  it('averages the normals of two faces meeting at a shared vertex', () => {
    // Ridge along z: face A slopes up towards +x, face B down; they share vertices 2 and 3.
    const A = [v(0, 0, 0), v(0, 0, -1), v(1, 1, -1), v(1, 1, 0)];
    const B = [v(1, 1, 0), v(1, 1, -1), v(2, 0, -1), v(2, 0, 0)];
    const n = smoothNormals([[0, 1, 2, 3], [3, 2, 4, 5]], [A, B]);
    expect(n.get(3)!.x).toBeCloseTo(0);
    expect(n.get(3)!.y).toBeCloseTo(1);
    expect(n.get(0)!.x).toBeLessThan(0);
    expect(n.get(5)!.x).toBeGreaterThan(0);
  });
});
