import { TILE_SIZE } from '../formats/world';
import { MAP_GRID } from '../formats/zoneMap';

/** Compass and map coordinate maths. BaK x is east, y is north; headings are 8-bit and turn counter-clockwise (0 = north, 64 = west). */

export const COMPASS_POINTS = ['N', 'NW', 'W', 'SW', 'S', 'SE', 'E', 'NE'] as const;
export type CompassPoint = (typeof COMPASS_POINTS)[number];

/** Nearest of the eight compass points for an 8-bit heading. */
export function compassPoint(heading: number): CompassPoint {
  const i = Math.round((((heading % 256) + 256) % 256) / 32) % 8;
  return COMPASS_POINTS[i]!;
}

/** Screen angle in radians, clockwise from straight up, at which a world direction appears on a compass that keeps the party's facing at the top. */
export function compassAngle(partyHeading: number, directionHeading: number): number {
  return ((partyHeading - directionHeading) / 256) * Math.PI * 2;
}

/** World position in tile units (1 = one tile). */
export const worldToTile = (v: number): number => v / TILE_SIZE;

export interface TileBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Bounding box of tiles, padded by `margin` tiles and clamped to the 50x50 grid. Empty input shows the whole grid. */
export function tileBounds(tiles: readonly (readonly [number, number])[], margin = 0): TileBounds {
  if (tiles.length === 0) return { minX: 0, minY: 0, maxX: MAP_GRID - 1, maxY: MAP_GRID - 1 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of tiles) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return {
    minX: Math.max(0, minX - margin),
    minY: Math.max(0, minY - margin),
    maxX: Math.min(MAP_GRID - 1, maxX + margin),
    maxY: Math.min(MAP_GRID - 1, maxY + margin),
  };
}

export interface MapViewport {
  bounds: TileBounds;
  /** Pixels per tile (integer so tile edges stay crisp). */
  cell: number;
  /** Screen position of the bounds' west edge and north edge. */
  originX: number;
  originY: number;
}

/** Fit the bounds into `area` (centred) at the largest integer pixels-per-tile. */
export function fitViewport(bounds: TileBounds, area: { x: number; y: number; width: number; height: number }): MapViewport {
  const cols = bounds.maxX - bounds.minX + 1;
  const rows = bounds.maxY - bounds.minY + 1;
  const cell = Math.max(1, Math.floor(Math.min(area.width / cols, area.height / rows)));
  return {
    bounds,
    cell,
    originX: Math.floor(area.x + (area.width - cols * cell) / 2),
    originY: Math.floor(area.y + (area.height - rows * cell) / 2),
  };
}

/** Screen position of a world coordinate (north is up, so tile y grows upward). */
export function worldToMap(v: MapViewport, x: number, y: number): { x: number; y: number } {
  const rows = v.bounds.maxY - v.bounds.minY + 1;
  return {
    x: v.originX + (worldToTile(x) - v.bounds.minX) * v.cell,
    y: v.originY + (rows - (worldToTile(y) - v.bounds.minY)) * v.cell,
  };
}

/** Top-left screen corner of tile (tx, ty). */
export function tileRect(v: MapViewport, tx: number, ty: number): { x: number; y: number; size: number } {
  const p = worldToMap(v, tx * TILE_SIZE, (ty + 1) * TILE_SIZE);
  return { x: p.x, y: p.y, size: v.cell };
}

/** Unit direction on the map (screen y down) of an 8-bit heading. */
export function headingToMapDir(heading: number): { x: number; y: number } {
  const a = (heading / 256) * Math.PI * 2;
  return { x: -Math.sin(a), y: -Math.cos(a) };
}

/** True when the world position lies inside the viewport's tile bounds. */
export function insideBounds(b: TileBounds, x: number, y: number): boolean {
  const tx = worldToTile(x), ty = worldToTile(y);
  return tx >= b.minX && tx < b.maxX + 1 && ty >= b.minY && ty < b.maxY + 1;
}
