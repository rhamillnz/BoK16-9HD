import { describe, expect, it } from 'vitest';
import type { IndexedImage } from '../src/formats/bmx';
import { parseSCX, Terrain, TERRAIN_STRIP_HEIGHTS, terrainStrips } from '../src/formats/scx';
import { parseTBL, zonePrefix } from '../src/formats/tbl';
import {
  angleToRadians,
  headingToRadians,
  parseChapterStart,
  parseWLD,
  parseZoneRef,
  tileName,
} from '../src/formats/world';

/** Little-endian byte builder for hand-made fixtures. */
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
  u32(...vs: number[]): this {
    for (const v of vs) this.u16(v & 0xffff, v >>> 16);
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

// ---------------------------------------------------------------------------
// TBL fixture builders (docs/formats/zones-and-models.md §1)
// ---------------------------------------------------------------------------

type Vec3 = [number, number, number];

interface EdgeSpec {
  material: number;
  color: number;
  group?: number;
  indices: number[];
}

type FaceSpec =
  | { edges: EdgeSpec[] }
  | { sprite: { index: number; offsetX: number; offsetY: number; baseVertex: number; scale: number } };

interface MeshSpec {
  /** Index into ModelSpec.vertexSets. Meshes naming the same set share vertices. */
  set: number;
  faces: FaceSpec[];
}

interface ModelSpec {
  flags: number;
  entityType: number;
  terrainType: number;
  scaleExp: number;
  radius: number;
  /** Required unless flags & 0x20 (EF_UNBOUNDED). */
  bounds?: { min: Vec3; max: Vec3 };
  /** Added to every stored internal offset; the parser must subtract it again. */
  baseOffset: number;
  vertexSets: Vec3[][];
  components: MeshSpec[][];
}

/**
 * Serialises one model record. Every internal offset is stored as
 * (position relative to the END of the 14/26-byte header) + baseOffset.
 */
function buildModel(m: ModelSpec): Uint8Array {
  const bounded = !(m.flags & 0x20);
  const stored = (pos: number) => pos + m.baseOffset;

  // Pass 1: lay out the body that follows the header.
  let p = m.components.length * 6;
  const meshTablePos = m.components.map((c) => {
    const at = p;
    p += c.length * 14;
    return at;
  });
  const setPos = m.vertexSets.map((s) => {
    const at = p;
    p += s.length * 6;
    return at;
  });
  const meshes = m.components.flat();
  const facePos = meshes.map((mesh) => {
    const at = p;
    p += mesh.faces.length * 8;
    return at;
  });
  interface PolyLayout { edgePos: number; indexPos: number[] }
  const polyLayout = new Map<FaceSpec, PolyLayout>();
  for (const mesh of meshes) {
    for (const face of mesh.faces) {
      if (!('edges' in face)) continue;
      const edgePos = p;
      p += face.edges.length * 8; // material, colour[4], group, u16 index offset
      const indexPos = face.edges.map((e) => {
        const at = p;
        p += e.indices.length + 1;
        return at;
      });
      polyLayout.set(face, { edgePos, indexPos });
    }
  }
  const bodySize = p;

  // Pass 2: emit.
  const out = new Bytes();
  out.u8(m.flags, m.entityType, m.terrainType, m.scaleExp);
  out.u16(1, 0); // animation count / offset (ignored)
  out.u16(m.components.length, m.baseOffset);
  out.u16(m.radius);
  if (bounded) {
    if (!m.bounds) throw new Error('bounded model needs bounds');
    for (const v of [...m.bounds.min, ...m.bounds.max]) out.u16(v);
  }
  const headerSize = out.length;
  expect(headerSize).toBe(bounded ? 26 : 14);

  m.components.forEach((c, i) => out.u16(0xbeef, c.length, stored(meshTablePos[i]!)));
  let meshIdx = 0;
  for (const c of m.components) {
    for (const mesh of c) {
      const set = m.vertexSets[mesh.set]!;
      out.pad(3, 0xee).u8(set.length).u16(stored(setPos[mesh.set]!));
      out.u16(mesh.faces.length, stored(facePos[meshIdx]!)).pad(4, 0xee);
      meshIdx++;
    }
  }
  for (const set of m.vertexSets) for (const v of set) out.u16(...v);
  for (const mesh of meshes) {
    for (const face of mesh.faces) {
      if ('sprite' in face) {
        const s = face.sprite;
        out.u16(2, s.index, (s.offsetX << 8) | s.offsetY, (s.baseVertex << 8) | s.scale);
      } else {
        out.u16(1, face.edges.length, stored(polyLayout.get(face)!.edgePos), 0x1234);
      }
    }
  }
  for (const mesh of meshes) {
    for (const face of mesh.faces) {
      if (!('edges' in face)) continue;
      const lay = polyLayout.get(face)!;
      face.edges.forEach((e, i) => {
        out.u8(e.material, e.color).pad(3, 0xaa).u8(e.group ?? 0).u16(stored(lay.indexPos[i]!));
      });
      face.edges.forEach((e) => out.u8(...e.indices, 0xff));
    }
  }
  expect(out.length - headerSize).toBe(bodySize);
  return out.done();
}

function chunk(tag: string, payload: Uint8Array, sizeFlags = 0): Uint8Array {
  return new Bytes().ascii(tag).u32((payload.length | sizeFlags) >>> 0).raw(payload).done();
}

/** MAP: chunk payload. String data is laid out in reverse so offsets matter. */
function buildMap(names: string[]): Uint8Array {
  const order = names.map((_, i) => i).reverse();
  const offsets: number[] = [];
  const strings = new Bytes();
  for (const i of order) {
    offsets[i] = strings.length;
    strings.ascii(names[i]!).u8(0);
  }
  return new Bytes().u16(0, names.length).u16(...offsets).u16(0).raw(strings.done()).done();
}

/**
 * DAT: chunk payload. Models are separated by 3 bytes of padding so their offsets are not
 * 16-aligned, and the stored "lower" word carries junk in its high nibbles to prove that
 * only (lower & 0x0f) + (upper << 4) is used.
 */
function buildDat(models: (Uint8Array | undefined)[]): Uint8Array {
  const tableSize = models.length * 4;
  const table = new Bytes();
  const body = new Bytes();
  for (const m of models) {
    if (!m) {
      table.u16(0xfff0, 0);
      continue;
    }
    body.pad(3, 0xdd);
    const offset = tableSize + body.length;
    table.u16(0xab00 | (offset & 0x0f), offset >> 4);
    body.raw(m);
  }
  return new Bytes().raw(table.done()).raw(body.done()).done();
}

function buildTbl(names: string[], models?: (Uint8Array | undefined)[]): Uint8Array {
  const out = new Bytes();
  out.raw(chunk('APP:', new Bytes().u8(1, 2, 3, 4, 5, 6).done()));
  out.raw(chunk('MAP:', buildMap(names)));
  out.raw(chunk('GID:', new Bytes().u8(9, 9, 9, 9).done()));
  // High bit of the size marks a container chunk; the parser must mask it off.
  if (models) out.raw(chunk('DAT:', buildDat(models), 0x80000000));
  return out.done();
}

const BOUNDED_BOX: ModelSpec = {
  flags: 0x00,
  entityType: 3,
  terrainType: 5,
  scaleExp: 1,
  radius: 100,
  bounds: { min: [-5, 0, 0], max: [10, 20, 30] },
  baseOffset: 0x10,
  vertexSets: [[[0, 0, 0], [10, 0, 0], [10, 20, 0], [-5, 20, 30]]],
  components: [[{ set: 0, faces: [{ edges: [{ material: 0xc1, color: 7, group: 4, indices: [0, 1, 2, 3] }] }] }]],
};

const UNBOUNDED_MULTI: ModelSpec = {
  flags: 0x20,
  entityType: 1,
  terrainType: 0,
  scaleExp: 2,
  radius: 250,
  baseOffset: 0x0123,
  vertexSets: [
    [[1, 2, 3], [-4, 5, 6], [7, -8, 9]],
    [[10, 0, 0], [0, 10, 0], [0, 0, -10]],
  ],
  components: [
    [
      // Two consecutive meshes share vertex set 0.
      { set: 0, faces: [{ edges: [{ material: 0x90, color: 12, indices: [0, 1, 2] }] }] },
      {
        set: 0,
        faces: [
          { edges: [{ material: 0x91, color: 13, indices: [2, 1, 0] }] },
          // A second face option (animation frame): counted in `frames`, not read as geometry.
          { edges: [{ material: 0x92, color: 99, indices: [0, 1] }] },
        ],
      },
    ],
    [
      // A different vertex set: its indices are offset by the first set's 3 vertices.
      {
        set: 1,
        faces: [
          {
            edges: [
              { material: 0xd1, color: 21, indices: [0, 1, 2] },
              { material: 0x11, color: 22, indices: [2, 0] },
            ],
          },
        ],
      },
      // Shares set 1 and has no faces at all.
      { set: 1, faces: [] },
    ],
  ],
};

const SPRITE: ModelSpec = {
  flags: 0x60, // EF_2D_OBJECT | EF_UNBOUNDED
  entityType: 9,
  terrainType: 0,
  scaleExp: 0,
  radius: 40,
  baseOffset: 0,
  vertexSets: [[[0, 0, 0]]],
  components: [[{ set: 0, faces: [{ sprite: { index: 7, offsetX: 3, offsetY: 4, baseVertex: 2, scale: 9 } }] }]],
};

describe('zonePrefix', () => {
  it('zero-pads the zone number', () => {
    expect(zonePrefix(1)).toBe('Z01');
    expect(zonePrefix(12)).toBe('Z12');
  });
});

describe('parseTBL', () => {
  const names = ['box', 'null', 'multi', 'boom', 'sprite'];
  const table = parseTBL(
    buildTbl(names, [buildModel(BOUNDED_BOX), undefined, buildModel(UNBOUNDED_MULTI), undefined, buildModel(SPRITE)]),
  );

  it('reads the MAP: name table via its offsets', () => {
    expect(table.names).toEqual(names);
    expect(table.models).toHaveLength(names.length);
  });

  it('parses a bounded mesh model (26-byte header) and subtracts baseOffset', () => {
    const m = table.models[0]!;
    expect(m).toMatchObject({
      name: 'box',
      flags: 0x00,
      entityType: 3,
      terrainType: 5,
      scale: 2, // 1 << scaleExp(1)
      radius: 100,
      min: [-5, 0, 0],
      max: [10, 20, 30],
      frames: 1,
    });
    // Vertices are multiplied by the scale and keep their sign.
    expect(m.vertices).toEqual([0, 0, 0, 20, 0, 0, 20, 40, 0, -10, 40, 60]);
    expect(m.faces).toEqual([{ material: 0xc1, color: 7, indices: [0, 1, 2, 3] }]);
    expect(m.sprite).toBeUndefined();
  });

  it('parses an unbounded model (14-byte header) without bounds', () => {
    const m = table.models[2]!;
    expect(m.flags).toBe(0x20);
    expect(m.min).toBeUndefined();
    expect(m.max).toBeUndefined();
    expect(m.scale).toBe(4);
    expect(m.radius).toBe(250);
  });

  it('shares a vertex set between meshes and offsets later sets', () => {
    const m = table.models[2]!;
    // Two sets of three vertices, stored once each, scaled by 4.
    expect(m.vertices).toEqual([
      4, 8, 12, -16, 20, 24, 28, -32, 36,
      40, 0, 0, 0, 40, 0, 0, 0, -40,
    ]);
    expect(m.faces).toEqual([
      { material: 0x90, color: 12, indices: [0, 1, 2] }, // mesh 0: set 0, base 0
      { material: 0x91, color: 13, indices: [2, 1, 0] }, // mesh 1: shares set 0, base 0
      { material: 0xd1, color: 21, indices: [3, 4, 5] }, // component 1: set 1, base 3
      { material: 0x11, color: 22, indices: [5, 3] },
    ]);
  });

  it('counts frames as the maximum face-option count and reads only frame 0', () => {
    const m = table.models[2]!;
    expect(m.frames).toBe(2);
    expect(m.faces.some((f) => f.color === 99)).toBe(false);
  });

  it('parses a sprite face (type 2) into SpriteInfo with no polygon faces', () => {
    const m = table.models[4]!;
    expect(m.name).toBe('sprite');
    expect(m.flags).toBe(0x60);
    expect(m.faces).toEqual([]);
    expect(m.sprite).toEqual({ index: 7, offsetX: 3, offsetY: 4, baseVertex: 2, scale: 9 });
  });

  it('leaves "null" undefined and makes "boom" alias the previous model', () => {
    expect(table.models[1]).toBeUndefined();
    expect(table.models[3]).toBeDefined();
    expect(table.models[3]).toBe(table.models[2]);
  });

  it('gives "boom" no model when nothing precedes it or the predecessor is "null"', () => {
    const t = parseTBL(buildTbl(['boom', 'null', 'boom'], [undefined, undefined, undefined]));
    expect(t.models).toEqual([undefined, undefined, undefined]);
  });

  it('returns undefined models when there is no DAT: chunk', () => {
    const t = parseTBL(buildTbl(['a', 'b']));
    expect(t.names).toEqual(['a', 'b']);
    expect(t.models).toEqual([undefined, undefined]);
  });

  it('throws when MAP: is missing', () => {
    expect(() => parseTBL(chunk('DAT:', new Uint8Array(8)))).toThrow('tag not found: MAP:');
  });

  it('reports the model index and name when a vertex index is out of range', () => {
    const bad: ModelSpec = {
      ...BOUNDED_BOX,
      components: [[{ set: 0, faces: [{ edges: [{ material: 0x90, color: 1, indices: [0, 4] }] }] }]],
    };
    expect(() => parseTBL(buildTbl(['bad'], [buildModel(bad)]))).toThrow(/model 0 \(bad\): vertex index 4 >= 4/);
  });
});

// ---------------------------------------------------------------------------
// WLD / REF / CHAP
// ---------------------------------------------------------------------------

describe('parseWLD', () => {
  const record = (type: number, rot: [number, number, number], pos: [number, number, number]) =>
    new Bytes().u16(type, ...rot).u32(...pos).done();

  it('reads headerless 20-byte placement records', () => {
    const bytes = new Bytes()
      .raw(record(0, [0, 0, 0], [6 * 64000 + 32000, 7 * 64000 + 32000, 0]))
      .raw(record(12, [0x1000, 0x2000, 0xc000], [385234, 448987, 250]))
      .done();
    expect(bytes.length).toBe(40);
    expect(parseWLD(bytes)).toEqual([
      { type: 0, xRot: 0, yRot: 0, zRot: 0, x: 416000, y: 480000, z: 0 },
      { type: 12, xRot: 0x1000, yRot: 0x2000, zRot: 0xc000, x: 385234, y: 448987, z: 250 },
    ]);
  });

  it('reads coordinates as unsigned 32-bit values', () => {
    const [item] = parseWLD(record(1, [0, 0, 0], [0xfffffff0, 0x80000000, 1]));
    expect(item!.x).toBe(0xfffffff0);
    expect(item!.y).toBe(0x80000000);
  });

  it('ignores a trailing partial record and accepts an empty file', () => {
    const bytes = new Bytes().raw(record(3, [0, 0, 0], [1, 2, 3])).pad(19, 0xff).done();
    expect(parseWLD(bytes)).toHaveLength(1);
    expect(parseWLD(new Uint8Array(0))).toEqual([]);
  });
});

describe('tileName', () => {
  it('formats T<zone><x><y>.<ext> with two-digit padding', () => {
    expect(tileName(1, 6, 7, 'WLD')).toBe('T010607.WLD');
    expect(tileName(12, 10, 3, 'DAT')).toBe('T121003.DAT');
  });
});

describe('parseZoneRef', () => {
  it('reads a u8 count followed by (x, y) tile pairs', () => {
    expect(parseZoneRef(Uint8Array.of(3, 6, 7, 6, 8, 7, 7))).toEqual([
      [6, 7],
      [6, 8],
      [7, 7],
    ]);
  });

  it('handles zero tiles and an empty file', () => {
    expect(parseZoneRef(Uint8Array.of(0))).toEqual([]);
    expect(parseZoneRef(new Uint8Array(0))).toEqual([]);
  });
});

describe('parseChapterStart', () => {
  const chap = (loc: { zone: number; tx: number; ty: number; cx: number; cy: number; heading: number }) =>
    new Bytes()
      .u16(1) // chapter
      .u32(0, 0x1234) // gold, time change
      .pad(6, 0x55)
      .u8(loc.zone, loc.tx, loc.ty, loc.cx, loc.cy)
      .u16(loc.heading)
      .done();

  it('places the player at tile*64000 + cell*1600 + 800 and uses the heading high byte', () => {
    const start = parseChapterStart(chap({ zone: 1, tx: 6, ty: 7, cx: 12, cy: 30, heading: 0xc0ff }));
    expect(start).toEqual({
      chapter: 1,
      zone: 1,
      tileX: 6,
      tileY: 7,
      cellX: 12,
      cellY: 30,
      heading: 0xc0, // 192 = east
      x: 6 * 64000 + 12 * 1600 + 800,
      y: 7 * 64000 + 30 * 1600 + 800,
    });
    expect(start.x).toBe(404000);
    expect(start.y).toBe(496800);
  });

  it('centres the origin cell at half a cell', () => {
    const start = parseChapterStart(chap({ zone: 2, tx: 0, ty: 0, cx: 0, cy: 0, heading: 0x4000 }));
    expect(start.x).toBe(800);
    expect(start.y).toBe(800);
    expect(start.heading).toBe(64); // west
  });

  it('converts angles and headings to radians', () => {
    expect(angleToRadians(0x4000)).toBeCloseTo(Math.PI / 2);
    expect(headingToRadians(64)).toBeCloseTo(Math.PI / 2);
    expect(headingToRadians(192)).toBeCloseTo((3 * Math.PI) / 2);
  });
});

// ---------------------------------------------------------------------------
// SCX terrain sheet
// ---------------------------------------------------------------------------

describe('terrainStrips', () => {
  /** 320x200 sheet whose pixel value is its row number. */
  const sheet: IndexedImage = {
    width: 320,
    height: 200,
    pixels: Uint8Array.from({ length: 320 * 200 }, (_, i) => Math.floor(i / 320)),
  };

  it('uses the 8 fixed strip heights, which sum to the 200-row sheet', () => {
    expect(TERRAIN_STRIP_HEIGHTS).toEqual([70, 20, 20, 32, 20, 27, 6, 5]);
    expect(TERRAIN_STRIP_HEIGHTS.reduce((a, b) => a + b, 0)).toBe(200);
  });

  it('slices the sheet into strips of those heights with contiguous rows', () => {
    const strips = terrainStrips(sheet);
    expect(strips.map((s) => s.height)).toEqual([70, 20, 20, 32, 20, 27, 6, 5]);
    let row = 0;
    for (const s of strips) {
      expect(s.width).toBe(320);
      expect(s.pixels).toHaveLength(320 * s.height);
      expect(s.pixels[0]).toBe(row);
      expect(s.pixels.at(-1)).toBe(row + s.height - 1);
      row += s.height;
    }
    expect(row).toBe(200);
  });

  it('indexes strips by the Terrain enum', () => {
    const strips = terrainStrips(sheet);
    expect(strips[Terrain.Ground]!.height).toBe(70);
    expect(strips[Terrain.Road]!.pixels[0]).toBe(70);
    expect(strips[Terrain.Waterfall]!.pixels[0]).toBe(90);
    expect(strips[Terrain.Path]!.pixels[0]).toBe(110);
    expect(strips[Terrain.Dirt]!.pixels[0]).toBe(142);
    expect(strips[Terrain.River]!.pixels[0]).toBe(162);
    expect(strips[Terrain.Sand]!.pixels[0]).toBe(189);
    expect(strips[Terrain.Bank]!.pixels[0]).toBe(195);
    expect(strips[Terrain.Bank]!.height).toBe(5);
  });

  it('copies pixels rather than aliasing the sheet', () => {
    const strips = terrainStrips(sheet);
    strips[0]!.pixels[0] = 255;
    expect(sheet.pixels[0]).toBe(0);
  });
});

describe('parseSCX', () => {
  it('rejects a wrong signature', () => {
    expect(() => parseSCX(Uint8Array.of(0x34, 0x12, 0, 0, 0))).toThrow('unknown SCX signature 0x1234');
  });
});
