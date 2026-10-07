import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createTerrainMaterial } from '../src/render/terrainMaterial';

describe('createTerrainMaterial', () => {
  it('builds a double-sided standard node material with a colour node', () => {
    const tex = new THREE.DataTexture(new Uint8Array([10, 120, 30, 255]), 1, 1);
    const m = createTerrainMaterial(tex, 0);
    expect(m).toBeInstanceOf(THREE.MeshStandardNodeMaterial);
    expect(m.colorNode).toBeTruthy();
    expect(m.side).toBe(THREE.DoubleSide);
  });
});
