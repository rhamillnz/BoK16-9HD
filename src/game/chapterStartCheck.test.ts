import { afterEach, describe, expect, it, vi } from 'vitest';
import { CELL_SIZE, TILE_SIZE, type ChapterStart } from '../formats/world';
import { warnIfOffMap } from './chapterStartCheck';

const start = (
  chapter: number,
  zone: number,
  tileX: number,
  tileY: number,
  cellX: number,
  cellY: number,
): ChapterStart => ({
  chapter,
  zone,
  tileX,
  tileY,
  cellX,
  cellY,
  heading: 0,
  timeElapsed: 0,
  x: tileX * TILE_SIZE + cellX * CELL_SIZE + CELL_SIZE / 2,
  y: tileY * TILE_SIZE + cellY * CELL_SIZE + CELL_SIZE / 2,
});

afterEach(() => vi.restoreAllMocks());

describe('warnIfOffMap', () => {
  const tiles = [
    [6, 7],
    [6, 8],
  ] as const;

  it('accepts a start on one of the zone tiles, for every chapter', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let chapter = 1; chapter <= 9; chapter++)
      expect(warnIfOffMap(start(chapter, 1, 6, 8, 3, 4), tiles, undefined)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns with the raw record when the tile is not in the zone', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(warnIfOffMap(start(2, 11, 0, 0, 8, 8), tiles, 5)).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]![0])).toContain('chapter 2 start is off the map: zone 11 tile 0,0 cell 8,8');
    expect(String(warn.mock.calls[0]![0])).toContain('teleport 5');
  });
});
