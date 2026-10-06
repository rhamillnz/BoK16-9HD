import { describe, expect, it } from 'vitest';
import { parseClips, parseTBL, type ModelClip } from '../src/formats/tbl';
import { buildCollisionPolygons, placeClip, pointInPolygon, slideMove } from '../src/world/collision';

// Hand-built fixtures only: no original game data.

class Bytes {
  private readonly b: number[] = [];
  get length(): number {
    return this.b.length;
  }
  u8(...vs: number[]): this {
    for (const v of vs) this.b.push(v & 0xff);
    return this;
  }
  u16(...vs: number[]): this {
    for (const v of vs) this.u8(v, v >> 8);
    return this;
  }
  pad(n: number, fill = 0): this {
    for (let i = 0; i < n; i++) this.b.push(fill);
    return this;
  }
  ascii(s: string): this {
    for (const c of s) this.b.push(c.charCodeAt(0));
    return this;
  }
  raw(bytes: ArrayLike<number>): this {
    for (let i = 0; i < bytes.length; i++) this.b.push(bytes[i]!);
    return this;
  }
  done(): Uint8Array {
    return Uint8Array.from(this.b);
  }
}

interface ClipSpec {
  radiusX: number;
  radiusY: number;
  flags: number;
  /** Bytes between the record start and its point data, minus the 8 the parser subtracts. */
  adjust: number;
  elements: { scale: number; baseHeight: number; points: [number, number, number, number][]; height?: [number, number] }[];
}

/**
 * GID: payload. Each clip record = header(8) + element headers + point data. Stored offsets
 * are (position relative to record start) + (adjust - 8), so the parser must subtract it again.
 */
function buildGid(clips: (ClipSpec | undefined)[]): Uint8Array {
  const table = new Bytes();
  const body = new Bytes();
  const tableSize = clips.length * 4;
  for (const c of clips) {
    body.pad(3, 0xdd); // misalign so offsets are not 16-aligned
    const start = tableSize + body.length;
    table.u16(0xab00 | (start & 0x0f), start >> 4);
    if (!c) {
      body.u16(0, 0).u8(0, 0).u16(8);
      continue;
    }
    const vertical = (c.flags & 2) !== 0;
    const hdrSize = c.elements.length * (vertical ? 10 : 6);
    const stored = (pos: number) => pos + (c.adjust - 8);
    let p = 8 + hdrSize;
    const placed = c.elements.map((e) => {
      const edgePos = p;
      p += e.points.length * 6;
      const heightPos = e.height ? p : undefined;
      if (e.height) p += 6;
      return { edgePos, heightPos };
    });
    body.u16(c.radiusX, c.radiusY).u8(c.flags, c.elements.length).u16(c.adjust);
    c.elements.forEach((e, i) => {
      body.u16(stored(placed[i]!.edgePos)).u8(e.points.length, e.scale).u16(e.baseHeight);
      if (vertical) body.u16(stored(placed[i]!.heightPos ?? 0)).pad(2, 0xee);
    });
    c.elements.forEach((e) => {
      for (const [u, v, x, y] of e.points) body.u8(u, v).u16(x, y);
      if (e.height) body.u8(1, 2).u16(e.height[0], e.height[1]);
    });
  }
  return new Bytes().raw(table.done()).raw(body.done()).done();
}

const SQUARE: [number, number, number, number][] = [
  [0, -1, -100, -100],
  [1, 0, 100, -100],
  [0, 1, 100, 100],
  [-1, 0, -100, 100],
];

