/**
 * Combat grid: geometry, movement and attack targeting. See docs/formats/combat.md.
 *
 * Pure logic, independent of rendering. The layout and rules follow what BaKGL
 * implements (reference only; this code is our own); where the original game's
 * behaviour is unconfirmed the docs say so.
 */

export const COMBAT_GRID_COLS = 8;
export const COMBAT_GRID_ROWS = 13;
export const COMBAT_GRID_ROWS_UNDERGROUND = 7;
/** Side of one grid cell in world units (one world cell is 1600 units). */
export const COMBAT_CELL_SIZE = 300;
/** World offset of the grid's cell (0, 0) corner from the party, when the party faces north. */
export const COMBAT_GRID_ORIGIN_OFFSET = { x: -1200, y: 3200 } as const;

export interface GridPos {
  x: number;
  y: number;
}

/** The 8 directions in BaK's sprite order. South is 0; steps go anticlockwise (S, SE, E, NE, N, NW, W, SW). */
export const Direction = {
  South: 0,
  SouthEast: 1,
  East: 2,
  NorthEast: 3,
  North: 4,
  NorthWest: 5,
  West: 6,
  SouthWest: 7,
} as const;
export type Direction = (typeof Direction)[keyof typeof Direction];

/** Grid y grows north, x grows east. */
const DELTAS: readonly GridPos[] = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
];

export function directionDelta(d: Direction): GridPos {
  return DELTAS[d]!;
}

export function isCardinal(d: Direction): boolean {
  return d % 2 === 0;
}

export function oppositeDirection(d: Direction): Direction {
  return ((d + 4) % 8) as Direction;
}

/** 8-bit heading (0 = north, 128 = south) to the nearest of the 8 directions. */
export function headingToDirection(heading: number): Direction {
  return (Math.floor((((heading & 0xff) + 144) % 256) / 32)) as Direction;
}

export function directionToHeading(d: Direction): number {
  return (d * 32 + 128) % 256;
}

/** Direction of the straight line from `from` to `to`; South when they coincide. */
export function directionBetween(from: GridPos, to: GridPos): Direction {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return Direction.South;
  const angle = Math.atan2(dy, dx) + Math.PI / 2 + Math.PI;
  const heading = Math.round((angle * 256) / (2 * Math.PI)) & 0xff;
  return headingToDirection(heading);
}

export function chebyshevDistance(a: GridPos, b: GridPos): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Melee range: orthogonally adjacent only. Diagonal neighbours are not adjacent. */
export function isAdjacent(a: GridPos, b: GridPos): boolean {
  return chebyshevDistance(a, b) === 1 && (a.x === b.x || a.y === b.y);
}

export function samePos(a: GridPos, b: GridPos): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Heading snapped to the nearest `snap` units (BaKGL snaps combat orientation to 64, a quarter turn). */
export function snapHeading(heading: number, snap = 64): number {
  return Math.floor(((heading & 0xff) + snap / 2) / snap) * snap & 0xff;
}

function rotate(x: number, y: number, heading: number): { x: number; y: number } {
  const angle = (heading * 2 * Math.PI) / 256;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: Math.round(x * c - y * s), y: Math.round(x * s + y * c) };
}

/**
 * World position (x east, y north) of the centre of grid cell `cell`, for a party at
 * `party` with 8-bit `heading`. The grid is rotated to the party's heading snapped to a quarter turn.
 */
export function gridCellToWorld(party: GridPos, heading: number, cell: GridPos): { x: number; y: number } {
  const snapped = snapHeading(heading);
  const half = COMBAT_CELL_SIZE / 2;
  const origin = rotate(COMBAT_GRID_ORIGIN_OFFSET.x + half, COMBAT_GRID_ORIGIN_OFFSET.y + half, snapped);
  const offset = rotate(cell.x * COMBAT_CELL_SIZE, cell.y * COMBAT_CELL_SIZE, snapped);
  return { x: Math.floor(party.x + origin.x + offset.x), y: Math.floor(party.y + origin.y + offset.y) };
}

export type Side = 'party' | 'enemy';

/** What the grid needs to know about a combatant. */
export interface GridOccupant {
  id: string;
  pos: GridPos;
  side: Side;
  dead: boolean;
}

