import { describe, expect, it } from 'vitest';
import type { Model, ModelTable } from '../formats/tbl';
import { overheadPolygons, overheadTiles } from './overheadMap';

const palette = new Uint8Array(256 * 4);
palette.set([10, 20, 30, 255], 5 * 4);

const square: Model = {
  name: 'm_rm1_ug', flags: 0, entityType: 0, terrainType: 0, scale: 0, radius: 0,
  vertices: [0, 0, 0, 100, 0, 0, 100, 100, 0, 0, 100, 0],
  faces: [{ material: 0, color: 5, indices: [0, 1, 2, 3] }],
} as unknown as Model;
const table = { models: [square] } as unknown as ModelTable;
const item = (x: number, y: number, zRot = 0, z = 0) => ({ type: 0, xRot: 0, yRot: 0, zRot, x, y, z });

describe('overheadPolygons', () => {
  it('is undefined above ground or without an overhead table', () => {
    expect(overheadPolygons({ zone: 1, items: [item(0, 0)], overheadTable: table, palette })).toBeUndefined();
    expect(overheadPolygons({ zone: 10, items: [item(0, 0)], overheadTable: undefined, palette })).toBeUndefined();
  });

  it('places and rotates flattened faces in world units with palette colour', () => {
    const polys = overheadPolygons({ zone: 10, items: [item(1000, 2000), item(0, 0, 16384)], overheadTable: table, palette })!;
    expect(polys).toHaveLength(2);
    expect(polys[0]!.fill).toBe('rgb(10,20,30)');
    const moved = polys.find((p) => p.points[0] === 1000)!;
    expect(moved.points.slice(0, 4)).toEqual([1000, 2000, 1100, 2000]);
    const turned = polys.find((p) => p.points[0] !== 1000)!;
    // A quarter turn maps (100, 0) to (0, 100).
    expect(turned.points[2]).toBeCloseTo(0);
    expect(turned.points[3]).toBeCloseTo(100);
  });

  it('draws higher items last and lists the tiles touched', () => {
    const polys = overheadPolygons({ zone: 11, items: [item(0, 0, 0, 500), item(0, 0, 0, 0)], overheadTable: table, palette })!;
    expect(polys.map((p) => p.z)).toEqual([0, 500]);
    expect(overheadTiles(polys, 64000)).toEqual([[0, 0]]);
  });
});
