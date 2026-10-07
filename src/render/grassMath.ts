/** Pure placement logic for the stylised grass: terrain mask, per-cell clump scatter, LOD and culling helpers. */

/** Deterministic hash of an integer lattice point to [0, 1). */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export type GrassQuality = 'low' | 'medium' | 'high';

export interface GrassSettings {
  /** Clumps per square world unit (1 unit = 100 BaK units) at full density. */
  density: number;
  /** Cell edge in world units. */
  cellSize: number;
  /** Cells kept around the centre cell (the ring radius). */
  radius: number;
  /** Fraction of clumps kept at the outer edge of the ring (linear falloff from 1 at the centre). */
  farKeep: number;
  /** Hard cap on instances in the buffer. */
  maxInstances: number;
}

export const GRASS_PRESETS: Record<GrassQuality, GrassSettings> = {
  low: { density: 1.2, cellSize: 8, radius: 4, farKeep: 0.25, maxInstances: 12_000 },
  medium: { density: 2.5, cellSize: 8, radius: 6, farKeep: 0.2, maxInstances: 40_000 },
  high: { density: 4, cellSize: 8, radius: 8, farKeep: 0.15, maxInstances: 100_000 },
};

/** Floats per clump: x, y, z, yaw, scale, phase, tint. */
export const CLUMP_STRIDE = 7;

/** Height above the sampled ground (world units) for a clump at full scale. */
export const CLUMP_HEIGHT = 0.3;

/** Returns the ground height (world units) at (x, z), or null where grass must not grow. */
export type GroundSampler = ((x: number, z: number) => number | null) & {
  /** Average ground colour (linear-ish 0..1 rgb) so the grass can match the terrain palette. */
  color?: [number, number, number];
  /** True on grass next to a road or path: gets extra, taller clumps so the edge blends into the verge. */
  verge?: (x: number, z: number) => boolean;
};

/** Extra verge clumps as a multiple of the normal density, and how much bigger they grow. */
export const VERGE_EXTRA_DENSITY = 1.6;
export const VERGE_SCALE_BOOST = 1.35;

/**
 * Scatters the clumps of one cell: stable for a given (cx, cz, settings.density), independent of
 * who asks. Each clump gets a `lodKey` in [0, 1) so callers can thin the cell by distance.
 * Output is CLUMP_STRIDE floats per clump followed by the key, i.e. CLUMP_STRIDE + 1 per entry.
 */
export function scatterCell(cx: number, cz: number, cellSize: number, density: number, sample: GroundSampler): Float32Array {
  const count = Math.max(0, Math.round(cellSize * cellSize * density));
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const x = (cx + hash2(cx * 131 + i, cz, 1)) * cellSize;
    const z = (cz + hash2(cx, cz * 137 + i, 2)) * cellSize;
    const y = sample(x, z);
    if (y === null) continue;
    out.push(
      x,
      y,
      z,
      hash2(i, cx + cz * 7, 3) * Math.PI * 2,
      0.7 + hash2(i, cz, 4) * 0.7,
      hash2(cx, i + cz * 5, 5) * Math.PI * 2,
      hash2(i + cx * 3, cz, 6),
      // Spatially random but index-independent so thinning keeps an even spread.
      hash2(i, cx * 17 + cz * 31, 7),
    );
  }
  const verge = sample.verge;
  if (verge) {
    const extra = Math.round(cellSize * cellSize * density * VERGE_EXTRA_DENSITY);
    for (let j = 0; j < extra; j++) {
      const i = count + j;
      const x = (cx + hash2(cx * 131 + i, cz, 1)) * cellSize;
      const z = (cz + hash2(cx, cz * 137 + i, 2)) * cellSize;
      if (!verge(x, z)) continue;
      const y = sample(x, z);
      if (y === null) continue;
      out.push(
        x,
        y,
        z,
        hash2(i, cx + cz * 7, 3) * Math.PI * 2,
        (0.7 + hash2(i, cz, 4) * 0.7) * VERGE_SCALE_BOOST,
        hash2(cx, i + cz * 5, 5) * Math.PI * 2,
        hash2(i + cx * 3, cz, 6),
        hash2(i, cx * 17 + cz * 31, 7),
      );
    }
  }
  return Float32Array.from(out);
}

/** Probability that a clump at `distCells` (cell units from the centre) survives LOD thinning. */
export function lodKeep(distCells: number, radius: number, farKeep: number): number {
  const t = Math.min(1, Math.max(0, distCells / Math.max(1, radius)));
  return 1 + (farKeep - 1) * t;
}

