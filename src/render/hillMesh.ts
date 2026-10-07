import * as THREE from 'three/webgpu';

/** Original landscape/mountain models: palette-coloured, flat-shaded faces (zero1..9, one1..3, landscp1..4, genmtn, stonemtn). */
const HILL_NAME = /^(zero\d|one\d|landscp\d|genmtn|stonemtn)/i;

export const isHillModel = (name: string): boolean => HILL_NAME.test(name);

/**
 * Area-weighted smooth normal per shared vertex, outward for the original clockwise winding. `corners` are the positions of each face's
 * vertex indices (world space), one array per face; `indices` the
 * matching model vertex indices. Returns a Map from vertex index to unit normal.
 */
export function smoothNormals(indices: number[][], corners: THREE.Vector3[][]): Map<number, THREE.Vector3> {
  const acc = new Map<number, THREE.Vector3>();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  indices.forEach((face, f) => {
    const loop = corners[f]!;
    if (face.length < 3) return;
    // Newell's method: robust for quads and slightly non-planar polygons; length = 2 x area.
    const n = new THREE.Vector3();
    for (let i = 0; i < loop.length; i++) {
      a.copy(loop[i]!);
      b.copy(loop[(i + 1) % loop.length]!);
      n.x += (a.y - b.y) * (a.z + b.z);
      n.y += (a.z - b.z) * (a.x + b.x);
      n.z += (a.x - b.x) * (a.y + b.y);
    }
    // The original models wind faces clockwise seen from outside, so the geometric normal points inward.
    n.negate();
    for (const idx of face) {
      const v = acc.get(idx);
      if (v) v.add(n);
      else acc.set(idx, n.clone());
    }
  });
  for (const v of acc.values()) {
    if (v.lengthSq() > 0) v.normalize();
    else v.set(0, 1, 0);
  }
  return acc;
}
