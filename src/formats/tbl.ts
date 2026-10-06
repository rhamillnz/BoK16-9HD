import { Reader } from './reader';
import { findTag, requireTag } from './tagged';

/**
 * Zone model tables (Zxx.TBL). See docs/formats/zones-and-models.md §1.
 * Chunks: MAP: (names), APP: (unparsed), GID: (collision), DAT: (geometry).
 */

export const EF_UNBOUNDED = 0x20;
export const EF_2D_OBJECT = 0x40;
const FACE_SPRITE = 2;

export interface Face {
  /** Palette/material flag byte (0x90, 0xC1 = terrain-textured, ...). */
  material: number;
  /** Palette colour index, or texture sub-index for textured materials. */
  color: number;
  /** Indices into Model.vertices, forming a polygon loop. */
  indices: number[];
}

export interface SpriteInfo {
  /** Index into the zone's concatenated ZxxSLOT*.BMX images. */
  index: number;
  offsetX: number;
  offsetY: number;
  baseVertex: number;
  scale: number;
}

export interface Model {
  name: string;
  flags: number;
  entityType: number;
  terrainType: number;
  /** Vertices are multiplied by 2^scale. */
  scale: number;
  radius: number;
  min?: [number, number, number];
  max?: [number, number, number];
  /** Flattened [x, y, z] in BaK model space (x east, y north, z up), already scaled. */
  vertices: number[];
  /** Faces for animation frame 0. */
  faces: Face[];
  /** Number of animation frames (max face options over all meshes). */
  frames: number;
  sprite?: SpriteInfo;
}

/** One clip polygon of a ModelClip (§1.5.3–1.5.4). Coordinates are raw model-space units. */
export interface ClipElement {
  /** Element scale factor as stored; its use by the original engine is not yet confirmed, so points are left unscaled. */
  scale: number;
  baseHeight: number;
  /** Closed polygon loop, flattened [x, y, ...]. */
  points: number[];
  /** Edge normal components, flattened [u, v, ...], one pair per point. */
  normals: number[];
  /** Vertical limit point [x, y]; only present when the clip has the vertical flag. */
  heightPoint?: [number, number];
}

export interface ModelClip {
  radiusX: number;
  radiusY: number;
  /** Player can step on it, so it does not block movement. */
  walkable: boolean;
  /** Has 3D height / extrusion data. */
  hasVertical: boolean;
  elements: ClipElement[];
}

export interface ModelTable {
  names: string[];
  models: (Model | undefined)[];
  /** Collision clips from the GID: chunk, indexed like names. Empty when the chunk is absent. */
  clips: (ModelClip | undefined)[];
  /**
   * One message per model or clip that failed to parse (its slot is then `undefined`).
   * Real tables can contain entries our reader cannot decode, e.g. COMBAT.TBL's `dots`.
   */
  warnings: string[];
}

export const CLIP_WALKABLE = 0x01;
export const CLIP_HAS_VERTICAL = 0x02;

export function parseTBL(bytes: Uint8Array): ModelTable {
  const names = parseNames(requireTag(bytes, 'MAP:'));
  const warnings: string[] = [];
  const dat = findTag(bytes, 'DAT:');
  const models = dat ? parseModels(dat, names, warnings) : names.map(() => undefined);
  const gid = findTag(bytes, 'GID:');
  const clips = gid ? parseClips(gid, names.length, warnings) : [];
  return { names, models, clips, warnings };
}

/**
 * GID: chunk (§1.5). Item offsets are chunk-relative; a zero-length record yields no clip.
 * A clip that fails to parse throws, unless `warnings` is given: then it becomes `undefined`
 * and its message is appended there.
 */
export function parseClips(gid: Uint8Array, count: number, warnings?: string[]): (ModelClip | undefined)[] {
  const r = new Reader(gid);
  const offsets = Array.from({ length: count }, () => segOffset(r));
  return offsets.map((start, i) => {
    try {
      return parseClip(gid, start);
    } catch (err) {
      const message = `clip ${i}: ${(err as Error).message}`;
      if (!warnings) throw new Error(message);
      warnings.push(message);
      return undefined;
    }
  });
}

function parseClip(gid: Uint8Array, start: number): ModelClip {
  const r = new Reader(gid, start);
  const radiusX = r.u16();
  const radiusY = r.u16();
  const flags = r.u8();
  const elementCount = r.u8();
  const adjust = r.u16() - 8;
  const hasVertical = (flags & CLIP_HAS_VERTICAL) !== 0;

  const headers = Array.from({ length: elementCount }, () => {
    const edgeOffs = r.u16();
    const entries = r.u8();
    const scale = r.u8();
    const baseHeight = r.u16();
    let heightOff: number | undefined;
    if (hasVertical) {
      heightOff = r.u16();
      r.skip(2);
    }
    return { edgeOffs, entries, scale, baseHeight, heightOff };
  });

  const elements = headers.map((h): ClipElement => {
    const pr = new Reader(gid, start + h.edgeOffs - adjust);
    const points: number[] = [];
    const normals: number[] = [];
    for (let p = 0; p < h.entries; p++) {
      normals.push(pr.u8() << 24 >> 24, pr.u8() << 24 >> 24);
      points.push(pr.i16(), pr.i16());
    }
    let heightPoint: ClipElement['heightPoint'];
    if (h.heightOff !== undefined) {
      const hr = new Reader(gid, start + h.heightOff - adjust);
      hr.skip(2);
      heightPoint = [hr.i16(), hr.i16()];
    }
    return { scale: h.scale, baseHeight: h.baseHeight, points, normals, heightPoint };
  });

  return { radiusX, radiusY, walkable: (flags & CLIP_WALKABLE) !== 0, hasVertical, elements };
}

