/**
 * Where the combat grid sits in the world and how to look at it. Pure maths over BaK world units
 * (x east, y north); see `gridCellToWorld` in grid.ts for the cell centres these agree with.
 */

import { COMBAT_CELL_SIZE, COMBAT_GRID_ORIGIN_OFFSET, snapHeading, type GridPos } from './grid';

export interface Point {
  x: number;
  y: number;
}

function rotate(p: Point, heading: number): Point {
  const a = (heading * 2 * Math.PI) / 256;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/**
 * World position of a point of the grid given in (fractional) cell units from its south-west
 * corner: (0, 0) is that corner, (cols, rows) the opposite one.
 */
export function gridPointToWorld(party: Point, heading: number, gx: number, gy: number): Point {
  const snapped = snapHeading(heading);
  const local = rotate(
    { x: COMBAT_GRID_ORIGIN_OFFSET.x + gx * COMBAT_CELL_SIZE, y: COMBAT_GRID_ORIGIN_OFFSET.y + gy * COMBAT_CELL_SIZE },
    snapped,
  );
  return { x: party.x + local.x, y: party.y + local.y };
}

/** Inverse of `gridPointToWorld`: fractional cell units for a world position. */
export function worldToGridPoint(party: Point, heading: number, world: Point): Point {
  const snapped = snapHeading(heading);
  const local = rotate({ x: world.x - party.x, y: world.y - party.y }, -snapped);
  return {
    x: (local.x - COMBAT_GRID_ORIGIN_OFFSET.x) / COMBAT_CELL_SIZE,
    y: (local.y - COMBAT_GRID_ORIGIN_OFFSET.y) / COMBAT_CELL_SIZE,
  };
}

/** The grid cell under a world position, or undefined outside the grid. */
export function worldToGridCell(party: Point, heading: number, world: Point, cols: number, rows: number): GridPos | undefined {
  const g = worldToGridPoint(party, heading, world);
  const cell = { x: Math.floor(g.x), y: Math.floor(g.y) };
  return cell.x >= 0 && cell.y >= 0 && cell.x < cols && cell.y < rows ? cell : undefined;
}

export interface CameraPlan {
  /** Eye position on the ground plane; add `height` above the ground there. */
  eye: Point;
  height: number;
  /** Ground point to look at. */
  target: Point;
}

/**
 * A high camera behind the grid's near edge looking at its middle, so the whole 8 x 13 grid is
 * in view. The numbers are our own choice; the original's camera values live in a file we have not read.
 */
export function cameraPlan(party: Point, heading: number, cols: number, rows: number): CameraPlan {
  return {
    eye: gridPointToWorld(party, heading, cols / 2, -rows * 0.42),
    height: 2300,
    target: gridPointToWorld(party, heading, cols / 2, rows * 0.4),
  };
}
