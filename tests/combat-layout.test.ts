import { describe, expect, it } from 'vitest';
import { COMBAT_GRID_COLS, COMBAT_GRID_ROWS, gridCellToWorld } from '../src/combat/grid';
import { cameraPlan, gridPointToWorld, worldToGridCell, worldToGridPoint } from '../src/combat/layout';

const party = { x: 123456, y: 98765 };

describe('combat grid layout', () => {
  it('agrees with gridCellToWorld at cell centres for every quarter-turn heading', () => {
    for (const heading of [0, 64, 128, 192, 10, 100]) {
      for (const cell of [
        { x: 0, y: 0 },
        { x: 7, y: 12 },
        { x: 3, y: 5 },
      ]) {
        const exact = gridCellToWorld(party, heading, cell);
        const p = gridPointToWorld(party, heading, cell.x + 0.5, cell.y + 0.5);
        expect(Math.abs(p.x - exact.x)).toBeLessThanOrEqual(2);
        expect(Math.abs(p.y - exact.y)).toBeLessThanOrEqual(2);
      }
    }
  });

  it('worldToGridPoint inverts gridPointToWorld', () => {
    for (const heading of [0, 64, 128, 192]) {
      const w = gridPointToWorld(party, heading, 2.25, 9.75);
      const g = worldToGridPoint(party, heading, w);
      expect(g.x).toBeCloseTo(2.25, 6);
      expect(g.y).toBeCloseTo(9.75, 6);
    }
  });

  it('picks the cell under a world point and rejects points outside the grid', () => {
    const centre = gridCellToWorld(party, 64, { x: 4, y: 6 });
    expect(worldToGridCell(party, 64, centre, COMBAT_GRID_COLS, COMBAT_GRID_ROWS)).toEqual({ x: 4, y: 6 });
    const outside = gridPointToWorld(party, 64, -0.5, 3);
    expect(worldToGridCell(party, 64, outside, COMBAT_GRID_COLS, COMBAT_GRID_ROWS)).toBeUndefined();
    const far = gridPointToWorld(party, 64, 3, COMBAT_GRID_ROWS + 0.1);
    expect(worldToGridCell(party, 64, far, COMBAT_GRID_COLS, COMBAT_GRID_ROWS)).toBeUndefined();
  });

  it('faces the grid north with the party at heading 0: the grid lies ahead (north) of the party', () => {
    const c = gridCellToWorld(party, 0, { x: 3, y: 6 });
    expect(c.y).toBeGreaterThan(party.y);
    // Heading 128 turns it around.
    expect(gridCellToWorld(party, 128, { x: 3, y: 6 }).y).toBeLessThan(party.y);
  });

  it('puts the camera behind the near edge, looking toward the far side', () => {
    const plan = cameraPlan(party, 0, COMBAT_GRID_COLS, COMBAT_GRID_ROWS);
    expect(plan.target.y).toBeGreaterThan(plan.eye.y);
    expect(plan.height).toBeGreaterThan(0);
    const turned = cameraPlan(party, 128, COMBAT_GRID_COLS, COMBAT_GRID_ROWS);
    expect(turned.target.y).toBeLessThan(turned.eye.y);
  });
});