export interface CellState {
  /** Cannot be walked through: disabled terrain or a living occupant. */
  blocked: boolean;
  /** Mover may walk here this turn (not blocked and within speed). */
  reachable: boolean;
  /** Holds a living opponent of the mover. */
  attackable: boolean;
  /** Holds a living friend of the mover (including the mover). */
  ally: boolean;
  /** Blocked terrain/obstacle. */
  disabled: boolean;
  /** Occupant id, living or dead. */
  occupant?: string;
}

export interface CombatGrid {
  cols: number;
  rows: number;
  /** Row-major, index y * cols + x. */
  cells: CellState[];
}

export function inBounds(grid: { cols: number; rows: number }, p: GridPos): boolean {
  return p.x >= 0 && p.x < grid.cols && p.y >= 0 && p.y < grid.rows;
}

export function cellIndex(grid: { cols: number }, p: GridPos): number {
  return p.y * grid.cols + p.x;
}

export function cellAt(grid: CombatGrid, p: GridPos): CellState | undefined {
  return inBounds(grid, p) ? grid.cells[cellIndex(grid, p)] : undefined;
}

export function canMoveTo(grid: CombatGrid, p: GridPos): boolean {
  return cellAt(grid, p)?.reachable ?? false;
}

export function canAttack(grid: CombatGrid, p: GridPos): boolean {
  return cellAt(grid, p)?.attackable ?? false;
}

export interface MoverInfo {
  id: string;
  side: Side;
  /** Current Speed skill; the maximum path length in steps (see docs). */
  speed: number;
}

export interface BuildGridOptions {
  cols?: number;
  rows?: number;
  /** Cells that cannot be entered. */
  disabled?: readonly GridPos[];
  occupants: readonly GridOccupant[];
  mover: MoverInfo;
  /** Position of the mover; defaults to the occupant with `mover.id`. */
  moverPos?: GridPos;
}

/**
 * Computes cell flags for the mover's turn. A living occupant blocks its cell; a corpse does
 * not. Reachability is a shortest path of at most `speed` steps through free cells, where a
 * diagonal step costs the same as an orthogonal one.
 */
export function buildGrid(opts: BuildGridOptions): CombatGrid {
  const cols = opts.cols ?? COMBAT_GRID_COLS;
  const rows = opts.rows ?? COMBAT_GRID_ROWS;
  const cells: CellState[] = Array.from({ length: cols * rows }, () => ({
    blocked: false,
    reachable: true,
    attackable: false,
    ally: false,
    disabled: false,
  }));
  const grid: CombatGrid = { cols, rows, cells };

  for (const p of opts.disabled ?? []) {
    const c = cellAt(grid, p);
    if (c) {
      c.disabled = true;
      c.blocked = true;
      c.reachable = false;
    }
  }

  for (const o of opts.occupants) {
    const c = cellAt(grid, o.pos);
    if (!c) continue;
    c.occupant = o.id;
    if (o.dead) continue;
    c.blocked = true;
    c.reachable = false;
    if (o.side === opts.mover.side) c.ally = true;
    else c.attackable = true;
  }

  const start = opts.moverPos ?? opts.occupants.find((o) => o.id === opts.mover.id)?.pos;
  if (!start) throw new Error(`mover ${opts.mover.id} has no position`);
  const dist = distanceMap(grid, start);
  for (let i = 0; i < cells.length; i++) {
    const d = dist[i]!;
    if (cells[i]!.reachable && !(d >= 0 && d <= opts.mover.speed)) cells[i]!.reachable = false;
  }
  return grid;
}

/** Candidate order for path search: the straight direction first, then alternating either side of it. */
export function neighbourOrder(straight: Direction): Direction[] {
  return [0, 1, 7, 2, 6, 3, 5, 4].map((o) => ((straight + o) % 8) as Direction);
}

/** Breadth-first step counts from `start` over unblocked cells; -1 where unreachable. The start itself is 0. */
function distanceMap(grid: CombatGrid, start: GridPos): number[] {
  const dist = new Array<number>(grid.cells.length).fill(-1);
  if (!inBounds(grid, start)) return dist;
  dist[cellIndex(grid, start)] = 0;
  const queue: GridPos[] = [start];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]!;
    const d = dist[cellIndex(grid, cur)]!;
    for (const delta of DELTAS) {
      const next = { x: cur.x + delta.x, y: cur.y + delta.y };
      if (!inBounds(grid, next)) continue;
      const i = cellIndex(grid, next);
      if (dist[i]! >= 0 || grid.cells[i]!.blocked) continue;
      dist[i] = d + 1;
      queue.push(next);
    }
  }
  return dist;
}

