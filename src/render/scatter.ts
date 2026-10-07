import * as THREE from 'three/webgpu';

/** Override-manifest names of the decor placed on hills (rocks on steep or high ground, bushes on gentle slopes). */
export const SCATTER_ROCKS = ['scatter_rock1', 'scatter_rock2', 'scatter_rock3'] as const;
export const SCATTER_BUSHES = ['bush1', 'bush2', 'bush4', 'fern'] as const;
export const SCATTER_MODELS: readonly string[] = [...SCATTER_ROCKS, ...SCATTER_BUSHES];

export interface ScatterOptions {
  seed: number;
  /** Instances per square render unit. */
  bushDensity: number;
  rockDensity: number;
  /** Rocks also crowd steep faces: density multiplier when 1 - normal.y exceeds `steep`. */
  steep: number;
  steepRockBoost: number;
  /** No bushes above this world height or on faces steeper than `bushMaxSlope`. */
  bushMaxAltitude: number;
  bushMaxSlope: number;
  /** Hard cap on instances (the whole set is thinned evenly beyond it). */
  maxInstances: number;
}

export const DEFAULT_SCATTER: Omit<ScatterOptions, 'seed'> = {
  bushDensity: 0.012,
  rockDensity: 0.004,
  steep: 0.3,
  steepRockBoost: 5,
  bushMaxAltitude: 14,
  bushMaxSlope: 0.3,
  maxInstances: 2500,
};

export interface ScatterPlacement {
  name: string;
  matrix: THREE.Matrix4;
}

/** mulberry32: small seedable PRNG so scatter is identical on every load. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Scatter rocks and bushes over counter-clockwise triangles (render space, 9 numbers each). Placement depends only on
 * the triangles and the seed. `available` limits the result to models that actually loaded.
 */
export function scatterOnTriangles(
  triangles: ArrayLike<number>,
  available: ReadonlySet<string>,
  opts: ScatterOptions,
): ScatterPlacement[] {
  const rocks = SCATTER_ROCKS.filter((n) => available.has(n));
  const bushes = SCATTER_BUSHES.filter((n) => available.has(n));
  const rand = rng(opts.seed);
  const out: ScatterPlacement[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const scale = new THREE.Vector3();

  for (let t = 0; t + 8 < triangles.length; t += 9) {
    a.set(triangles[t]!, triangles[t + 1]!, triangles[t + 2]!);
    b.set(triangles[t + 3]!, triangles[t + 4]!, triangles[t + 5]!);
    c.set(triangles[t + 6]!, triangles[t + 7]!, triangles[t + 8]!);
    n.subVectors(b, a).cross(p.subVectors(c, a));
    const area = n.length() / 2;
    if (area < 1e-6) continue;
    n.normalize();
    // Counter-clockwise triangles: faces turned downwards (undersides of hill blocks) get no decor.
    if (n.y < 0.02) continue;
    const slope = 1 - n.y;
    const upNormal = n;
    const altitude = (a.y + b.y + c.y) / 3;

    const sample = (density: number, names: readonly string[], minScale: number, maxScale: number, tilt = false) => {
      if (!names.length) return;
      const expected = area * density;
      let count = Math.floor(expected);
      if (rand() < expected - count) count++;
      for (let i = 0; i < count; i++) {
        let u = rand();
        let v = rand();
        if (u + v > 1) {
          u = 1 - u;
          v = 1 - v;
        }
        p.copy(a).addScaledVector(b.clone().sub(a), u).addScaledVector(c.clone().sub(a), v);
        q.setFromAxisAngle(up, rand() * Math.PI * 2);
        const s = minScale + rand() * (maxScale - minScale);
        if (tilt) {
          // Rocks lean into the slope and sink a little so they sit in the ground instead of balancing on it.
          const lean = new THREE.Quaternion().setFromUnitVectors(up, upNormal.clone().lerp(up, 0.4).normalize());
          q.premultiply(lean);
          p.addScaledVector(upNormal, -0.8 * s);
        }
        scale.set(s, s * (0.85 + rand() * 0.3), s);
        out.push({ name: names[Math.floor(rand() * names.length)]!, matrix: new THREE.Matrix4().compose(p.clone(), q.clone(), scale.clone()) });
      }
    };

    if (slope <= opts.bushMaxSlope && altitude <= opts.bushMaxAltitude) sample(opts.bushDensity, bushes, 0.8, 1.4);
    sample(slope > opts.steep ? opts.rockDensity * opts.steepRockBoost : opts.rockDensity, rocks, 0.8, 2.0, true);
  }

  if (out.length <= opts.maxInstances) return out;
  const keep = opts.maxInstances / out.length;
  return out.filter(() => rand() < keep);
}
