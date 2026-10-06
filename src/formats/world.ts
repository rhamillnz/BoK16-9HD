import { Reader } from './reader';

/**
 * World tiles and zone-level data. See docs/formats/zones-and-models.md §2–4.
 * BaK coordinates: x east, y north, z up. One tile = 64000 units = 40 cells of 1600.
 */

export const TILE_SIZE = 64000;
export const CELL_SIZE = 1600;

export interface WorldItem {
  /** Index into the zone ModelTable. */
  type: number;
  /** 16-bit angles (65536 = full turn). zRot is the yaw. */
  xRot: number;
  yRot: number;
  zRot: number;
  x: number;
  y: number;
  z: number;
}

/** TzzXXYY.WLD: headerless 20-byte placement records. */
export function parseWLD(bytes: Uint8Array): WorldItem[] {
  const r = new Reader(bytes);
  const items: WorldItem[] = [];
  while (r.remaining >= 20) {
    items.push({ type: r.u16(), xRot: r.u16(), yRot: r.u16(), zRot: r.u16(), x: r.u32(), y: r.u32(), z: r.u32() });
  }
  return items;
}

export function tileName(zone: number, tx: number, ty: number, ext: 'WLD' | 'DAT'): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `T${p(zone)}${p(tx)}${p(ty)}.${ext}`;
}

/** ZzzREF.DAT: u8 count, then (u8 x, u8 y) per tile. */
export function parseZoneRef(bytes: Uint8Array): [number, number][] {
  const count = bytes[0] ?? 0;
  return Array.from({ length: count }, (_, i) => [bytes[1 + i * 2]!, bytes[2 + i * 2]!]);
}

export interface ChapterStart {
  chapter: number;
  zone: number;
  tileX: number;
  tileY: number;
  cellX: number;
  cellY: number;
  /** 8-bit heading: 0 north, 64 west, 128 south, 192 east (counter-clockwise). */
  heading: number;
  /** World position at the centre of the start cell. */
  x: number;
  y: number;
}

/** CHAPn.DAT start location. */
export function parseChapterStart(bytes: Uint8Array): ChapterStart {
  const r = new Reader(bytes);
  const chapter = r.u16();
  r.skip(14);
  const zone = r.u8();
  const tileX = r.u8();
  const tileY = r.u8();
  const cellX = r.u8();
  const cellY = r.u8();
  const heading = r.u16() >> 8;
  return {
    chapter, zone, tileX, tileY, cellX, cellY, heading,
    x: tileX * TILE_SIZE + cellX * CELL_SIZE + CELL_SIZE / 2,
    y: tileY * TILE_SIZE + cellY * CELL_SIZE + CELL_SIZE / 2,
  };
}

/** 16-bit BaK angle → radians. */
export const angleToRadians = (a: number) => (a / 65536) * Math.PI * 2;
/** 8-bit BaK heading → radians (counter-clockwise from north). */
export const headingToRadians = (h: number) => (h / 256) * Math.PI * 2;
