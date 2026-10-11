import { valueNoise3, type DetailedHill } from './hillDetail';

/**
 * Many original hill pieces are open shells: some of their edges stop part-way up the slope, where
 * the original's fixed views never looked. Seen from the side, the gap shows the inside of the far
 * wall. `closeOpenSides` hangs a rock wall from every such edge straight down into the ground, so
 * each hill is closed and its open sides read as cliffs. The wall is split into rows and pushed out
 * by noise that depends only on position, so walls from neighbouring edges meet without cracks.
 */

export interface CliffOptions {
  /** How far below `groundY` the walls reach (render units), so their foot never shows a gap. */
  sink: number;
  /** Height of one row of the wall (render units). */
  rowHeight: number;
  /** Largest outward bulge of the wall face (render units). */
  roughness: number;
  /** Noise frequency (cycles per render unit). */
  frequency: number;
}

export const DEFAULT_CLIFFS: CliffOptions = { sink: 1, rowHeight: 1.5, roughness: 0.6, frequency: 0.35 };

const KEY_SCALE = 1e4;
const key = (x: number, y: number, z: number) =>
  `${Math.round(x * KEY_SCALE)},${Math.round(y * KEY_SCALE)},${Math.round(z * KEY_SCALE)}`;

interface OpenEdge {
  a: [number, number, number];
  b: [number, number, number];
  /** Output triangle the edge belongs to (for its colour). */
  triangle: number;
}

/** Edges used by only one triangle whose higher end is above `groundY + minHeight`. */
export function openEdges(hill: Pick<DetailedHill, 'positions'>, groundY: number, minHeight = 0.05): OpenEdge[] {
  const p = hill.positions;
  const count = new Map<string, { n: number; e: OpenEdge }>();
  for (let t = 0; t < p.length / 9; t++) {
    for (let k = 0; k < 3; k++) {
      const i = t * 9 + k * 3;
      const j = t * 9 + ((k + 1) % 3) * 3;
      const ka = key(p[i]!, p[i + 1]!, p[i + 2]!);
      const kb = key(p[j]!, p[j + 1]!, p[j + 2]!);
      if (ka === kb) continue;
      const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const seen = count.get(id);
      if (seen) seen.n++;
      else
        count.set(id, {
          n: 1,
          e: { a: [p[i]!, p[i + 1]!, p[i + 2]!], b: [p[j]!, p[j + 1]!, p[j + 2]!], triangle: t },
        });
    }
  }
  const out: OpenEdge[] = [];
  for (const { n, e } of count.values()) if (n === 1 && Math.max(e.a[1], e.b[1]) > groundY + minHeight) out.push(e);
  return out;
}

/** Returns the hill with a rock wall under every open edge; `groundY` is the hill's lowest point. */
export function closeOpenSides(hill: DetailedHill, groundY: number, o: CliffOptions = DEFAULT_CLIFFS): DetailedHill {
  const edges = openEdges(hill, groundY);
  if (!edges.length) return hill;
  const positions = hill.positions.slice();
  const normals = hill.normals.slice();
  const source = hill.source.slice();

  // The hill's centre, to turn each wall's normal outward.
  let cx = 0,
    cz = 0;
  const n = hill.positions.length / 3;
  for (let i = 0; i < hill.positions.length; i += 3) {
    cx += hill.positions[i]!;
    cz += hill.positions[i + 2]!;
  }
  cx /= n;
  cz /= n;
  const bottom = groundY - o.sink;

  for (const e of edges) {
    // Horizontal outward normal of this wall.
    let nx = e.b[2] - e.a[2];
    let nz = -(e.b[0] - e.a[0]);
    const len = Math.hypot(nx, nz);
    if (len < 1e-6) continue;
    nx /= len;
    nz /= len;
    const mx = (e.a[0] + e.b[0]) / 2 - cx;
    const mz = (e.a[2] + e.b[2]) / 2 - cz;
    if (nx * mx + nz * mz < 0) {
      nx = -nx;
      nz = -nz;
    }
    // The column of wall points under corner `c`: the corner itself, then fixed heights (multiples of
    // rowHeight above `bottom`) so the two walls that share a corner share its column exactly. Points
    // are pushed out by position-keyed noise that fades in below the top edge and out at the bottom,
    // away from the hill's centre (a direction both walls of a corner agree on).
    const column = (c: [number, number, number]): [number, number, number][] => {
      const out: [number, number, number][] = [c];
      const dl = Math.hypot(c[0] - cx, c[2] - cz) || 1;
      const dx = (c[0] - cx) / dl;
      const dz = (c[2] - cz) / dl;
      for (let k = Math.floor((c[1] - bottom) / o.rowHeight - 0.2); k >= 0; k--) {
        const y = bottom + k * o.rowHeight;
        const fade = Math.min(1, (c[1] - y) / o.rowHeight) * Math.min(1, (y - bottom) / o.rowHeight + 0.2);
        const bulge =
          (valueNoise3(c[0] * o.frequency, y * o.frequency, c[2] * o.frequency) - 0.5) * 2 * o.roughness * fade;
        out.push([c[0] + dx * bulge, y, c[2] + dz * bulge]);
      }
      return out;
    };
    const ca = column(e.a);
    const cb = column(e.b);
    // Stitch the two columns top to bottom, always advancing the side whose next point is higher.
    let i = 0,
      j = 0;
    const tri = (p: number[], q: number[], r: number[]) => {
      positions.push(...p, ...q, ...r);
      for (let k = 0; k < 3; k++) normals.push(nx, 0, nz);
      source.push(hill.source[e.triangle]!);
    };
    while (i < ca.length - 1 || j < cb.length - 1) {
      const nextA = i < ca.length - 1 ? ca[i + 1]![1] : -Infinity;
      const nextB = j < cb.length - 1 ? cb[j + 1]![1] : -Infinity;
      if (nextA >= nextB) {
        tri(ca[i]!, cb[j]!, ca[i + 1]!);
        i++;
      } else {
        tri(ca[i]!, cb[j]!, cb[j + 1]!);
        j++;
      }
    }
  }
  return { positions, normals, source };
}
