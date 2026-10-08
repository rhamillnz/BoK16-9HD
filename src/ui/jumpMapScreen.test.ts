import { describe, expect, it } from 'vitest';
import {
  layoutZoneButtons,
  zoneButtonAtClick,
  tileAtClick,
  destinationFromTile,
} from './jumpMapScreen';
import { type MapViewport } from './mapMath';
import { TILE_SIZE } from '../formats/world';

describe('jumpMapScreen pure logic', () => {
  describe('layoutZoneButtons', () => {
    it('creates 12 buttons across the width', () => {
      const buttons = layoutZoneButtons(640, 360);
      expect(buttons).toHaveLength(12);
    });

    it('lays out buttons horizontally with spacing', () => {
      const buttons = layoutZoneButtons(640, 360);
      for (let i = 1; i < buttons.length; i++) {
        const prev = buttons[i - 1]!;
        const curr = buttons[i]!;
        expect(curr.x).toBeGreaterThan(prev.x);
        expect(curr.y).toBe(prev.y); // same row
      }
    });

    it('fits buttons within width margins', () => {
      const buttons = layoutZoneButtons(640, 360);
      const sideMargin = 12;
      expect(buttons[0]!.x).toBeGreaterThanOrEqual(sideMargin);
      const lastBtn = buttons[11]!;
      expect(lastBtn.x + lastBtn.width).toBeLessThanOrEqual(640 - sideMargin);
    });

    it('all buttons have consistent height', () => {
      const buttons = layoutZoneButtons(640, 360);
      const height = buttons[0]!.height;
      for (const btn of buttons) {
        expect(btn.height).toBe(height);
      }
    });
  });

  describe('zoneButtonAtClick', () => {
    it('returns undefined for click outside buttons', () => {
      const buttons = layoutZoneButtons(640, 360);
      expect(zoneButtonAtClick(buttons, 0, 0)).toBeUndefined();
      expect(zoneButtonAtClick(buttons, 640, 360)).toBeUndefined();
    });

    it('returns correct zone number for each button', () => {
      const buttons = layoutZoneButtons(640, 360);
      for (let i = 0; i < buttons.length; i++) {
        const btn = buttons[i]!;
        const zone = zoneButtonAtClick(buttons, btn.x + btn.width / 2, btn.y + btn.height / 2);
        expect(zone).toBe(i + 1);
      }
    });

    it('returns undefined for click below buttons', () => {
      const buttons = layoutZoneButtons(640, 360);
      const belowY = buttons[0]!.y + buttons[0]!.height + 10;
      expect(zoneButtonAtClick(buttons, buttons[0]!.x + buttons[0]!.width / 2, belowY)).toBeUndefined();
    });
  });

  describe('tileAtClick', () => {
    it('maps viewport click to tile coordinates', () => {
      const viewport: MapViewport = {
        bounds: { minX: 0, minY: 0, maxX: 9, maxY: 9 },
        cell: 32, // 32 pixels per tile
        originX: 0,
        originY: 0,
      };

      // Click at the centre of tile (0, 9)
      const tile = tileAtClick(viewport, 0, 0);
      expect(tile).toEqual([0, 9]);

      // Click at the centre of tile (5, 5)
      const tile2 = tileAtClick(viewport, 5 * 32 + 16, 4 * 32 + 16);
      expect(tile2).toEqual([5, 5]);
    });

    it('returns undefined for click outside viewport', () => {
      const viewport: MapViewport = {
        bounds: { minX: 0, minY: 0, maxX: 9, maxY: 9 },
        cell: 32,
        originX: 100,
        originY: 100,
      };

      expect(tileAtClick(viewport, 0, 0)).toBeUndefined();
      expect(tileAtClick(viewport, 500, 500)).toBeUndefined();
    });

    it('handles offset viewport bounds', () => {
      const viewport: MapViewport = {
        bounds: { minX: 10, minY: 10, maxX: 19, maxY: 19 },
        cell: 32,
        originX: 0,
        originY: 0,
      };

      // Click at origin should map to tile (10, 19)
      const tile = tileAtClick(viewport, 0, 0);
      expect(tile).toEqual([10, 19]);
    });
  });

  describe('destinationFromTile', () => {
    it('places tile at its centre in BaK units', () => {
      const dest = destinationFromTile(5, 2, 3);
      expect(dest.zone).toBe(5);
      expect(dest.tileX).toBe(2);
      expect(dest.tileY).toBe(3);
      expect(dest.x).toBe((2 + 0.5) * TILE_SIZE);
      expect(dest.y).toBe((3 + 0.5) * TILE_SIZE);
    });

    it('sets heading to north (0)', () => {
      const dest = destinationFromTile(1, 0, 0);
      expect(dest.heading).toBe(0);
    });

    it('handles edge tile coordinates', () => {
      const dest = destinationFromTile(1, 49, 49); // max tile (0-indexed)
      expect(dest.x).toBe((49 + 0.5) * TILE_SIZE);
      expect(dest.y).toBe((49 + 0.5) * TILE_SIZE);
    });

    it('handles zone 1 and zone 12', () => {
      const dest1 = destinationFromTile(1, 5, 5);
      expect(dest1.zone).toBe(1);

      const dest12 = destinationFromTile(12, 5, 5);
      expect(dest12.zone).toBe(12);
    });
  });
});