/** Cells within the ring radius, nearest first, as [cx, cz, distance in cells]. */
export function cellsAround(centreX: number, centreZ: number, cellSize: number, radius: number): [number, number, number][] {
  const ccx = Math.floor(centreX / cellSize);
  const ccz = Math.floor(centreZ / cellSize);
  const out: [number, number, number][] = [];
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const d = Math.hypot(dx, dz);
      if (d <= radius + 0.5) out.push([ccx + dx, ccz + dz, d]);
    }
  }
  return out.sort((a, b) => a[2] - b[2]);
}

/** A cell is culled when it lies entirely outside the view cone (centre-based, with a margin of one cell). */
export function cellInView(
  cellCx: number,
  cellCz: number,
  cellSize: number,
  camX: number,
  camZ: number,
  forwardX: number,
  forwardZ: number,
  halfFov: number,
): boolean {
  const dx = (cellCx + 0.5) * cellSize - camX;
  const dz = (cellCz + 0.5) * cellSize - camZ;
  const dist = Math.hypot(dx, dz);
  // Always keep cells touching the camera: their blades surround it.
  if (dist <= cellSize * 1.5) return true;
  const fl = Math.hypot(forwardX, forwardZ) || 1;
  const cos = (dx * forwardX + dz * forwardZ) / (dist * fl);
  // Widen by the angle a cell's half-diagonal subtends.
  const margin = Math.asin(Math.min(1, (cellSize * 0.75) / dist));
  return Math.acos(Math.min(1, Math.max(-1, cos))) <= halfFov + margin;
}

/** Coarse 2D occupancy grid in BaK units: 1 = ground-terrain grass area, 0 = anything else. */
export interface GroundMask {
  get(x: number, y: number): boolean;
  /** Visits the centre (BaK units) of every set cell. */
  forEachSet(visit: (x: number, y: number) => void): void;
}

/**
 * Rasterises triangles (flat x,y,z * 3 arrays in BaK units, only xy used) at cell centres.
 * `ground` triangles switch cells on, `cover` triangles (roads, rivers, fields...) switch them off again.
 */
export function buildGroundMask(ground: ArrayLike<number>, cover: ArrayLike<number>, cell = 100): GroundMask {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < ground.length; i += 3) {
    minX = Math.min(minX, ground[i]!);
    maxX = Math.max(maxX, ground[i]!);
    minY = Math.min(minY, ground[i + 1]!);
    maxY = Math.max(maxY, ground[i + 1]!);
  }
  if (!isFinite(minX)) return { get: () => false, forEachSet: () => {} };
  const w = Math.ceil((maxX - minX) / cell) + 1;
  const h = Math.ceil((maxY - minY) / cell) + 1;
  const grid = new Uint8Array(w * h);
  const fill = (tris: ArrayLike<number>, value: number) => {
    for (let o = 0; o + 8 < tris.length; o += 9) {
      const ax = tris[o]!, ay = tris[o + 1]!, bx = tris[o + 3]!, by = tris[o + 4]!, cx = tris[o + 6]!, cy = tris[o + 7]!;
      const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (det === 0) continue;
      const gx0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - minX) / cell));
      const gx1 = Math.min(w - 1, Math.floor((Math.max(ax, bx, cx) - minX) / cell));
      const gy0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - minY) / cell));
      const gy1 = Math.min(h - 1, Math.floor((Math.max(ay, by, cy) - minY) / cell));
      for (let gy = gy0; gy <= gy1; gy++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const px = minX + (gx + 0.5) * cell;
          const py = minY + (gy + 0.5) * cell;
          const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det;
          const l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det;
          if (l1 >= 0 && l2 >= 0 && l1 + l2 <= 1) grid[gy * w + gx] = value;
        }
      }
    }
  };
  fill(ground, 1);
  fill(cover, 0);
  return {
    get(x, y) {
      const gx = Math.floor((x - minX) / cell);
      const gy = Math.floor((y - minY) / cell);
      return gx >= 0 && gy >= 0 && gx < w && gy < h && grid[gy * w + gx] === 1;
    },
    forEachSet(visit) {
      for (let gy = 0; gy < h; gy++) for (let gx = 0; gx < w; gx++) if (grid[gy * w + gx] === 1) visit(minX + (gx + 0.5) * cell, minY + (gy + 0.5) * cell);
    },
  };
}