function parseNames(map: Uint8Array): string[] {
  const r = new Reader(map);
  r.skip(2);
  const count = r.u16();
  const offsets = Array.from({ length: count }, () => r.u16());
  r.skip(2);
  const start = r.pos;
  return offsets.map((o) => {
    let s = '';
    for (let p = start + o; p < map.length && map[p] !== 0; p++) s += String.fromCharCode(map[p]!);
    return s;
  });
}

/** Segment:offset style pair → linear byte offset. */
function segOffset(r: Reader): number {
  const lower = r.u16();
  const upper = r.u16();
  return (upper << 4) + (lower & 0x0f);
}

function parseModels(dat: Uint8Array, names: string[], warnings: string[]): (Model | undefined)[] {
  const r = new Reader(dat);
  const offsets = names.map(() => segOffset(r));
  const models: (Model | undefined)[] = [];
  names.forEach((name, i) => {
    if (name === 'null') return void models.push(undefined);
    // "boom" has no usable geometry; the original engine aliases the previous model.
    if (name === 'boom') return void models.push(models.at(-1));
    try {
      models.push(parseModel(dat, offsets[i]!, name));
    } catch (err) {
      warnings.push(`model ${i} (${name}): ${(err as Error).message}`);
      models.push(undefined);
    }
  });
  return models;
}

function parseModel(dat: Uint8Array, offset: number, name: string): Model {
  const r = new Reader(dat, offset);
  const flags = r.u8();
  const entityType = r.u8();
  const terrainType = r.u8();
  const scaleExp = r.u8();
  r.u16(); // animation count
  r.u16(); // animation offset
  const componentCount = r.u16();
  const baseOffset = r.u16();
  const radius = r.i16();
  let min: Model['min'];
  let max: Model['max'];
  if (!(flags & EF_UNBOUNDED)) {
    min = [r.i16(), r.i16(), r.i16()];
    max = [r.i16(), r.i16(), r.i16()];
  }

  const components = Array.from({ length: componentCount }, () => {
    r.skip(2);
    return { meshCount: r.u16(), meshOffset: r.u16() };
  });

  // All internal offsets are relative to the end of the fixed header (14 or 26 bytes),
  // NOT to the end of the component table.
  const headerEnd = offset + 14 + (flags & EF_UNBOUNDED ? 0 : 12);
  const rel = (o: number) => headerEnd + o - baseOffset;
  const scale = 1 << scaleExp;

  // Mesh headers. Consecutive meshes may share one vertex set (same count and offset).
  interface MeshHeader { vertexCount: number; vertexOffset: number; base: number; faceCount: number; faceOffset: number }
  const meshes: MeshHeader[] = [];
  const vertexSets: { count: number; offset: number }[] = [];
  let base = 0;
  for (const c of components) {
    const mr = new Reader(dat, rel(c.meshOffset));
    for (let m = 0; m < c.meshCount; m++) {
      mr.skip(3);
      const vertexCount = mr.u8();
      const vertexOffset = mr.u16();
      const faceCount = mr.u16();
      const faceOffset = mr.u16();
      mr.skip(4);
      const last = vertexSets.at(-1);
      if (!last || last.count !== vertexCount || last.offset !== vertexOffset) {
        if (last) base += last.count;
        vertexSets.push({ count: vertexCount, offset: vertexOffset });
      }
      meshes.push({ vertexCount, vertexOffset, base, faceCount, faceOffset });
    }
  }

  const vertices: number[] = [];
  for (const s of vertexSets) {
    const vr = new Reader(dat, rel(s.offset));
    for (let v = 0; v < s.count; v++) vertices.push(vr.i16() * scale, vr.i16() * scale, vr.i16() * scale);
  }
  const vertexTotal = vertices.length / 3;

  const faces: Face[] = [];
  let frames = 0;
  let sprite: SpriteInfo | undefined;
  for (const { base, faceCount, faceOffset } of meshes) {
    {
      frames = Math.max(frames, faceCount);
      if (faceCount === 0) continue;
      // Only frame 0 is read for now; further face options are animation frames.
      const fr = new Reader(dat, rel(faceOffset));
      const faceType = fr.u16();
      const edgeCount = fr.u16();
      const edgeOffset = fr.u16();
      const extra = fr.u16();
      if (faceType === FACE_SPRITE) {
        sprite ??= {
          index: edgeCount,
          offsetX: edgeOffset >> 8,
          offsetY: edgeOffset & 0xff,
          baseVertex: extra >> 8,
          scale: extra & 0xff,
        };
        continue;
      }
      const er = new Reader(dat, rel(edgeOffset));
      for (let e = 0; e < edgeCount; e++) {
        const material = er.u8();
        const color = er.u8();
        er.skip(3); // remaining colour bytes
        er.u8(); // group
        const indexOffset = er.u16();
        const ir = new Reader(dat, rel(indexOffset));
        const indices: number[] = [];
        for (let idx = ir.u8(); idx !== 0xff; idx = ir.u8()) {
          if (base + idx >= vertexTotal) throw new Error(`vertex index ${base + idx} >= ${vertexTotal}`);
          indices.push(base + idx);
        }
        faces.push({ material, color, indices });
      }
    }
  }

  return { name, flags, entityType, terrainType, scale, radius, min, max, vertices, faces, frames, sprite };
}

/** Zone 1 → "Z01.TBL". */
export function zonePrefix(zone: number): string {
  return `Z${String(zone).padStart(2, '0')}`;
}
