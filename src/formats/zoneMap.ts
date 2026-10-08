import type { ResourceArchive } from './archive';
import { zonePrefix } from './tbl';

/** ZxxMAP.DAT: a 50x50 tile bitmask of the tiles that belong on the zone map (docs/formats/zones-and-models.md 3.4). */
export const MAP_GRID = 50;
export const ZONE_MAP_BYTES = 400;

export interface ZoneMap {
  bytes: Uint8Array;
}

export function parseZoneMap(bytes: Uint8Array): ZoneMap {
  if (bytes.length < ZONE_MAP_BYTES) throw new Error(`zone map: expected ${ZONE_MAP_BYTES} bytes, got ${bytes.length}`);
  return { bytes: bytes.subarray(0, ZONE_MAP_BYTES) };
}

/**
 * True when tile (x, y), both 0..49, is marked present. The mask is 8 bytes per tile row y, bit
 * (x & 7) of byte (x >> 3): checked against every zone's REF tile list, which it matches exactly.
 */
export function isTilePresent(map: ZoneMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= MAP_GRID || y >= MAP_GRID) return false;
  return (map.bytes[(y << 3) + (x >> 3)]! & (1 << (x & 7))) !== 0;
}

/** Every present tile as [x, y], x-major. */
export function presentTiles(map: ZoneMap): [number, number][] {
  const out: [number, number][] = [];
  for (let x = 0; x < MAP_GRID; x++) for (let y = 0; y < MAP_GRID; y++) if (isTilePresent(map, x, y)) out.push([x, y]);
  return out;
}

/** Build a bitmask from tile coordinates (the inverse of `presentTiles`; used by tests and as a fallback). */
export function zoneMapFromTiles(tiles: readonly (readonly [number, number])[]): ZoneMap {
  const bytes = new Uint8Array(ZONE_MAP_BYTES);
  for (const [x, y] of tiles) {
    if (x < 0 || y < 0 || x >= MAP_GRID || y >= MAP_GRID) continue;
    bytes[(y << 3) + (x >> 3)]! |= 1 << (x & 7);
  }
  return { bytes };
}

/** The zone's map from ZxxMAP.DAT, or built from the zone's tile list when the file is missing. */
export function loadZoneMap(
  archive: ResourceArchive,
  zone: number,
  tiles: readonly (readonly [number, number])[],
): ZoneMap {
  const name = `${zonePrefix(zone)}MAP.DAT`;
  return archive.has(name) ? parseZoneMap(archive.get(name)) : zoneMapFromTiles(tiles);
}
