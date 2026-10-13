import * as THREE from 'three/webgpu';
import { WORLD_SCALE } from './zoneScene';

/** Where hidden instances go: far below the world, at zero size (billboards ignore the size, not the position). */
const AWAY = new THREE.Matrix4().makeScale(0, 0, 0).setPosition(0, -1e6, 0);

/**
 * Hide every instance of the instanced meshes under `root` (trees, plants, rocks, bodies, sprite billboards) whose
 * position is inside `area` (BaK world units, x east and y north). Returns a function that puts them back.
 */
export function hideInstancesWhere(root: THREE.Object3D, area: (x: number, y: number) => boolean): () => void {
  const hidden: { mesh: THREE.InstancedMesh; index: number; matrix: THREE.Matrix4 }[] = [];
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const mesh = o as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh) return;
    let changed = false;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      p.setFromMatrixPosition(m).applyMatrix4(mesh.matrixWorld);
      if (!area(p.x * WORLD_SCALE, -p.z * WORLD_SCALE)) continue;
      hidden.push({ mesh, index: i, matrix: m.clone() });
      mesh.setMatrixAt(i, AWAY);
      changed = true;
    }
    if (changed) mesh.instanceMatrix.needsUpdate = true;
  });
  return () => {
    for (const h of hidden) {
      h.mesh.setMatrixAt(h.index, h.matrix);
      h.mesh.instanceMatrix.needsUpdate = true;
    }
    hidden.length = 0;
  };
}
