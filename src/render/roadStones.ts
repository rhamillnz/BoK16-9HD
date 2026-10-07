import * as THREE from 'three/webgpu';
import { hash2 } from './grassMath';

/** Override-manifest names of the stones lying along road edges (Quaternius RockPath/Pebble pieces). */
export const ROAD_STONES = ['scatter_stone1', 'scatter_stone2', 'scatter_stone3', 'scatter_stone4'] as const;

export interface RoadStoneOptions {
  seed: number;
  /** Chance that a road-edge cell gets a stone group. */
  keep: number;
  /** Stones per group (1..max). */
  maxPerGroup: number;
  /** Scatter radius around the cell centre, world units. */
  jitter: number;
  maxInstances: number;
}

export const DEFAULT_ROAD_STONES: Omit<RoadStoneOptions, 'seed'> = { keep: 0.3, maxPerGroup: 3, jitter: 0.9, maxInstances: 30_000 };

/** Stones are small: chunks of this edge (world units) are hidden beyond ROAD_STONE_FAR. */
export const ROAD_STONE_CHUNK = 32;
export const ROAD_STONE_FAR = 60;

export interface RoadStonePlacement {
  name: string;
  matrix: THREE.Matrix4;
}

/**
 * Stones along road edges. `points` are render-space (x, z) road-edge cell centres, `height` returns the
 * ground height at a render-space (x, z). Deterministic per seed; `available` limits to loaded models.
 */
export function roadStonePlacements(
  points: readonly (readonly [number, number])[],
  height: (x: number, z: number) => number,
  available: ReadonlySet<string>,
  opts: RoadStoneOptions,
): RoadStonePlacement[] {
  const names = ROAD_STONES.filter((n) => available.has(n));
  if (!names.length) return [];
  const out: RoadStonePlacement[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  points.forEach(([cx, cz], idx) => {
    if (hash2(idx, opts.seed, 11) > opts.keep) return;
    const n = 1 + Math.floor(hash2(idx, opts.seed, 12) * opts.maxPerGroup);
    for (let k = 0; k < n; k++) {
      const h = (salt: number) => hash2(idx * 7 + k, opts.seed, 20 + salt);
      const x = cx + (h(0) - 0.5) * 2 * opts.jitter;
      const z = cz + (h(1) - 0.5) * 2 * opts.jitter;
      const s = 0.8 + h(2) * 0.7;
      const q = new THREE.Quaternion().setFromAxisAngle(up, h(3) * Math.PI * 2);
      // Sunk a little so the stone beds into the ground.
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, height(x, z) - 0.02 * s, z), q, new THREE.Vector3(s, s, s));
      out.push({ name: names[Math.floor(h(4) * names.length)]!, matrix: m });
    }
  });
  if (out.length <= opts.maxInstances) return out;
  const keep = opts.maxInstances / out.length;
  return out.filter((_, i) => hash2(i, opts.seed, 99) < keep);
}
