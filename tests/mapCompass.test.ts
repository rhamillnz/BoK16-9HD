import { describe, expect, it } from 'vitest';
import {
  MAP_GRID,
  ZONE_MAP_BYTES,
  isTilePresent,
  parseZoneMap,
  presentTiles,
  zoneMapFromTiles,
} from '../src/formats/zoneMap';
import { TILE_SIZE } from '../src/formats/world';
import {
  compassAngle,
  compassPoint,
  fitViewport,
  headingToMapDir,
  insideBounds,
  tileBounds,
  tileRect,
  worldToMap,
  worldToTile,
} from '../src/ui/mapMath';
import { layoutMap } from '../src/ui/mapScreen';
import { HudScreens } from '../src/ui/hud';
import type { Font, Glyph } from '../src/formats/fnt';
import type { GamSave } from '../src/formats/gam';

describe('zone map bitmask', () => {
  it('uses byte (x<<3)+(y>>3) and bit y&7', () => {
    const bytes = new Uint8Array(ZONE_MAP_BYTES);
    bytes[(6 << 3) + 0] = 1 << 7; // x=6, y=7
    bytes[(49 << 3) + 6] = 1 << 1; // x=49, y=49
    const map = parseZoneMap(bytes);
    expect(isTilePresent(map, 6, 7)).toBe(true);
    expect(isTilePresent(map, 7, 6)).toBe(false);
    expect(isTilePresent(map, 49, 49)).toBe(true);
    expect(presentTiles(map)).toEqual([
      [6, 7],
      [49, 49],
    ]);
    expect(isTilePresent(map, -1, 0)).toBe(false);
    expect(isTilePresent(map, MAP_GRID, 0)).toBe(false);
  });
  it('round-trips and rejects short data', () => {
    const tiles: [number, number][] = [
      [0, 0],
      [3, 9],
      [12, 40],
    ];
    expect(presentTiles(zoneMapFromTiles(tiles))).toEqual(tiles);
    expect(() => parseZoneMap(new Uint8Array(10))).toThrow();
  });
});

describe('compass maths', () => {
  it('names the eight points counter-clockwise from north', () => {
    expect([0, 32, 64, 96, 128, 160, 192, 224, 255].map(compassPoint)).toEqual([
      'N',
      'NW',
      'W',
      'SW',
      'S',
      'SE',
      'E',
      'NE',
      'N',
    ]);
    expect(compassPoint(-64)).toBe('E');
  });
  it('puts north to the right when facing west', () => {
    expect(compassAngle(0, 0)).toBeCloseTo(0);
    expect(compassAngle(64, 0)).toBeCloseTo(Math.PI / 2);
    expect(compassAngle(128, 128)).toBeCloseTo(0);
  });
});

describe('map coordinates', () => {
  const v = fitViewport({ minX: 5, minY: 6, maxX: 8, maxY: 9 }, { x: 100, y: 50, width: 400, height: 400 });
  it('fits at an integer scale and centres', () => {
    expect(v.cell).toBe(100);
    expect(v.originX).toBe(100);
    expect(v.originY).toBe(50);
  });
  it('draws north up', () => {
    const sw = worldToMap(v, 5 * TILE_SIZE, 6 * TILE_SIZE);
    const ne = worldToMap(v, 9 * TILE_SIZE, 10 * TILE_SIZE);
    expect(sw).toEqual({ x: 100, y: 450 });
    expect(ne).toEqual({ x: 500, y: 50 });
    expect(worldToMap(v, 6.5 * TILE_SIZE, 7.5 * TILE_SIZE)).toEqual({ x: 250, y: 300 });
  });
  it('places a tile rect by its north-west corner', () => {
    expect(tileRect(v, 5, 9)).toEqual({ x: 100, y: 50, size: 100 });
    expect(tileRect(v, 8, 6)).toEqual({ x: 400, y: 350, size: 100 });
  });
  it('points the arrow along the heading on screen', () => {
    const n = headingToMapDir(0),
      w = headingToMapDir(64),
      e = headingToMapDir(192);
    expect(n.x).toBeCloseTo(0);
    expect(n.y).toBeCloseTo(-1);
    expect(w.x).toBeCloseTo(-1);
    expect(w.y).toBeCloseTo(0);
    expect(e.x).toBeCloseTo(1);
  });
  it('pads and clamps bounds', () => {
    expect(
      tileBounds(
        [
          [0, 0],
          [3, 4],
        ],
        1,
      ),
    ).toEqual({ minX: 0, minY: 0, maxX: 4, maxY: 5 });
    expect(tileBounds([])).toEqual({ minX: 0, minY: 0, maxX: 49, maxY: 49 });
    expect(insideBounds({ minX: 1, minY: 1, maxX: 2, maxY: 2 }, 3 * TILE_SIZE - 1, 1.5 * TILE_SIZE)).toBe(true);
    expect(insideBounds({ minX: 1, minY: 1, maxX: 2, maxY: 2 }, 3 * TILE_SIZE, 1.5 * TILE_SIZE)).toBe(false);
    expect(worldToTile(TILE_SIZE * 2.5)).toBe(2.5);
  });
});

describe('map screen', () => {
  const glyphs: Glyph[] = [];
  for (let c = 32; c < 127; c++) glyphs.push({ code: c, width: 4, height: 6, pixels: new Uint8Array(24).fill(1) });
  const font: Font = { version: 0xff, maxWidth: 4, height: 6, baseline: 5, firstChar: 32, glyphs };
  const save = { characters: [], activeCharacters: [] } as unknown as GamSave;
  it('Tab opens and closes the map only once a map is set, blocking movement', () => {
    const h = new HudScreens({ font, save, items: [] });
    expect(h.keyDown('Tab', 'Tab')).toBe(true);
    expect(h.screen).toBe('none');
    h.setMap(
      zoneMapFromTiles([
        [6, 7],
        [7, 7],
      ]),
      1,
    );
    h.keyDown('Tab', 'Tab');
    expect(h.screen).toBe('map');
    expect(h.blocking).toBe(true);
    h.keyDown('Tab', 'Tab');
    expect(h.screen).toBe('none');
    h.keyDown('Tab', 'Tab');
    h.keyDown('Escape', 'Escape');
    expect(h.screen).toBe('none');
  });
  it('lays the viewport around the present tiles', () => {
    const l = layoutMap(
      zoneMapFromTiles([
        [6, 7],
        [7, 7],
      ]),
    );
    expect(l.viewport.bounds).toEqual({ minX: 5, minY: 6, maxX: 8, maxY: 8 });
    expect(l.tiles).toHaveLength(2);
  });
  it('marks the HUD dirty when the heading changes', () => {
    const h = new HudScreens({ font, save, items: [] });
    h.dirty = false;
    h.setPose({ x: 1, y: 1, heading: 0.5 });
    expect(h.dirty).toBe(false);
    h.setPose({ x: 1, y: 1, heading: 3 });
    expect(h.dirty).toBe(true);
  });
});
