/**
 * Height of the top of a set of triangles (the remake's hill models) at a ground position. The height field only
 * knows the original terrain, so anything standing on a hill (the combat grid, its fighters, the combat camera)
 * asks this instead. Triangles are bucketed on a square grid over the ground plane; a query tests only the
 * triangles in its bucket.
 */
export class SurfaceIndex {
  private readonly buckets = new Map<number, number[]>();
  /** Flat x, y, z per corner, three corners per triangle (y up). */
  private readonly tri: Float32Array;

  constructor(
    triangles: Float32Array,
    private readonly cell = 4,
  ) {
    this.tri = triangles;
    for (let t = 0; t * 9 < triangles.length; t++) {
      const o = t * 9;
      const xs = [triangles[o]!, triangles[o + 3]!, triangles[o + 6]!];
      const zs = [triangles[o + 2]!, triangles[o + 5]!, triangles[o + 8]!];
      const x0 = Math.floor(Math.min(...xs) / cell);
      const x1 = Math.floor(Math.max(...xs) / cell);
      const z0 = Math.floor(Math.min(...zs) / cell);
      const z1 = Math.floor(Math.max(...zs) / cell);
      for (let bx = x0; bx <= x1; bx++)
        for (let bz = z0; bz <= z1; bz++) {
          const key = SurfaceIndex.key(bx, bz);
          let list = this.buckets.get(key);
          if (!list) this.buckets.set(key, (list = []));
          list.push(t);
        }
    }
  }

  private static key(bx: number, bz: number): number {
    return (bx + 32768) * 65536 + (bz + 32768);
  }

  get triangleCount(): number {
    return this.tri.length / 9;
  }

  /** Highest triangle over (x, z), or undefined where there is none. */
  heightAt(x: number, z: number): number | undefined {
    const list = this.buckets.get(SurfaceIndex.key(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    if (!list) return undefined;
    const p = this.tri;
    let best: number | undefined;
    for (const t of list) {
      const o = t * 9;
      const ax = p[o]!,
        ay = p[o + 1]!,
        az = p[o + 2]!;
      const bx = p[o + 3]!,
        by = p[o + 4]!,
        bz = p[o + 5]!;
      const cx = p[o + 6]!,
        cy = p[o + 7]!,
        cz = p[o + 8]!;
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-9) continue; // seen edge-on from above (a cliff wall)
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      const w = 1 - u - v;
      if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
      const y = u * ay + v * by + w * cy;
      if (best === undefined || y > best) best = y;
    }
    return best;
  }
}
