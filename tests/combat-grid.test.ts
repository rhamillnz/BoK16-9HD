import { describe, expect, it } from 'vitest';
import {
  COMBAT_CELL_SIZE,
  Direction,
  buildGrid,
  calculatePath,
  canAttack,
  canMoveTo,
  chebyshevDistance,
  directionBetween,
  directionToHeading,
  gridCellToWorld,
  headingToDirection,
  isAdjacent,
  neighbourOrder,
  oppositeDirection,
  planAttack,
  selectAttackPosition,
  snapHeading,
  type GridOccupant,
  type GridPos,
} from '../src/combat/grid';

const hero = (pos: GridPos, id = 'h'): GridOccupant => ({ id, pos, side: 'party', dead: false });
const orc = (pos: GridPos, id = 'o', dead = false): GridOccupant => ({ id, pos, side: 'enemy', dead });

describe('directions', () => {
  it('maps headings to directions with 0 = north and 128 = south', () => {
    expect(headingToDirection(0)).toBe(Direction.North);
    expect(headingToDirection(128)).toBe(Direction.South);
    expect(headingToDirection(64)).toBe(Direction.West);
    expect(headingToDirection(192)).toBe(Direction.East);
  });

  it('round-trips directions through headings', () => {
    for (let d = 0; d < 8; d++) expect(headingToDirection(directionToHeading(d as Direction))).toBe(d);
  });

  it('finds the direction between cells', () => {
    const o = { x: 4, y: 4 };
    expect(directionBetween(o, { x: 4, y: 9 })).toBe(Direction.North);
    expect(directionBetween(o, { x: 4, y: 0 })).toBe(Direction.South);
    expect(directionBetween(o, { x: 9, y: 4 })).toBe(Direction.East);
    expect(directionBetween(o, { x: 0, y: 4 })).toBe(Direction.West);
    expect(directionBetween(o, { x: 6, y: 6 })).toBe(Direction.NorthEast);
    expect(directionBetween(o, { x: 2, y: 2 })).toBe(Direction.SouthWest);
    expect(directionBetween(o, o)).toBe(Direction.South);
  });

  it('computes opposites and neighbour order', () => {
    expect(oppositeDirection(Direction.North)).toBe(Direction.South);
    expect(oppositeDirection(Direction.NorthEast)).toBe(Direction.SouthWest);
    expect(neighbourOrder(Direction.East)).toEqual([2, 3, 1, 4, 0, 5, 7, 6]);
  });

  it('treats only orthogonal neighbours as adjacent', () => {
    expect(isAdjacent({ x: 1, y: 1 }, { x: 1, y: 2 })).toBe(true);
    expect(isAdjacent({ x: 1, y: 1 }, { x: 2, y: 2 })).toBe(false);
    expect(isAdjacent({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(false);
    expect(isAdjacent({ x: 1, y: 1 }, { x: 1, y: 3 })).toBe(false);
    expect(chebyshevDistance({ x: 0, y: 0 }, { x: 3, y: 5 })).toBe(5);
  });
});

describe('world mapping', () => {
  it('places cell (0,0) at the grid origin offset when facing north', () => {
    const p = gridCellToWorld({ x: 10000, y: 20000 }, 0, { x: 0, y: 0 });
    expect(p).toEqual({ x: 10000 - 1200 + 150, y: 20000 + 3200 + 150 });
  });

  it('steps one cell size per grid step', () => {
    const a = gridCellToWorld({ x: 0, y: 0 }, 0, { x: 0, y: 0 });
    const b = gridCellToWorld({ x: 0, y: 0 }, 0, { x: 2, y: 3 });
    expect(b).toEqual({ x: a.x + 2 * COMBAT_CELL_SIZE, y: a.y + 3 * COMBAT_CELL_SIZE });
  });

  it('snaps headings to quarter turns', () => {
    expect(snapHeading(10)).toBe(0);
    expect(snapHeading(40)).toBe(64);
    expect(snapHeading(250)).toBe(0);
  });

  it('rotates the grid by a quarter turn', () => {
    const a = gridCellToWorld({ x: 0, y: 0 }, 0, { x: 1, y: 0 });
    const b = gridCellToWorld({ x: 0, y: 0 }, 64, { x: 1, y: 0 });
    // Offset of cell (1,0) vs (0,0) is (+300, 0) at heading 0 and (0, +300) at heading 64.
    const a0 = gridCellToWorld({ x: 0, y: 0 }, 0, { x: 0, y: 0 });
    const b0 = gridCellToWorld({ x: 0, y: 0 }, 64, { x: 0, y: 0 });
    expect({ x: a.x - a0.x, y: a.y - a0.y }).toEqual({ x: 300, y: 0 });
    expect({ x: b.x - b0.x, y: b.y - b0.y }).toEqual({ x: 0, y: 300 });
  });
});

describe('buildGrid', () => {
  it('limits reachable cells to the mover speed, diagonals costing one step', () => {
    const g = buildGrid({ occupants: [hero({ x: 3, y: 3 })], mover: { id: 'h', side: 'party', speed: 2 } });
    expect(canMoveTo(g, { x: 5, y: 5 })).toBe(true);
    expect(canMoveTo(g, { x: 5, y: 3 })).toBe(true);
    expect(canMoveTo(g, { x: 6, y: 3 })).toBe(false);
    expect(canMoveTo(g, { x: 3, y: 3 })).toBe(false); // own cell
  });

  it('is 8 x 13 by default and clips to the bounds', () => {
    const g = buildGrid({ occupants: [hero({ x: 0, y: 0 })], mover: { id: 'h', side: 'party', speed: 99 } });
    expect(g.cols).toBe(8);
    expect(g.rows).toBe(13);
    expect(canMoveTo(g, { x: 7, y: 12 })).toBe(true);
    expect(canMoveTo(g, { x: 8, y: 0 })).toBe(false);
    expect(canMoveTo(g, { x: -1, y: 0 })).toBe(false);
  });

  it('flags enemies attackable and allies, and blocks living occupants only', () => {
    const g = buildGrid({
      occupants: [
        hero({ x: 1, y: 1 }),
        hero({ x: 2, y: 1 }, 'h2'),
        orc({ x: 4, y: 1 }),
        orc({ x: 5, y: 1 }, 'dead', true),
      ],
      mover: { id: 'h', side: 'party', speed: 9 },
    });
    expect(canAttack(g, { x: 4, y: 1 })).toBe(true);
    expect(canAttack(g, { x: 5, y: 1 })).toBe(false);
    expect(canMoveTo(g, { x: 5, y: 1 })).toBe(true); // corpses do not block
    expect(canMoveTo(g, { x: 2, y: 1 })).toBe(false);
    expect(g.cells[1 * 8 + 2]!.ally).toBe(true);
  });

  it('routes around obstacles and counts the detour against speed', () => {
    const wall = [
      { x: 3, y: 2 },
      { x: 3, y: 3 },
      { x: 3, y: 4 },
    ];
    const g = buildGrid({
      occupants: [hero({ x: 2, y: 3 })],
      disabled: wall,
      mover: { id: 'h', side: 'party', speed: 2 },
    });
    expect(g.cells[3 * 8 + 3]!.disabled).toBe(true);
    expect(canMoveTo(g, { x: 4, y: 3 })).toBe(false); // needs 4 steps around
    const g2 = buildGrid({
      occupants: [hero({ x: 2, y: 3 })],
      disabled: wall,
      mover: { id: 'h', side: 'party', speed: 4 },
    });
    expect(canMoveTo(g2, { x: 4, y: 3 })).toBe(true);
  });

  it('honours custom dimensions (underground grid)', () => {
    const g = buildGrid({ rows: 7, occupants: [hero({ x: 0, y: 0 })], mover: { id: 'h', side: 'party', speed: 20 } });
    expect(g.rows).toBe(7);
    expect(canMoveTo(g, { x: 0, y: 7 })).toBe(false);
    expect(canMoveTo(g, { x: 0, y: 6 })).toBe(true);
  });

  it('requires a position for the mover', () => {
    expect(() => buildGrid({ occupants: [], mover: { id: 'x', side: 'party', speed: 1 } })).toThrow(/no position/);
  });
});

describe('calculatePath', () => {
  const open = () => buildGrid({ occupants: [hero({ x: 0, y: 0 })], mover: { id: 'h', side: 'party', speed: 99 } });

  it('returns an empty path for the same cell', () => {
    expect(calculatePath(open(), { x: 1, y: 1 }, { x: 1, y: 1 })).toEqual([]);
  });

  it('walks a straight line, excluding the start and including the end', () => {
    expect(calculatePath(open(), { x: 0, y: 0 }, { x: 0, y: 3 })).toEqual([
      { x: 0, y: 1 },
      { x: 0, y: 2 },
      { x: 0, y: 3 },
    ]);
  });

  it('uses diagonals, so the length is the Chebyshev distance', () => {
    const path = calculatePath(open(), { x: 0, y: 0 }, { x: 3, y: 5 });
    expect(path).toHaveLength(5);
    expect(path.at(-1)).toEqual({ x: 3, y: 5 });
  });

  it('prefers continuing in the direction of travel', () => {
    const path = calculatePath(open(), { x: 0, y: 0 }, { x: 4, y: 0 });
    expect(path.every((p) => p.y === 0)).toBe(true);
  });

  it('goes around blocked cells', () => {
    const g = buildGrid({
      occupants: [hero({ x: 0, y: 1 })],
      disabled: [
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 1, y: 2 },
      ],
      mover: { id: 'h', side: 'party', speed: 99 },
    });
    const path = calculatePath(g, { x: 0, y: 1 }, { x: 2, y: 1 });
    expect(path.length).toBeGreaterThan(2);
    expect(path.some((p) => p.x === 1 && p.y <= 2)).toBe(false);
  });

  it('may end on a blocked destination but not cross blocked cells', () => {
    const g = buildGrid({
      occupants: [hero({ x: 0, y: 0 }), orc({ x: 0, y: 2 })],
      mover: { id: 'h', side: 'party', speed: 9 },
    });
    expect(calculatePath(g, { x: 0, y: 0 }, { x: 0, y: 2 }).at(-1)).toEqual({ x: 0, y: 2 });
  });

  it('returns empty when the destination is walled off', () => {
    const ring = [
      { x: 3, y: 4 },
      { x: 5, y: 4 },
      { x: 4, y: 3 },
      { x: 4, y: 5 },
      { x: 3, y: 3 },
      { x: 5, y: 3 },
      { x: 3, y: 5 },
      { x: 5, y: 5 },
    ];
    const g = buildGrid({
      occupants: [hero({ x: 0, y: 0 })],
      disabled: ring,
      mover: { id: 'h', side: 'party', speed: 99 },
    });
    expect(calculatePath(g, { x: 0, y: 0 }, { x: 4, y: 4 })).toEqual([]);
    expect(calculatePath(g, { x: 0, y: 0 }, { x: 99, y: 0 })).toEqual([]);
  });
});

describe('attacks', () => {
  it('stays put when already orthogonally adjacent', () => {
    const g = buildGrid({
      occupants: [hero({ x: 2, y: 2 }), orc({ x: 2, y: 3 })],
      mover: { id: 'h', side: 'party', speed: 3 },
    });
    expect(selectAttackPosition(g, { x: 2, y: 2 }, { x: 2, y: 3 })).toEqual({ x: 2, y: 2 });
    expect(planAttack(g, { x: 2, y: 2 }, { x: 2, y: 3 })).toEqual({
      moves: [],
      attack: { target: { x: 2, y: 3 }, type: 'thrust' },
    });
    expect(planAttack(g, { x: 2, y: 2 }, { x: 2, y: 3 }, { slash: true })?.attack.type).toBe('slash');
  });

  it('moves a diagonal attacker to an orthogonal neighbour of the target', () => {
    const g = buildGrid({
      occupants: [hero({ x: 2, y: 2 }), orc({ x: 3, y: 3 })],
      mover: { id: 'h', side: 'party', speed: 3 },
    });
    const plan = planAttack(g, { x: 2, y: 2 }, { x: 3, y: 3 })!;
    expect(plan.moves).toHaveLength(1);
    expect(isAdjacent(plan.moves[0]!, { x: 3, y: 3 })).toBe(true);
  });

  it('refuses slashes that need a move, and non-enemy targets', () => {
    const g = buildGrid({
      occupants: [hero({ x: 0, y: 0 }), hero({ x: 1, y: 0 }, 'h2'), orc({ x: 0, y: 4 })],
      mover: { id: 'h', side: 'party', speed: 3 },
    });
    expect(planAttack(g, { x: 0, y: 0 }, { x: 0, y: 4 }, { slash: true })).toBeUndefined();
    expect(planAttack(g, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeUndefined();
    expect(planAttack(g, { x: 0, y: 0 }, { x: 5, y: 5 })).toBeUndefined();
  });

  it('picks the nearest free neighbour of a distant target', () => {
    const g = buildGrid({
      occupants: [hero({ x: 0, y: 0 }), orc({ x: 0, y: 5 })],
      mover: { id: 'h', side: 'party', speed: 3 },
    });
    const plan = planAttack(g, { x: 0, y: 0 }, { x: 0, y: 5 })!;
    expect(plan.moves.at(-1)).toEqual({ x: 0, y: 4 });
    expect(plan.moves).toHaveLength(4);
  });

  it('can limit the approach distance', () => {
    const g = buildGrid({
      occupants: [hero({ x: 0, y: 0 }), orc({ x: 0, y: 5 })],
      mover: { id: 'h', side: 'party', speed: 3 },
    });
    expect(planAttack(g, { x: 0, y: 0 }, { x: 0, y: 5 }, { maxSteps: 3 })).toBeUndefined();
    expect(planAttack(g, { x: 0, y: 0 }, { x: 0, y: 5 }, { maxSteps: 4 })).toBeDefined();
  });

  it('has no attack position when the target is boxed in', () => {
    const g = buildGrid({
      occupants: [hero({ x: 0, y: 0 }), orc({ x: 4, y: 4 })],
      disabled: [
        { x: 4, y: 5 },
        { x: 4, y: 3 },
        { x: 5, y: 4 },
        { x: 3, y: 4 },
      ],
      mover: { id: 'h', side: 'party', speed: 9 },
    });
    expect(selectAttackPosition(g, { x: 0, y: 0 }, { x: 4, y: 4 })).toBeUndefined();
    expect(planAttack(g, { x: 0, y: 0 }, { x: 4, y: 4 })).toBeUndefined();
  });
});
