import * as THREE from 'three/webgpu';
import { hash2 } from './grassMath';

/** Override names that are plants drawn from the nature kit (trees, groves, ferns, bushes). */
export const isPlantModel = (name: string): boolean => /^(tree\d|grove|fern|bush\d)/.test(name);

/**
 * Per-zone colour of the foliage (multipliers on the model's own colour), chosen to follow the original
 * tree sprites of the zone (art/reference/Z??/slots-4x): zone 6's sprites are cold blue-grey (the frosty
 * north), zones 5, 7 and 8 darker pines and dark undergrowth; the rest keep the kit's green.
 */
export const ZONE_FOLIAGE: Readonly<Record<number, readonly [number, number, number]>> = {
  5: [0.85, 0.92, 0.88],
  6: [0.86, 0.98, 1.12],
  7: [0.88, 0.94, 0.9],
  8: [0.72, 0.82, 0.74],
};
const NEUTRAL: readonly [number, number, number] = [1, 1, 1];

/**
 * Leaf colours for the plants scattered over the hills (multipliers): deep green, olive, sage and the kit's own,
 * one per plant, so clumps read as mixed scrub rather than one colour.
 */
export const HILL_FOLIAGE: readonly (readonly [number, number, number])[] = [
  [0.72, 0.95, 0.9],
  [0.95, 0.82, 0.55],
  [0.86, 0.92, 0.8],
  [1, 1, 1],
];

/** Spread of the per-instance variation: height, width and colour. */
export const TREE_VARIATION = { height: 0.22, width: 0.12, tone: 0.14, hue: 0.07 } as const;

export interface StyledInstances {
  matrices: THREE.Matrix4[];
  /** One colour per matrix (multiplies the model's colour). */
  colors: THREE.Color[];
}

/**
 * Break up cloned forests: every instance gets its own height (+-22%), a slightly different width, a
 * brightness and a small warm/cool shift, all derived from its position so a tree always looks the same,
 * then the zone's foliage tint and, with a `palette`, one of its colours picked per instance. Rotation about Y is left alone (placements already carry the original yaw).
 */
export function styleInstances(
  zone: number,
  placements: readonly THREE.Matrix4[],
  palette?: readonly (readonly [number, number, number])[],
): StyledInstances {
  const tint = ZONE_FOLIAGE[zone] ?? NEUTRAL;
  const matrices: THREE.Matrix4[] = [];
  const colors: THREE.Color[] = [];
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  for (const m of placements) {
    m.decompose(pos, quat, scale);
    const kx = Math.round(pos.x * 10);
    const kz = Math.round(pos.z * 10);
    const r = (salt: number) => hash2(kx, kz, salt) * 2 - 1;
    const h = 1 + r(1) * TREE_VARIATION.height;
    const w = (1 + r(2) * TREE_VARIATION.width) * (0.5 + 0.5 * h);
    matrices.push(new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(scale.x * w, scale.y * h, scale.z * w)));
    const tone = 1 + r(3) * TREE_VARIATION.tone;
    const hue = r(4) * TREE_VARIATION.hue;
    const own = palette?.length ? palette[Math.floor(hash2(kx, kz, 5) * palette.length) % palette.length]! : NEUTRAL;
    colors.push(
      new THREE.Color(
        tint[0] * own[0] * tone * (1 + hue),
        tint[1] * own[1] * tone,
        tint[2] * own[2] * tone * (1 - hue),
      ),
    );
  }
  return { matrices, colors };
}

/** Apply `colors` as per-instance colours to meshes built from the same placements. */
export function applyInstanceColors(meshes: readonly THREE.InstancedMesh[], colors: readonly THREE.Color[]): void {
  for (const mesh of meshes) {
    colors.forEach((c, i) => mesh.setColorAt(i, c));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}
