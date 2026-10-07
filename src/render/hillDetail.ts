/**
 * Detail for the original low-poly hills and mountains: every triangle is subdivided, bent into a
 * curved surface (Phong tessellation from the smooth vertex normals) and then sculpted with
 * fractal noise and ridges along the normal. The base of each hill stays put so it still meets
 * the ground.
 *
 * Works in render space (y up). Crack-free: points are shared by key between triangles, and
 * everything on an edge depends only on that edge's two corners, so neighbours agree exactly.
 */

export interface HillDetailOptions {
  /** Longest sub-triangle edge to aim for (render units), at least... */
  targetEdge: number;
  /** ...and at least this fraction of the hill's size, so big distant mountains are not over-split. */
  targetFraction: number;
  /** Most halvings of an original edge. */
  maxLevel: number;
  /** 0 keeps the flat facets, 1 is full Phong tessellation. */
  curvature: number;
  /** Largest displacement (render units); smaller hills get proportionally less. */
  maxAmplitude: number;
  /** Displacement as a fraction of the hill's height. */
  amplitudeRatio: number;
  /** Noise frequency (cycles per render unit) of the broadest octave. */
  frequency: number;
  /** Height above the hill's lowest point (render units) over which displacement fades in. */
  baseFade: number;
}

export const DEFAULT_HILL_DETAIL: HillDetailOptions = {
  targetEdge: 2,
  targetFraction: 1 / 10,
  maxLevel: 6,
  curvature: 0.65,
  maxAmplitude: 1.6,
  amplitudeRatio: 0.07,
  frequency: 0.05,
  baseFade: 3,
};

export type Vec3 = [number, number, number];

/** One original face corner: its (welded) vertex id, position and smooth normal. */
export interface HillCorner {
  id: number;
  p: Vec3;
  n: Vec3;
}

export interface DetailedHill {
  /** Triangles, 9 numbers each, counter-clockwise from outside. */
  positions: number[];
  /** Smooth normals of the detailed surface, per triangle corner. */
  normals: number[];
  /** Index of the source triangle (in the input list) for each output triangle. */
  source: number[];
}

// ---- Noise -------------------------------------------------------------------------------

function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Smooth value noise in [-1, 1]. */
export function valueNoise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = fade(xf), v = fade(yf), w = fade(zf);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), u), x10 = lerp(c(0, 1, 0), c(1, 1, 0), u);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), u), x11 = lerp(c(0, 1, 1), c(1, 1, 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w) * 2 - 1;
}

/** Hill relief in about [-1, 1]: rolling fractal noise plus sharper ridges. */
export function hillRelief(x: number, y: number, z: number, freq: number): number {
  let sum = 0, amp = 0.5, f = freq, norm = 0;
  for (let o = 0; o < 4; o++) {
    sum += valueNoise3(x * f + o * 17.3, y * f, z * f - o * 9.1) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.07;
  }
  const rolling = sum / norm;
  const ridge = 1 - Math.abs(valueNoise3(x * freq * 1.6 + 31.7, y * freq * 1.6, z * freq * 1.6 + 5.2));
  return rolling * 0.65 + (ridge * ridge - 0.45) * 0.7;
}

// ---- Tessellation ------------------------------------------------------------------------

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Detail one hill: `triangles` are its faces as counter-clockwise (from outside) corner triples
 * with shared, welded ids and smooth normals. Edges longer than `targetEdge` are halved
 * (recursively); the decision depends only on the edge, so neighbouring triangles agree.
 */
