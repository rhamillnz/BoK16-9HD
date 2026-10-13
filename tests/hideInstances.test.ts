import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { hideInstancesWhere } from '../src/render/hideInstances';
import { WORLD_SCALE } from '../src/render/zoneScene';

describe('hideInstancesWhere', () => {
  it('moves the instances inside the area away and puts them back', () => {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicNodeMaterial(), 2);
    // Render space: x east, z south; BaK (1000, 2000) is render (10, 0, -20).
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(1000 / WORLD_SCALE, 0, -2000 / WORLD_SCALE));
    mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(90, 0, -90));
    const root = new THREE.Group().add(mesh);
    const seen: [number, number][] = [];
    const restore = hideInstancesWhere(root, (x, y) => {
      seen.push([Math.round(x), Math.round(y)]);
      return x < 5000;
    });
    expect(seen).toEqual([
      [1000, 2000],
      [9000, 9000],
    ]);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    mesh.getMatrixAt(0, m);
    expect(p.setFromMatrixPosition(m).y).toBeLessThan(-1000);
    mesh.getMatrixAt(1, m);
    expect(p.setFromMatrixPosition(m).x).toBe(90);
    restore();
    mesh.getMatrixAt(0, m);
    expect(p.setFromMatrixPosition(m).toArray()).toEqual([10, 0, -20]);
  });
});