/**
 * Shortest path from `src` to `dest`, excluding `src`, including `dest`; empty when there is none
 * or `src` equals `dest`. Steps go through unblocked cells only, but `dest` may itself be blocked
 * (a path to an enemy ends on its cell). Ties are broken toward the direction of travel, so
 * paths run as straight as the grid allows.
 */
export function calculatePath(grid: CombatGrid, src: GridPos, dest: GridPos): GridPos[] {
  if (samePos(src, dest) || !inBounds(grid, src) || !inBounds(grid, dest)) return [];
  const order = neighbourOrder(directionBetween(src, dest));
  const parent = new Map<number, GridPos>();
  const seen = new Set<number>([cellIndex(grid, src)]);
  const queue: GridPos[] = [src];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]!;
    for (const dir of order) {
      const delta = DELTAS[dir]!;
      const next = { x: cur.x + delta.x, y: cur.y + delta.y };
      if (!inBounds(grid, next)) continue;
      const i = cellIndex(grid, next);
      if (samePos(next, dest)) {
        parent.set(i, cur);
        const path: GridPos[] = [];
        for (let p = dest; !samePos(p, src); p = parent.get(cellIndex(grid, p))!) path.push(p);
        return path.reverse();
      }
      if (seen.has(i) || grid.cells[i]!.blocked) continue;
      seen.add(i);
      parent.set(i, cur);
      queue.push(next);
    }
  }
  return [];
}

/**
 * Cell to stand on to melee `target`. If `src` is already orthogonally adjacent that is `src`.
 * Otherwise the nearest (by path length) free orthogonal neighbour of the target, trying
 * north, south, east, west in that order on ties. Undefined when none can be entered.
 */
export function selectAttackPosition(grid: CombatGrid, src: GridPos, target: GridPos): GridPos | undefined {
  if (isAdjacent(src, target)) return src;
  const candidates: GridPos[] = [
    { x: target.x, y: target.y + 1 },
    { x: target.x, y: target.y - 1 },
    { x: target.x + 1, y: target.y },
    { x: target.x - 1, y: target.y },
  ];
  const scored = candidates
    .filter((c) => !!cellAt(grid, c) && !grid.cells[cellIndex(grid, c)]!.blocked)
    .map((c, order) => ({ c, order, len: calculatePath(grid, src, c).length }))
    .filter((e) => e.len > 0)
    .sort((a, b) => a.len - b.len || a.order - b.order);
  return scored[0]?.c;
}

export type AttackType = 'slash' | 'thrust';

export interface AttackPlan {
  /** Cells to walk through first; empty when already adjacent. */
  moves: GridPos[];
  attack: { target: GridPos; type: AttackType };
}

export interface PlanAttackOptions {
  /** A slash is a stationary swing that costs stamina; BaKGL requires more than 1 stamina left. */
  slash?: boolean;
  /** Longest approach allowed. BaKGL imposes none (see docs); callers may pass the mover's speed. */
  maxSteps?: number;
}

/**
 * Plans moving next to an enemy and striking it. A slash is only possible without moving first;
 * asking for one while out of reach, or targeting a cell that is not attackable, yields undefined.
 */
export function planAttack(
  grid: CombatGrid,
  src: GridPos,
  target: GridPos,
  opts: PlanAttackOptions = {},
): AttackPlan | undefined {
  if (!canAttack(grid, target)) return undefined;
  const stand = selectAttackPosition(grid, src, target);
  if (!stand) return undefined;
  const moves = samePos(stand, src) ? [] : calculatePath(grid, src, stand);
  if (!samePos(stand, src) && moves.length === 0) return undefined;
  if (opts.slash && moves.length > 0) return undefined;
  if (opts.maxSteps !== undefined && moves.length > opts.maxSteps) return undefined;
  return { moves, attack: { target, type: opts.slash ? 'slash' : 'thrust' } };
}

