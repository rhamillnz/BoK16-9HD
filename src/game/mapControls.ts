import type { ResourceArchive } from '../formats/archive';
import { toRGBA } from '../formats/bmx';
import { parseFMapTowns, parseFMapXY, type ZoneTiles } from '../formats/fullMap';
import { parsePalette } from '../formats/palette';
import { parseSCX } from '../formats/scx';
import { CELL_SIZE, TILE_SIZE } from '../formats/world';
import { roadMask } from '../render/grassGround';
import type { FullMap, MapExtras } from '../ui/localMap';
import { isUndergroundZone } from '../world/underground';
import type { ZoneData } from '../world/zone';
import { registerSaveExtra } from './saveExtras';

/**
 * Feeds the map screen (Tab) what the manual's map shows besides the zone's tiles: its roads, the explored
 * part of a dungeon, mine or sewer (dark until the party has been there, remembered in the save), and the full
 * map of the kingdom with the party's place on it.
 */

/** How far around the party a dungeon is revealed, in cells. */
export const REVEAL_CELLS = 2;

/** Cells (CELL_SIZE squares) within `reach` cells of (x, y), as "cx,cy" keys. */
export function cellsAround(x: number, y: number, reach = REVEAL_CELLS): string[] {
  const cx = Math.floor(x / CELL_SIZE);
  const cy = Math.floor(y / CELL_SIZE);
  const out: string[] = [];
  for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) out.push(`${cx + dx},${cy + dy}`);
  return out;
}

/** Where the party stands on the full map: its tile looked up in the zone's FMAP_XY list (same order as its tiles). */
export function fullMapSpot(
  zone: number,
  tiles: readonly (readonly [number, number])[],
  xy: readonly ZoneTiles[],
  x: number,
  y: number,
): { x: number; y: number } | undefined {
  const tx = Math.floor(x / TILE_SIZE);
  const ty = Math.floor(y / TILE_SIZE);
  const i = tiles.findIndex(([a, b]) => a === tx && b === ty);
  return i < 0 ? undefined : xy.find((z) => z.zone === zone)?.tiles[i];
}

export interface MapHost {
  archive: ResourceArchive;
  setExtras(extras: MapExtras): void;
}

export function installMapExtras(host: MapHost): {
  zoneChanged(zone: number, data: ZoneData): void;
  moved(x: number, y: number): void;
} {
  const explored = new Map<number, Set<string>>();
  registerSaveExtra('explored', {
    capture: () => Object.fromEntries([...explored].map(([z, s]) => [z, [...s]])),
    restore: (data) => {
      explored.clear();
      if (data && typeof data === 'object')
        for (const [z, keys] of Object.entries(data as Record<string, unknown>))
          if (Array.isArray(keys))
            explored.set(Number(z), new Set(keys.filter((k): k is string => typeof k === 'string')));
    },
  });

  let full: FullMap | undefined;
  let xy: ZoneTiles[] = [];
  try {
    const img = parseSCX(host.archive.get('FULLMAP.SCX'));
    const rgba = toRGBA(img, parsePalette(host.archive.get('FULLMAP.PAL')));
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext('2d')!.putImageData(new ImageData(rgba, img.width, img.height), 0, 0);
    xy = parseFMapXY(host.archive.get('FMAP_XY.DAT'));
    full = { image: canvas, towns: parseFMapTowns(host.archive.get('FMAP_TWN.DAT')) };
  } catch (err) {
    console.warn('Full map unavailable:', err);
  }

  let zone = 0;
  let data: ZoneData | undefined;
  let lastCell = '';
  let lastTile = '';
  return {
    zoneChanged(z, d) {
      zone = z;
      data = d;
      lastCell = '';
      lastTile = '';
      const seen = explored.get(z) ?? new Set<string>();
      explored.set(z, seen);
      host.setExtras({
        roads: roadMask(d),
        explored: isUndergroundZone(z)
          ? (x, y) => seen.has(`${Math.floor(x / CELL_SIZE)},${Math.floor(y / CELL_SIZE)}`)
          : undefined,
        ...(full ? { full } : {}),
      });
    },
    moved(x, y) {
      if (!data) return;
      const cell = `${Math.floor(x / CELL_SIZE)},${Math.floor(y / CELL_SIZE)}`;
      if (cell !== lastCell && isUndergroundZone(zone)) {
        lastCell = cell;
        const seen = explored.get(zone)!;
        for (const k of cellsAround(x, y)) seen.add(k);
      }
      const tile = `${Math.floor(x / TILE_SIZE)},${Math.floor(y / TILE_SIZE)}`;
      if (full && tile !== lastTile) {
        lastTile = tile;
        full = { ...full, party: fullMapSpot(zone, data.tiles, xy, x, y) };
        host.setExtras({ full });
      }
    },
  };
}
