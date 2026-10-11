/**
 * Keeps the combat grid on ground a fighter can stand on. The grid is laid out from the party's position
 * and heading, so facing a hill can put some of its cells on a rock face. The grid is slid (back towards
 * the party or sideways) to the place with the fewest such cells; any that remain are disabled, so no
 * fighter is placed there and nobody can walk onto them. Pure; the caller supplies the ground height.
 */

import { COMBAT_CELL_SIZE, snapHeading, type GridPos } from './grid';
import { cameraPlan, gridPointToWorld, type Point } from './layout';

/** A cell is a cliff when the ground beside it rises or falls by more than this over one cell (about 59 degrees). */
export const CLIFF_STEP = 500;
/** Furthest the grid may slide, in cells: sideways either way, and back towards the party. */
const MAX_SIDEWAYS = 3;
const MAX_BACK = 6;

export interface FittedGrid {
  /** Where the grid is anchored; the party's own position when no slide was needed. */
  anchor: Point;
  /** Heading to lay the grid out along: the party's own, or a quarter turn of it when that fits better. */
  heading: number;
  /** Cells left on cliffs after sliding. */
  disabled: GridPos[];
}

/**
 * The cells of a grid anchored at `anchor` that stand on a cliff, or inside something solid (`blocked`: hills
 * and other models with a collision outline; the height field leaves hills out, so only this catches them).
 */
export function cliffCells(
  anchor: Point,
  heading: number,
  cols: number,
  rows: number,
  getHeight: (x: number, y: number) => number,
  blocked?: (x: number, y: number) => boolean,
): GridPos[] {
  // A neighbour is one cell away in world axes; the grid is turned by whole quarter turns, so this matches.
  const step = COMBAT_CELL_SIZE;
  const out: GridPos[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const c = gridPointToWorld(anchor, heading, x + 0.5, y + 0.5);
      if (blocked?.(c.x, c.y)) {
        out.push({ x, y });
        continue;
      }
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

/** Options for `fitCombatGrid` beyond the ground height. */
export interface FitOptions {
  /** Hills and other models with a collision outline. */
  blocked?: (x: number, y: number) => boolean;
  /**
   * Height of what is drawn (ground or the hill on it). Cells where it stands well above the ground are inside a
   * hill model; a camera whose view of the grid passes through it cannot see the fight.
   */
  surface?: (x: number, y: number) => number;
}

/** A cell whose drawn surface is this far above the ground is on (or in) a hill model. */
export const RAISED = 150;
/** Cost of turning the grid away from the way the party faces: a quarter turn, and right round. */
const TURN_COST = [0, 6, 10, 6];
/** Cost of a camera that cannot see the grid, against one disabled cell (10). */
const BLIND_COST = 60;

/**
 * True when the combat camera (`cameraPlan`) sees the middle of the grid: the sight line stays above the drawn
 * surface all the way.
 */
export function cameraSeesGrid(
  anchor: Point,
  heading: number,
  cols: number,
  rows: number,
  getHeight: (x: number, y: number) => number,
  surface: (x: number, y: number) => number,
): boolean {
  const plan = cameraPlan(anchor, heading, cols, rows);
  const eyeH = getHeight(plan.eye.x, plan.eye.y) + plan.height;
  const targetH = getHeight(plan.target.x, plan.target.y);
  if (surface(plan.eye.x, plan.eye.y) > eyeH - 200) return false;
  const steps = 16;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = plan.eye.x + (plan.target.x - plan.eye.x) * t;
    const y = plan.eye.y + (plan.target.y - plan.eye.y) * t;
    if (surface(x, y) > eyeH + (targetH - eyeH) * t - 60) return false;
  }
  return true;
}

/**
 * Where to lay the grid: the party's own spot and facing when that is clear, otherwise the best of the grid slid
 * back (up to 6 cells) or sideways (up to 3) and turned to each side or right round. The cost counts disabled
 * cells first, then a camera that cannot see the fight, then how far the grid moved and turned.
 */
export function fitCombatGrid(
  party: Point,
  heading: number,
  cols: number,
  rows: number,
  getHeight: (x: number, y: number) => number,
  o: FitOptions | ((x: number, y: number) => boolean) = {},
): FittedGrid {
  const { blocked, surface } = typeof o === 'function' ? { blocked: o, surface: undefined } : o;
  const solid =
    surface || blocked
      ? (x: number, y: number) => !!blocked?.(x, y) || (!!surface && surface(x, y) - getHeight(x, y) > RAISED)
      : undefined;
  const base = snapHeading(heading);
  let best: FittedGrid | undefined;
  let bestCost = Infinity;
  for (let turn = 0; turn < 4; turn++) {
    const h = (base + turn * 64) % 256;
    const a = (h * 2 * Math.PI) / 256;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    for (let back = 0; back <= MAX_BACK; back++) {
      for (let side = -MAX_SIDEWAYS; side <= MAX_SIDEWAYS; side++) {
        const moveCost = TURN_COST[turn]! + back + Math.abs(side);
        if (moveCost >= bestCost) continue;
        // Grid-local (east, north) shift turned into world axes.
        const lx = side * COMBAT_CELL_SIZE;
        const ly = -back * COMBAT_CELL_SIZE;
        const anchor = { x: party.x + lx * cos - ly * sin, y: party.y + lx * sin + ly * cos };
        const disabled = cliffCells(anchor, h, cols, rows, getHeight, solid);
        let cost = disabled.length * 10 + moveCost;
        if (cost >= bestCost) continue;
        if (surface && !cameraSeesGrid(anchor, h, cols, rows, getHeight, surface)) cost += BLIND_COST;
        if (cost < bestCost) {
          best = { anchor, heading: h === base ? heading : h, disabled };
          bestCost = cost;
        }
      }
    }
  }
  return best!;
}