describe('GID: parser', () => {
  it('parses radii, flags, elements, normals and points', () => {
    const gid = buildGid([
      { radiusX: 150, radiusY: 160, flags: 0, adjust: 0x30, elements: [{ scale: 3, baseHeight: 7, points: SQUARE }] },
    ]);
    const [clip] = parseClips(gid, 1);
    expect(clip).toEqual({
      radiusX: 150,
      radiusY: 160,
      walkable: false,
      hasVertical: false,
      elements: [
        {
          scale: 3,
          baseHeight: 7,
          points: [-100, -100, 100, -100, 100, 100, -100, 100],
          normals: [0, -1, 1, 0, 0, 1, -1, 0],
          heightPoint: undefined,
        },
      ],
    });
  });

  it('reads the walkable flag and negative values', () => {
    const gid = buildGid([
      { radiusX: 1, radiusY: 1, flags: 1, adjust: 8, elements: [{ scale: 0, baseHeight: 0, points: [[-5, -6, -7, -8], [0, 0, 1, 1], [0, 0, 2, 0]] }] },
    ]);
    const clip = parseClips(gid, 1)[0]!;
    expect(clip.walkable).toBe(true);
    expect(clip.elements[0]!.normals.slice(0, 2)).toEqual([-5, -6]);
    expect(clip.elements[0]!.points.slice(0, 2)).toEqual([-7, -8]);
  });

  it('reads height points and the extra element header fields when hasVertical is set', () => {
    const gid = buildGid([
      {
        radiusX: 10,
        radiusY: 10,
        flags: 3,
        adjust: 0x20,
        elements: [
          { scale: 1, baseHeight: 2, points: SQUARE, height: [-300, 400] },
          { scale: 2, baseHeight: 3, points: SQUARE.slice(0, 3), height: [5, 6] },
        ],
      },
    ]);
    const clip = parseClips(gid, 1)[0]!;
    expect(clip.hasVertical).toBe(true);
    expect(clip.elements.map((e) => e.heightPoint)).toEqual([[-300, 400], [5, 6]]);
    expect(clip.elements[1]!.points).toHaveLength(6);
  });

  it('handles several clips and elements with zero count', () => {
    const gid = buildGid([
      undefined,
      { radiusX: 5, radiusY: 6, flags: 0, adjust: 8, elements: [{ scale: 0, baseHeight: 0, points: SQUARE }] },
    ]);
    const clips = parseClips(gid, 2);
    expect(clips[0]!.elements).toEqual([]);
    expect(clips[1]!.radiusX).toBe(5);
  });

  it('is exposed on parseTBL via the GID: chunk', () => {
    const names = new Bytes().u16(0, 1).u16(0).u16(0).raw([0x61, 0]).done(); // MAP: one model "a"
    const gid = buildGid([
      { radiusX: 9, radiusY: 8, flags: 0, adjust: 8, elements: [{ scale: 0, baseHeight: 0, points: SQUARE }] },
    ]);
    const chunk = (tag: string, p: Uint8Array) =>
      new Bytes().ascii(tag).u16(p.length, 0).raw(p).done();
    const tbl = new Bytes().raw(chunk('MAP:', names)).raw(chunk('GID:', gid)).done();
    const table = parseTBL(tbl);
    expect(table.clips[0]!.radiusX).toBe(9);
  });

  it('reports which clip failed when data is truncated', () => {
    expect(() => parseClips(new Bytes().u16(0, 0).done(), 1)).toThrow(/clip 0/);
  });
});

const box = (half: number): ModelClip => ({
  radiusX: half,
  radiusY: half,
  walkable: false,
  hasVertical: false,
  elements: [
    {
      scale: 0,
      baseHeight: 0,
      points: [-half, -half, half, -half, half, half, -half, half],
      normals: [],
    },
  ],
});

