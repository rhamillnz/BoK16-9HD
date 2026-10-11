import * as THREE from 'three/webgpu';
import { hash2 } from './grassMath';

/** Boulders: crowd steep faces and sit at the foot of cliffs. */
export const SCATTER_ROCKS = ['scatter_rock1', 'scatter_rock2', 'scatter_rock3'] as const;
/** Cheap flat ground cover, placed in dense clumps on gentle ground. */
export const SCATTER_COVER = ['bush4', 'fern'] as const;
/** Real shrubs (1000+ triangles each), clumped but sparser. */
export const SCATTER_SHRUBS = ['bush1', 'bush2', 'bush3', 'bush5'] as const;
export const SCATTER_BUSHES = [...SCATTER_COVER, ...SCATTER_SHRUBS] as const;
/** Narrow conifers, scaled down and kept to big flat tops. */
export const SCATTER_PINES = ['tree4a', 'tree6a'] as const;
/** Loose stones and rubble that pile against the base of cliffs (with the boulders above). */
export const SCATTER_SCREE = [
  'scatter_stone1',
  'scatter_stone2',
  'scatter_stone3',
  'scatter_stone4',
  'rockpile',
] as const;
export const SCATTER_MODELS: readonly string[] = [
  ...SCATTER_ROCKS,
  ...SCATTER_BUSHES,
  ...SCATTER_PINES,
  ...SCATTER_SCREE,
];

export interface ScatterOptions {
  seed: number;
  /** Cover/shrub instances per square render unit inside a clump centre (tapering out to its rim). */
  coverDensity: number;
  shrubDensity: number;
  /** Chance that a clump cell holds a clump, its size (render units) and the density left between clumps. */
  clumpChance: number;
  clumpCell: number;
  clumpRadius: number;
  clumpFloor: number;
  /** Boulders per square render unit on ordinary ground; steep faces get `steepRockBoost` times more. */
  rockDensity: number;
  steep: number;
  steepRockBoost: number;
  /** Plants only where the face normal.y is at least this (ledges and tops) and no higher than `plantMaxAltitude`. */
  plantMinNormalY: number;
  plantMaxAltitude: number;
  /** Pines: flat tops (normal.y >= pineMinNormalY) at least `pineMinHeight` above their hill's foot, with at least
   * `pineMinArea` square units of flat ground in one cell, `pineDensity` per square unit, and a scale range. */
  pineMinNormalY: number;
  pineMinHeight: number;
  pineMinArea: number;
  pineDensity: number;
  pineScale: [number, number];
  /** Scree: faces with normal.y below `screeMaxNormalY` within `screeBand` above the hill's foot, `screeDensity` per
   * square unit of wall. */
  screeMaxNormalY: number;
  screeBand: number;
  screeDensity: number;
  /** Per-category caps (each thinned evenly beyond it), then a cap on the whole set. */
  maxCover: number;
  maxShrubs: number;
  maxPines: number;
  maxRocks: number;
  maxScree: number;
  maxInstances: number;
}

export const DEFAULT_SCATTER: Omit<ScatterOptions, 'seed'> = {
  coverDensity: 0.2,
  shrubDensity: 0.05,
  clumpChance: 0.55,
  clumpCell: 7,
  clumpRadius: 3.2,
  clumpFloor: 0.06,
  rockDensity: 0.012,
  steep: 0.3,
  steepRockBoost: 5,
  plantMinNormalY: 0.75,
  plantMaxAltitude: 40,
  pineMinNormalY: 0.93,
  pineMinHeight: 4,
  pineMinArea: 60,
  pineDensity: 0.01,
  pineScale: [0.5, 0.8],
  screeMaxNormalY: 0.5,
  screeBand: 2,
  screeDensity: 0.5,
  maxCover: 120000,
  maxShrubs: 24000,
  maxPines: 400,
  maxRocks: 6000,
  maxScree: 24000,
  maxInstances: 180000,
};

export interface ScatterPlacement {
  name: string;
  matrix: THREE.Matrix4;
}

/** One model's placements inside one ground cell, so the cell can be frustum- and distance-culled as a unit. */
export interface ScatterChunk {
  name: string;
  matrices: THREE.Matrix4[];
  /** Cell index on the ground plane. */
  cx: number;
  cz: number;
}

