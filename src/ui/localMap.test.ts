import { describe, expect, it } from 'vitest';
import { cellsAround, fullMapSpot } from '../game/mapControls';
import { CITIES, fullMapRect, mapTransform, townAt } from './localMap';

const area = { x: 0, y: 0, width: 400, height: 400 };

describe('local map (manual p. 20)', () => {
  it('centres on the party, north up', () => {
    const t = mapTransform({ x: 1000, y: 1000, heading: 0 }, true, area, 4);
    expect(t.toScreen(1000, 1000)).toEqual({ x: 200, y: 200 });
    // North is up the screen, east to the right.
    expect(t.toScreen(1000, 2000).y).toBeLessThan(200);
    expect(t.toScreen(2000, 1000).x).toBeGreaterThan(200);
    const back = t.toWorld(250, 120);
    const again = t.toScreen(back.x, back.y);
    expect(again.x).toBeCloseTo(250);
    expect(again.y).toBeCloseTo(120);
  });

  it('turns with the party: what it faces is up', () => {
    // Heading 64 faces west (counter-clockwise from north).
    const t = mapTransform({ x: 0, y: 0, heading: 64 }, false, area, 4);
    const west = t.toScreen(-1000, 0);
    expect(west.x).toBeCloseTo(200);
    expect(west.y).toBeLessThan(200);
  });

  it('reveals the cells around the party underground', () => {
    const cells = cellsAround(1600 * 3 + 10, 1600 * 5 + 10, 1);
    expect(cells).toHaveLength(9);
    expect(cells).toContain('3,5');
    expect(cells).toContain('2,4');
  });
});

describe('full map (manual p. 21)', () => {
  it("finds the party's place from its tile", () => {
    const xy = [
      {
        zone: 1,
        tiles: [
          { x: 116, y: 75 },
          { x: 115, y: 82 },
        ],
      },
    ];
    expect(
      fullMapSpot(
        1,
        [
          [10, 16],
          [11, 16],
        ],
        xy,
        11 * 64000 + 5,
        16 * 64000 + 5,
      ),
    ).toEqual({ x: 115, y: 82 });
    expect(fullMapSpot(1, [[10, 16]], xy, 0, 0)).toBeUndefined();
  });

  it('names the town under the pointer; cities are marked apart', () => {
    const full = { image: { width: 320, height: 200 } as never, towns: [{ name: 'Krondor', type: 8, x: 167, y: 147 }] };
    const r = fullMapRect({ x: 0, y: 0, width: 640, height: 480 }, full.image, 1);
    const k = r.width / 320;
    expect(townAt(full, r, r.x + 167 * k + 2, r.y + 147 * k, 8)?.name).toBe('Krondor');
    expect(townAt(full, r, r.x, r.y, 8)).toBeUndefined();
    expect(CITIES.has('Krondor')).toBe(true);
    expect(CITIES.has('Zun')).toBe(false);
  });
});
