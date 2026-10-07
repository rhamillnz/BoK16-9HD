import { describe, expect, it } from 'vitest';
import { DEFAULT_HILL_DETAIL, detailHill, type HillCorner } from './hillDetail';

const up: [number, number, number] = [0, 1, 0];
const c = (id: number, x: number, y: number, z: number, n = up): HillCorner => ({ id, p: [x, y, z], n });

// A square pyramid: apex 5 up, base corners on the ground. Counter-clockwise from outside.
const apex = c(0, 0, 8, 0, [0, 1, 0]);
const base = [c(1, -10, 0, -10, [-0.6, 0.5, -0.6]), c(2, 10, 0, -10, [0.6, 0.5, -0.6]), c(3, 10, 0, 10, [0.6, 0.5, 0.6]), c(4, -10, 0, 10, [-0.6, 0.5, 0.6])];
const pyramid: HillCorner[][] = [0, 1, 2, 3].map((i) => [apex, base[(i + 1) % 4]!, base[i]!]);

const key = (x: number, y: number, z: number) => `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;

describe('detailHill', () => {
  const d = detailHill(pyramid, { ...DEFAULT_HILL_DETAIL, targetEdge: 2, targetFraction: 0 });

  it('subdivides long edges', () => {
    expect(d.source.length).toBeGreaterThan(pyramid.length * 16);
    expect(d.positions.length).toBe(d.source.length * 9);
    expect(d.normals.length).toBe(d.positions.length);
  });

  it('leaves no cracks: every edge is shared by exactly two triangles (closed surface apart from the base)', () => {
    const edges = new Map<string, number>();
    for (let t = 0; t < d.positions.length; t += 9) {
      const v = [0, 1, 2].map((k) => key(d.positions[t + k * 3]!, d.positions[t + k * 3 + 1]!, d.positions[t + k * 3 + 2]!));
      for (let k = 0; k < 3; k++) {
        const e = [v[k]!, v[(k + 1) % 3]!].sort().join('|');
        edges.set(e, (edges.get(e) ?? 0) + 1);
      }
    }
    // Edges seen once are the open base of the pyramid: all of them must lie on the ground.
    for (const [e, n] of edges) {
      expect(n).toBeLessThanOrEqual(2);
      if (n === 1) for (const p of e.split('|')) expect(Math.abs(Number(p.split(',')[1]))).toBeLessThan(1e-6);
    }
  });

  it('keeps the foot of the hill on the ground', () => {
    for (let i = 1; i < d.positions.length; i += 3) expect(d.positions[i]!).toBeGreaterThan(-1e-6);
  });

  it('keeps faces pointing outwards', () => {
    let outward = 0;
    for (let i = 0; i < d.normals.length; i += 3) {
      const px = d.positions[i]!, pz = d.positions[i + 2]!;
      if (d.normals[i]! * px + d.normals[i + 2]! * pz + d.normals[i + 1]! > 0) outward++;
    }
    expect(outward / (d.normals.length / 3)).toBeGreaterThan(0.95);
  });

  it('is deterministic', () => {
    expect(detailHill(pyramid).positions).toEqual(detailHill(pyramid).positions);
  });
});