/** Group placements by model and ground cell (`cell` render units square). Output order is deterministic. */
export function chunkPlacements(placements: readonly ScatterPlacement[], cell: number): ScatterChunk[] {
  const chunks = new Map<string, ScatterChunk>();
  for (const p of placements) {
    const cx = Math.floor(p.matrix.elements[12]! / cell);
    const cz = Math.floor(p.matrix.elements[14]! / cell);
    const key = `${p.name}|${cx}|${cz}`;
    let chunk = chunks.get(key);
    if (!chunk) chunks.set(key, (chunk = { name: p.name, matrices: [], cx, cz }));
    chunk.matrices.push(p.matrix);
  }
  return [...chunks.values()];
}

/** Ground cell size for chunking, and how far (render units) each kind of decor stays visible. */
export const SCATTER_CHUNK_CELL = 360;
export function scatterCullDistance(name: string): number {
  if ((SCATTER_COVER as readonly string[]).includes(name)) return 230;
  if ((SCATTER_SCREE as readonly string[]).includes(name)) return 300;
  if ((SCATTER_SHRUBS as readonly string[]).includes(name)) return 380;
  return 800;
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
 * Clump field in [0, 1] at (x, z): 1 at the centre of a clump, 0 beyond its radius. One clump may sit (at a hashed
 * offset) in each `cell`-sized square; a point looks at its 3x3 neighbourhood. Depends on position only, so it is
 * stable whatever order the triangles come in.
 */
export function clumpField(
  x: number,
  z: number,
  seed: number,
  o: Pick<ScatterOptions, 'clumpChance' | 'clumpCell' | 'clumpRadius'>,
): number {
  const cx = Math.floor(x / o.clumpCell);
  const cz = Math.floor(z / o.clumpCell);
  let best = 0;
  for (let i = cx - 1; i <= cx + 1; i++) {
    for (let j = cz - 1; j <= cz + 1; j++) {
      if (hash2(i, j, seed * 7 + 1) > o.clumpChance) continue;
      const px = (i + hash2(i, j, seed * 7 + 2)) * o.clumpCell;
      const pz = (j + hash2(i, j, seed * 7 + 3)) * o.clumpCell;
      const r = o.clumpRadius * (0.6 + 0.8 * hash2(i, j, seed * 7 + 4));
      const d = Math.hypot(x - px, z - pz) / r;
      if (d < 1) best = Math.max(best, 1 - d * d);
    }
  }
  return best;
}

/** Evenly thin a list down to `cap` entries (keeps the original order). */
function thin<T>(items: T[], cap: number, rand: () => number): T[] {
  if (items.length <= cap) return items;
  const keep = cap / items.length;
  return items.filter(() => rand() < keep);
}

/**
 * Uniform random sample of at most `cap` of the placements offered (reservoir sampling), so a zone with a million
 * candidate spots never builds a million matrices.
 */
interface Reservoir {
  cap: number;
  seen: number;
  items: ScatterPlacement[];
}
const reservoir = (cap: number): Reservoir => ({ cap, seen: 0, items: [] });

/**
 * Scatter decor over counter-clockwise triangles (render space, 9 numbers each): clumped ground cover and shrubs on
 * gentle ground, small pines on big flat tops, boulders on steep ground and scree at the foot of cliffs. Placement
 * depends only on the triangles and the seed. `available` limits the result to models that actually loaded.
 */
export function scatterOnTriangles(
  triangles: ArrayLike<number>,
  available: ReadonlySet<string>,
  opts: ScatterOptions,
): ScatterPlacement[] {
  const pick = (names: readonly string[]) => names.filter((n) => available.has(n));
  const rocks = pick(SCATTER_ROCKS);
  const cover = pick(SCATTER_COVER);
  // Red berry bush (bush3) is loud: it appears at half the weight of the others.
  const shrubs = pick(SCATTER_SHRUBS).flatMap((n) => (n === 'bush3' ? [n] : [n, n]));
  const pines = pick(SCATTER_PINES);
  // Boulders dominate the scree (cheap), loose stones and rubble pile among them.
  const scree = [...rocks, ...rocks, ...rocks, ...pick(SCATTER_SCREE)];
  const rand = rng(opts.seed);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const e = new THREE.Vector3();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const scale = new THREE.Vector3();

  // Pass 1: each hill's foot (lowest vertex per ground cell, looked up over the cell and its 8 neighbours) and the
  // flat-top area per cell and height band. Scree wants the foot right under the wall (fine grid); a pine top may
  // be a few tens of units from its hill's lowest vertex (coarse grid).
  const triangleCount = Math.floor(triangles.length / 9);
  const footGrid = (cell: number) => {
    const low = new Map<string, number>();
    for (let t = 0; t < triangleCount; t++) {
      for (let k = 0; k < 3; k++) {
        const i = t * 9 + k * 3;
        const key = `${Math.floor(triangles[i]! / cell)},${Math.floor(triangles[i + 2]! / cell)}`;
        const v = low.get(key);
        if (v === undefined || triangles[i + 1]! < v) low.set(key, triangles[i + 1]!);
      }
    }
    return (x: number, z: number, y: number): number => {
      let m = y;
      const cx = Math.floor(x / cell);
      const cz = Math.floor(z / cell);
      for (let i = cx - 1; i <= cx + 1; i++) {
        for (let j = cz - 1; j <= cz + 1; j++) {
          const f = low.get(`${i},${j}`);
          if (f !== undefined && f < m) m = f;
        }
      }
      return m;
    };
  };
  const CELL = 32;
  const cellKey = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  const flatArea = new Map<string, number>();
  const nearFoot = footGrid(8);
  const cellFoot = footGrid(CELL);
  const triangleAt = (t: number) => {
    const i = t * 9;
    a.set(triangles[i]!, triangles[i + 1]!, triangles[i + 2]!);
    b.set(triangles[i + 3]!, triangles[i + 4]!, triangles[i + 5]!);
    c.set(triangles[i + 6]!, triangles[i + 7]!, triangles[i + 8]!);
    n.subVectors(b, a).cross(e.subVectors(c, a));
    const len = n.length();
    n.divideScalar(len || 1);
    return len / 2;
  };
  const bandOf = (y: number) => Math.round(y / 1.5);
  if (pines.length) {
    for (let t = 0; t < triangleCount; t++) {
      const area = triangleAt(t);
      if (area < 1e-6 || n.y < opts.pineMinNormalY) continue;
      const cx = (a.x + b.x + c.x) / 3;
      const cz = (a.z + b.z + c.z) / 3;
      const cy = (a.y + b.y + c.y) / 3;
      if (cy - cellFoot(cx, cz, cy) < opts.pineMinHeight) continue;
      const key = `${cellKey(cx, cz)},${bandOf(cy)}`;
      flatArea.set(key, (flatArea.get(key) ?? 0) + area);
    }
  }

  const out = {
    cover: reservoir(opts.maxCover),
    shrubs: reservoir(opts.maxShrubs),
    pines: reservoir(opts.maxPines),
    rocks: reservoir(opts.maxRocks),
    scree: reservoir(opts.maxScree),
  };

  const randomPoint = (): void => {
    let u = rand();
    let v = rand();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    p.copy(a).addScaledVector(e.subVectors(b, a), u).addScaledVector(e.subVectors(c, a), v);
  };
  const place = (res: Reservoir, name: string, s: number, squash: number): void => {
    res.seen++;
    const slot = res.seen <= res.cap ? res.seen - 1 : Math.floor(rand() * res.seen);
    if (slot >= res.cap) return;
    scale.set(s, s * squash, s);
    res.items[slot] = { name, matrix: new THREE.Matrix4().compose(p.clone(), q, scale) };
  };
  const count = (expected: number): number => {
    const whole = Math.floor(expected);
    return whole + (rand() < expected - whole ? 1 : 0);
  };

  // Pass 2: decor.
  for (let t = 0; t < triangleCount; t++) {
    const area = triangleAt(t);
    if (area < 1e-6) continue;
    const ny = n.y;
    const cy = (a.y + b.y + c.y) / 3;
    const cx = (a.x + b.x + c.x) / 3;
    const cz = (a.z + b.z + c.z) / 3;

    // Vertical cliff walls (a hair past 90 degrees) get scree at their foot; undersides get nothing.
    if (ny < opts.screeMaxNormalY && ny > -0.1 && scree.length) {
      const base = nearFoot(cx, cz, Math.min(a.y, b.y, c.y));
      // Quick reject: the wall must reach into the band above the foot.
      if (Math.min(a.y, b.y, c.y) - base <= opts.screeBand) {
        const horizontal = Math.hypot(n.x, n.z) || 1;
        const hx = n.x / horizontal;
        const hz = n.z / horizontal;
        const k = count(area * opts.screeDensity);
        for (let i = 0; i < k; i++) {
          randomPoint();
          const above = p.y - base;
          if (above > opts.screeBand || above < -0.5) continue;
          const s = 0.35 + rand() * 0.8;
          // Pushed out from the wall into a heap, resting on the ground at the foot.
          const out2 = 0.3 + rand() * 1.4;
          p.x += hx * out2;
          p.z += hz * out2;
          p.y = base - 0.15 * s + rand() * 0.2;
          q.setFromAxisAngle(up, rand() * Math.PI * 2);
          place(out.scree, scree[Math.floor(rand() * scree.length)]!, s, 0.85 + rand() * 0.3);
        }
      }
    }
    if (ny < 0.02) continue;
    const slope = 1 - ny;

    // Ground cover and shrubs on ledges and tops, in clumps.
    if (ny >= opts.plantMinNormalY && cy - cellFoot(cx, cz, cy) <= opts.plantMaxAltitude) {
      const sample = (names: readonly string[], density: number, list: Reservoir, min: number, max: number) => {
        if (!names.length) return;
        // Candidates at the clump-centre density; the clump field thins them between clumps.
        const k = count(area * density);
        for (let i = 0; i < k; i++) {
          randomPoint();
          const f = clumpField(p.x, p.z, opts.seed, opts);
          if (rand() > opts.clumpFloor + (1 - opts.clumpFloor) * f) continue;
          q.setFromAxisAngle(up, rand() * Math.PI * 2);
          // Bigger in the middle of a clump, smaller at the rim.
          const s = (min + rand() * (max - min)) * (0.75 + 0.35 * f);
          place(list, names[Math.floor(rand() * names.length)]!, s, 0.85 + rand() * 0.3);
        }
      };
      sample(cover, opts.coverDensity, out.cover, 0.5, 1.0);
      sample(shrubs, opts.shrubDensity, out.shrubs, 0.6, 1.2);
    }

    // Small pines on big flat tops well above the foot.
    if (pines.length && ny >= opts.pineMinNormalY && cy - cellFoot(cx, cz, cy) >= opts.pineMinHeight) {
      if ((flatArea.get(`${cellKey(cx, cz)},${bandOf(cy)}`) ?? 0) >= opts.pineMinArea) {
        const k = count(area * opts.pineDensity);
        for (let i = 0; i < k; i++) {
          randomPoint();
          q.setFromAxisAngle(up, rand() * Math.PI * 2);
          const [lo, hi] = opts.pineScale;
          const s = lo + rand() * (hi - lo);
          p.y -= 0.1;
          place(out.pines, pines[Math.floor(rand() * pines.length)]!, s, 0.9 + rand() * 0.25);
        }
      }
    }

    // Boulders: sparse on the flat, crowding the steep slopes (they lean in and sink a little).
    if (rocks.length) {
      const k = count(area * (slope > opts.steep ? opts.rockDensity * opts.steepRockBoost : opts.rockDensity));
      for (let i = 0; i < k; i++) {
        randomPoint();
        q.setFromAxisAngle(up, rand() * Math.PI * 2);
        const s = 0.8 + rand() * 1.2;
        const lean = new THREE.Quaternion().setFromUnitVectors(up, n.clone().lerp(up, 0.4).normalize());
        q.premultiply(lean);
        p.addScaledVector(n, -0.8 * s);
        place(out.rocks, rocks[Math.floor(rand() * rocks.length)]!, s, 0.85 + rand() * 0.3);
      }
    }
  }

  const result = [...out.cover.items, ...out.shrubs.items, ...out.pines.items, ...out.rocks.items, ...out.scree.items];
  return thin(result, opts.maxInstances, rand);
}
