import { describe, expect, it } from 'vitest';
import { COMBAT_GRID_COLS, COMBAT_GRID_ROWS, COMBAT_CELL_SIZE } from './grid';
import { cameraSeesGrid, cliffCells, fitCombatGrid } from './gridFit';
import { gridPointToWorld } from './layout';

const party = { x: 100000, y: 100000 };
const flat = () => 0;

/** A rock face: the ground jumps by 2000 units beyond `edge` (world y, going north). */
const cliffNorthOf = (edge: number) => (_x: number, y: number) => (y > edge ? 2000 : 0);

describe('fitCombatGrid', () => {
  it('leaves the grid alone on flat ground', () => {
    const fit = fitCombatGrid(party, 0, COMBAT_GRID_COLS, COMBAT_GRID_ROWS, flat);
    expect(fit).toEqual({ anchor: party, heading: 0, disabled: [] });
  });

  it('slides the grid back when the party faces a cliff, so every cell is on level ground', () => {
    // The cliff crosses the far rows of the grid when facing north.
    const edge = party.y + 3200 + 9.5 * COMBAT_CELL_SIZE;
    const ground = cliffNorthOf(edge);
    expect(cliffCells(party, 0, COMBAT_GRID_COLS, COMBAT_GRID_ROWS, ground).length).toBeGreaterThan(0);
    const fit = fitCombatGrid(party, 0, COMBAT_GRID_COLS, COMBAT_GRID_ROWS, ground);
    expect(fit.disabled).toEqual([]);
    expect(fit.anchor.y).toBeLessThan(party.y);
    expect(fit.anchor.x).toBeCloseTo(party.x);
    expect(cliffCells(fit.anchor, 0, COMBAT_GRID_COLS, COMBAT_GRID_ROWS, ground)).toEqual([]);
  });

  it('slides along the facing direction whichever way the party looks', () => {
    // Facing south (heading 128) with the cliff to the south.
    const edge = party.y - 3200 - 9.5 * COMBAT_CELL_SIZE;
    const ground = (_x: number, y: number) => (y < edge ? 2000 : 0);
    const fit = fitCombatGrid(party, 128, COMBAT_GRID_COLS, COMBAT_GRID_ROWS, ground);
    expect(fit.disabled).toEqual([]);
    expect(fit.anchor.y).toBeGreaterThan(party.y);
  });

  it('treats cells inside a solid model as cliffs, since the height field leaves hills out', () => {
    // A hill's collision outline covers the far rows; the ground under it reads as flat.
    const far = gridPointToWorld(party, 0, 0, 9).y;
    const blocked = (_x: number, y: number) => y > far;
    expect(cliffCells(party, 0, COMBAT_GRID_COLS, COMBAT_GRID_ROWS, flat).length).toBe(0);
    expect(cliffCells(party, 0, COMBAT_GRID_COLS, COMBAT_GRID_ROWS, flat, blocked).length).toBeGreaterThan(0);
    const fit = fitCombatGrid(party, 0, COMBAT_GRID_COLS, COMBAT_GRID_ROWS, flat, blocked);
    expect(fit.disabled).toEqual([]);
    expect(fit.anchor.y).toBeLessThan(party.y);
  });

  it('disables only the cliff cells when no slide clears them', () => {
    // One spike under a single cell, wider than any slide can avoid.
    const spike = gridPointToWorld(party, 0, 3.5, 5.5);
    const ground = (x: number, y: number) => (Math.abs(x - spike.x) < 100 && Math.abs(y - spike.y) < 100 ? 3000 : 0);
    const fit = fitCombatGrid(party, 0, COMBAT_GRID_COLS, COMBAT_GRID_ROWS, ground);
    // Sliding never moves the grid off the spike; turning it may. Either way only a cell or so is lost.
    expect(fit.disabled.length).toBeLessThanOrEqual(5);
  });

  it('turns the grid away from a hill that fills the way the party faces', () => {
    // A hill model covers everything north of the party: no slide back clears the far rows, a turn does.
    const surface = (_x: number, y: number) => (y > party.y + 1000 ? 2500 : 0);
    const fit = fitCombatGrid(party, 0, COMBAT_GRID_COLS, COMBAT_GRID_ROWS, flat, { surface });
    expect(fit.disabled).toEqual([]);
    expect(fit.heading).not.toBe(0);
    expect(cameraSeesGrid(fit.anchor, fit.heading, COMBAT_GRID_COLS, COMBAT_GRID_ROWS, flat, surface)).toBe(true);
  });

  it('keeps the camera out of a hill behind the party', () => {
    // A ridge running east-west under the camera, between the party and the grid.
    const ridge = (y: number) => y > party.y + 1300 && y < party.y + 1800;
    const surface = (_x: number, y: number) => (ridge(y) ? 4000 : 0);
    expect(cameraSeesGrid(party, 0, COMBAT_GRID_COLS, COMBAT_GRID_ROWS, flat, surface)).toBe(false);
    const fit = fitCombatGrid(party, 0, COMBAT_GRID_COLS, COMBAT_GRID_ROWS, flat, { surface });
    expect(fit.disabled).toEqual([]);
    expect(cameraSeesGrid(fit.anchor, fit.heading, COMBAT_GRID_COLS, COMBAT_GRID_ROWS, flat, surface)).toBe(true);
  });
});