export function detailHill(triangles: readonly HillCorner[][], options: HillDetailOptions = DEFAULT_HILL_DETAIL): DetailedHill {
  const o = options;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const t of triangles) for (const c of t) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i]!, c.p[i]!); hi[i] = Math.max(hi[i]!, c.p[i]!); }
  const minY = lo[1]!;
  const size = Math.max(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!);
  const amplitude = Math.min(o.maxAmplitude, (hi[1]! - minY) * o.amplitudeRatio);
  const target = Math.max(o.targetEdge, size * o.targetFraction);
  const minEdge = target / 2 ** o.maxLevel;

  // Points by key: the corners with non-zero barycentric weight, sorted by id. Weights are
  // dyadic fractions (exact in floating point), so the same point always gets the same key.
  const points = new Map<string, number>();
  const flat: number[] = [];
  const pos: number[] = [];
  const acc: number[] = [];
  const pointFor = (corners: readonly HillCorner[], weights: readonly number[]): number => {
    const parts: [HillCorner, number][] = [];
    for (let i = 0; i < 3; i++) if (weights[i]! > 0) parts.push([corners[i]!, weights[i]!]);
    parts.sort((a, b) => a[0].id - b[0].id);
    const key = parts.map(([c, w]) => `${c.id}:${w}`).join('|');
    const found = points.get(key);
    if (found !== undefined) return found;

    // Flat position and interpolated normal, in canonical (sorted) order so every triangle agrees.
    let px = 0, py = 0, pz = 0, nx = 0, ny = 0, nz = 0;
    for (const [c, b] of parts) {
      px += c.p[0] * b; py += c.p[1] * b; pz += c.p[2] * b;
      nx += c.n[0] * b; ny += c.n[1] * b; nz += c.n[2] * b;
    }
    // Phong tessellation: average of the point projected onto each corner's tangent plane.
    let qx = 0, qy = 0, qz = 0;
    for (const [c, b] of parts) {
      const d = (px - c.p[0]) * c.n[0] + (py - c.p[1]) * c.n[1] + (pz - c.p[2]) * c.n[2];
      qx += (px - d * c.n[0]) * b; qy += (py - d * c.n[1]) * b; qz += (pz - d * c.n[2]) * b;
    }
    // Rounding and sculpting both fade out at the foot of the hill, so it still sits on the ground.
    const fadeIn = smoothstep(0, o.baseFade, py - minY);
    const k = o.curvature * fadeIn;
    let x = px + (qx - px) * k, y = py + (qy - py) * k, z = pz + (qz - pz) * k;
    const len = Math.hypot(nx, ny, nz) || 1;
    const d = hillRelief(x, y, z, o.frequency) * amplitude * fadeIn;
    x += (nx / len) * d; y += (ny / len) * d; z += (nz / len) * d;

    const index = pos.length / 3;
    flat.push(px, py, pz);
    pos.push(x, y, z);
    acc.push(0, 0, 0);
    points.set(key, index);
    return index;
  };
  const flatLength = (a: number, b: number) => Math.hypot(flat[a * 3]! - flat[b * 3]!, flat[a * 3 + 1]! - flat[b * 3 + 1]!, flat[a * 3 + 2]! - flat[b * 3 + 2]!);

  const tris: number[] = [];
  const source: number[] = [];
  type Bary = readonly [number, number, number];
  const mid = (a: Bary, b: Bary): Bary => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const split = (t: readonly HillCorner[], ti: number, a: Bary, b: Bary, c: Bary): void => {
    const ia = pointFor(t, a), ib = pointFor(t, b), ic = pointFor(t, c);
    const long = (p: number, q: number) => { const l = flatLength(p, q); return l > target && l > minEdge * 2; };
    const sAB = long(ia, ib), sBC = long(ib, ic), sCA = long(ic, ia);
    const count = +sAB + +sBC + +sCA;
    if (count === 0) {
      tris.push(ia, ib, ic);
      source.push(ti);
      return;
    }
    if (count === 3) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      split(t, ti, a, ab, ca); split(t, ti, ab, b, bc); split(t, ti, ca, bc, c); split(t, ti, ab, bc, ca);
      return;
    }
    // Rotate so the split edges come first: one split is AB; two splits are AB and BC.
    if (count === 1) {
      if (sBC) return split(t, ti, b, c, a);
      if (sCA) return split(t, ti, c, a, b);
      const ab = mid(a, b);
      split(t, ti, a, ab, c); split(t, ti, ab, b, c);
      return;
    }
    if (!sAB) return split(t, ti, b, c, a); // BC and CA split
    if (!sBC) return split(t, ti, c, a, b); // CA and AB split
    const ab = mid(a, b), bc = mid(b, c);
    split(t, ti, a, ab, bc); split(t, ti, ab, b, bc); split(t, ti, a, bc, c);
  };
  triangles.forEach((t, ti) => split(t, ti, [1, 0, 0], [0, 1, 0], [0, 0, 1]));

  // Smooth normals of the sculpted surface: area-weighted face normals summed per shared point.
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i]! * 3, b = tris[i + 1]! * 3, c = tris[i + 2]! * 3;
    const ux = pos[b]! - pos[a]!, uy = pos[b + 1]! - pos[a + 1]!, uz = pos[b + 2]! - pos[a + 2]!;
    const vx = pos[c]! - pos[a]!, vy = pos[c + 1]! - pos[a + 1]!, vz = pos[c + 2]! - pos[a + 2]!;
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { acc[v] = acc[v]! + fx; acc[v + 1] = acc[v + 1]! + fy; acc[v + 2] = acc[v + 2]! + fz; }
  }

  const positions: number[] = [];
  const normals: number[] = [];
  for (const v of tris) {
    const i = v * 3;
    positions.push(pos[i]!, pos[i + 1]!, pos[i + 2]!);
    const l = Math.hypot(acc[i]!, acc[i + 1]!, acc[i + 2]!) || 1;
    normals.push(acc[i]! / l, acc[i + 1]! / l, acc[i + 2]! / l);
  }
  return { positions, normals, source };
}
