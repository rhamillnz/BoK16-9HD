/**
 * Keeps the combat grid on ground a fighter can stand on. The grid is laid out from the party's position
 * and heading, so facing a hill can put some of its cells on a rock face. The grid is slid (back towards
 * the party or sideways) to the place with the fewest such cells; any that remain are disabled, so no
 * fighter is placed there and nobody can walk onto them. Pure; the caller supplies the ground height.
 */

import { COMBAT_CELL_SIZE, snapHeading, type GridPos } from './grid';
import { gridPointToWorld, type Point } from './layout';

/** A cell is a cliff when the ground beside it rises or falls by more than this over one cell (about 59 degrees). */
export const CLIFF_STEP = 500;
/** Furthest the grid may slide, in cells: sideways either way, and back towards the party. */
const MAX_SIDEWAYS = 2;
const MAX_BACK = 4;

export interface FittedGrid {
  /** Where the grid is anchored; the party's own position when no slide was needed. */
  anchor: Point;
  /** Cells left on cliffs after sliding. */
  disabled: GridPos[];
}

/** The cells of a grid anchored at `anchor` that stand on a cliff. */
export function cliffCells(
  anchor: Point,
  heading: number,
  cols: number,
  rows: number,
  getHeight: (x: number, y: number) => number,
): GridPos[] {
  // A neighbour is one cell away in world axes; the grid is turned by whole quarter turns, so this matches.
  const step = COMBAT_CELL_SIZE;
  const out: GridPos[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const c = gridPointToWorld(anchor, heading, x + 0.5, y + 0.5);
      const h = getHeight(c.x, c.y);
      const steep = [
        [step, 0],
        [-step, 0],
        [0, step],
        [0, -step],
      ].some(([dx, dy]) => Math.abs(getHeight(c.x + dx!, c.y + dy!) - h) > CLIFF_STEP);
      if (steep) out.push({ x, y });
    }
  }
  return out;
}

export function fitCombatGrid(
  party: Point,
  heading: number,
  cols: number,
  rows: number,
  getHeight: (x: number, y: number) => number,
): FittedGrid {
  const here = cliffCells(party, heading, cols, rows, getHeight);
  if (here.length === 0) return { anchor: party, disabled: [] };

  const snapped = snapHeading(heading);
  const turn = (snapped * 2 * Math.PI) / 256;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  let best: FittedGrid = { anchor: party, disabled: here };
  let bestCost = here.length;
  let bestDistance = 0;
  for (let back = 0; back <= MAX_BACK; back++) {
    for (let side = -MAX_SIDEWAYS; side <= MAX_SIDEWAYS; side++) {
      if (back === 0 && side === 0) continue;
      // Grid-local (east, north) shift turned into world axes.
      const lx = side * COMBAT_CELL_SIZE;
      const ly = -back * COMBAT_CELL_SIZE;
      const anchor = { x: party.x + lx * cos - ly * sin, y: party.y + lx * sin + ly * cos };
      const disabled = cliffCells(anchor, heading, cols, rows, getHeight);
      const distance = back + Math.abs(side);
      if (disabled.length < bestCost || (disabled.length === bestCost && distance < bestDistance)) {
        best = { anchor, disabled };
        bestCost = disabled.length;
        bestDistance = distance;
      }
    }
  }
  return best;
}
