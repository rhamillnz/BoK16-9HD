/** Ground height lookup over world-space triangles in BaK coordinates (x, y horizontal; z up). */

export interface HeightField {
  /** Highest triangle surface under (x, y), or 0 when no triangle covers the point. */
  getHeight(x: number, y: number): number;
  readonly triangleCount: number;
}

/** Default grid cell edge, in BaK units (a tile is 64000 units wide). */
export const HEIGHT_CELL_SIZE = 1600;

/**
 * @param triangles flat array, 9 numbers per triangle: x0,y0,z0, x1,y1,z1, x2,y2,z2
 * @param cellSize uniform grid cell edge used to bucket triangles by their xy bounds
 */
export function buildHeightField(triangles: ArrayLike<number>, cellSize = HEIGHT_CELL_SIZE): HeightField {
  const count = Math.floor(triangles.length / 9);
  const cells = new Map<number, number[]>();
  const key = (cx: number, cy: number) => (cx & 0xffff) | ((cy & 0xffff) << 16);

  for (let t = 0; t < count; t++) {
    const o = t * 9;
    const xs = [triangles[o]!, triangles[o + 3]!, triangles[o + 6]!];
    const ys = [triangles[o + 1]!, triangles[o + 4]!, triangles[o + 7]!];
    const x0 = Math.floor(Math.min(...xs) / cellSize);
    const x1 = Math.floor(Math.max(...xs) / cellSize);
    const y0 = Math.floor(Math.min(...ys) / cellSize);
    const y1 = Math.floor(Math.max(...ys) / cellSize);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const k = key(cx, cy);
        const list = cells.get(k);
        if (list) list.push(t);
        else cells.set(k, [t]);
      }
    }
  }

  const heightAt = (t: number, px: number, py: number): number | undefined => {
    const o = t * 9;
    const ax = triangles[o]!, ay = triangles[o + 1]!, az = triangles[o + 2]!;
    const bx = triangles[o + 3]!, by = triangles[o + 4]!, bz = triangles[o + 5]!;
    const cx = triangles[o + 6]!, cy = triangles[o + 7]!, cz = triangles[o + 8]!;
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (det === 0) return undefined; // vertical or degenerate in plan view
    const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det;
    const l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det;
    const l3 = 1 - l1 - l2;
    const eps = -1e-9;
    if (l1 < eps || l2 < eps || l3 < eps) return undefined;
    return l1 * az + l2 * bz + l3 * cz;
  };

  return {
    triangleCount: count,
    getHeight(x, y) {
      const list = cells.get(key(Math.floor(x / cellSize), Math.floor(y / cellSize)));
      if (!list) return 0;
      let best: number | undefined;
      for (const t of list) {
        const h = heightAt(t, x, y);
        if (h !== undefined && (best === undefined || h > best)) best = h;
      }
      return best ?? 0;
    },
  };
}
