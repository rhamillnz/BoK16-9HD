import type { ChapterStart } from '../formats/world';
import { landsOnZoneTile } from './transitions';

/**
 * Report a chapter start whose tile is not part of its zone, with the raw record, so a bad start shows in the
 * console instead of as a black void (the position is tile * 64000 + cell * 1600 + 800, see parseChapterStart).
 * Returns whether the start is on the map.
 */
export function warnIfOffMap(
  c: ChapterStart,
  tiles: readonly (readonly [number, number])[],
  teleport: number | undefined,
): boolean {
  if (landsOnZoneTile(tiles, c)) return true;
  console.warn(
    `chapter ${c.chapter} start is off the map: zone ${c.zone} tile ${c.tileX},${c.tileY} cell ${c.cellX},${c.cellY} -> ${c.x},${c.y}` +
      (teleport === undefined ? '' : `; start script teleport ${teleport}`),
  );
  return false;
}