describe('placeClip', () => {
  it('translates polygons to the item position', () => {
    const [poly] = placeClip(box(100), { x: 1000, y: 2000, zRot: 0 });
    expect(poly!.points).toEqual([900, 1900, 1100, 1900, 1100, 2100, 900, 2100]);
    expect([poly!.minX, poly!.maxX, poly!.minY, poly!.maxY]).toEqual([900, 1100, 1900, 2100]);
  });

  it('rotates counter-clockwise by the 16-bit yaw', () => {
    const clip: ModelClip = { ...box(0), elements: [{ scale: 0, baseHeight: 0, points: [100, 0, 0, 100, -100, 0], normals: [] }] };
    const [poly] = placeClip(clip, { x: 0, y: 0, zRot: 0x4000 }); // 90°
    expect(poly!.points[0]).toBeCloseTo(0);
    expect(poly!.points[1]).toBeCloseTo(100);
    expect(poly!.points[2]).toBeCloseTo(-100);
    expect(poly!.points[3]).toBeCloseTo(0);
  });

  it('falls back to the radius rectangle when there are no elements', () => {
    const [poly] = placeClip({ radiusX: 50, radiusY: 20, walkable: false, hasVertical: false, elements: [] }, { x: 0, y: 0, zRot: 0 });
    expect(poly!.points).toEqual([-50, -20, 50, -20, 50, 20, -50, 20]);
  });

  it('emits nothing for an empty clip with no radius', () => {
    expect(placeClip({ radiusX: 0, radiusY: 0, walkable: false, hasVertical: false, elements: [] }, { x: 0, y: 0, zRot: 0 })).toEqual([]);
  });
});

describe('buildCollisionPolygons', () => {
  const clips: (ModelClip | undefined)[] = [undefined, box(10), { ...box(20), walkable: true }, undefined];
  const item = (type: number, x = 0) => ({ type, xRot: 0, yRot: 0, zRot: 0, x, y: 0, z: 0 });

  it('skips tile centres, missing clips and walkable clips', () => {
    const polys = buildCollisionPolygons([item(0), item(1, 100), item(2, 200), item(3, 300)], clips);
    expect(polys).toHaveLength(1);
    expect(polys[0]!.minX).toBe(90);
  });

  it('can include walkable clips', () => {
    expect(buildCollisionPolygons([item(2)], clips, { includeWalkable: true })).toHaveLength(1);
  });
});

describe('slideMove', () => {
  const wall = placeClip(box(100), { x: 0, y: 0, zRot: 0 }); // square, x/y in [-100, 100]

  it('moves freely when nothing is in the way', () => {
    expect(slideMove({ x: 500, y: 500 }, { x: 10, y: -5 }, 20, wall)).toEqual({ x: 510, y: 495 });
  });

  it('stops a circle at the wall surface', () => {
    const p = slideMove({ x: 200, y: 0 }, { x: -150, y: 0 }, 20, wall);
    expect(p.x).toBeCloseTo(120, 1);
    expect(p.y).toBeCloseTo(0, 5);
  });

  it('slides along the wall for diagonal movement', () => {
    const p = slideMove({ x: 200, y: 0 }, { x: -150, y: 50 }, 20, wall);
    expect(p.x).toBeCloseTo(120, 1);
    expect(p.y).toBeGreaterThan(40);
  });

  it('does not tunnel through a thin wall on a large step', () => {
    const thin = placeClip({ ...box(0), elements: [{ scale: 0, baseHeight: 0, points: [-5, -500, 5, -500, 5, 500, -5, 500], normals: [] }] }, { x: 0, y: 0, zRot: 0 });
    const p = slideMove({ x: 100, y: 0 }, { x: -200, y: 0 }, 10, thin);
    expect(p.x).toBeGreaterThan(5);
  });

  it('pushes a circle that starts inside a polygon out through the nearest edge', () => {
    const p = slideMove({ x: 90, y: 0 }, { x: 0, y: 0 }, 10, wall);
    expect(p.x).toBeCloseTo(110, 1);
    expect(pointInPolygon(wall[0]!, p.x, p.y)).toBe(false);
  });

  it('rounds corners without penetrating', () => {
    const p = slideMove({ x: 150, y: 150 }, { x: -60, y: -60 }, 20, wall);
    const d = Math.hypot(Math.max(Math.abs(p.x) - 100, 0), Math.max(Math.abs(p.y) - 100, 0));
    expect(d).toBeGreaterThanOrEqual(19.9);
  });
});
