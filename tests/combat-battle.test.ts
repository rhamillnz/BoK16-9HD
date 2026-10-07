import { describe, expect, it } from 'vitest';
import { enemyTurn } from '../src/combat/ai';
import {
  attack,
  currentFighter,
  defend,
  flee,
  gridFor,
  moveTo,
  rest,
  startBattle,
  type Fighter,
} from '../src/combat/battle';
import { Direction } from '../src/combat/grid';
import { RaceKind, rollFrom } from '../src/combat/rules';

const fighter = (id: string, side: 'party' | 'enemy', x: number, y: number, over: Partial<Fighter> = {}): Fighter => ({
  id,
  side,
  name: id,
  monster: 0,
  pos: { x, y },
  facing: Direction.North,
  health: 20,
  maxHealth: 20,
  stamina: 10,
  maxStamina: 10,
  speed: 5,
  strength: 8,
  defense: 0,
  melee: 90,
  race: RaceKind.None,
  ...over,
});
/** Always rolls the lowest value: every attack hits and armour never rounds up. */
const low = (lo: number) => lo;
const high = (_: number, hi: number) => hi;

describe('battle flow', () => {
  it('starts with the fastest party member', () => {
    const s = startBattle([
      fighter('a', 'party', 3, 1, { speed: 3 }),
      fighter('b', 'party', 4, 1, { speed: 7 }),
      fighter('x', 'enemy', 3, 8, { speed: 9 }),
    ]);
    expect(currentFighter(s).id).toBe('b');
  });

  it('moving uses the turn and passes it to the next fighter', () => {
    const s = startBattle([fighter('a', 'party', 3, 1), fighter('x', 'enemy', 3, 8, { speed: 1 })]);
    const moved = moveTo(s, { x: 3, y: 4 })!;
    expect(moved.fighters[0]!.pos).toEqual({ x: 3, y: 4 });
    expect(currentFighter(moved).id).toBe('x');
    expect(moved.events[0]).toMatchObject({ type: 'move', id: 'a' });
  });

  it('refuses moves beyond Speed, onto occupied or disabled cells', () => {
    const s = startBattle([fighter('a', 'party', 3, 1), fighter('x', 'enemy', 3, 4)], [{ x: 4, y: 1 }]);
    expect(moveTo(s, { x: 3, y: 7 })).toBeUndefined();
    expect(moveTo(s, { x: 3, y: 4 })).toBeUndefined();
    expect(moveTo(s, { x: 4, y: 1 })).toBeUndefined();
    expect(moveTo(s, { x: 3, y: 1 })).toBeUndefined();
    expect(moveTo(s, { x: 9, y: 1 })).toBeUndefined();
  });

  it('gridFor flags reachable and attackable cells for the current fighter', () => {
    const s = startBattle([fighter('a', 'party', 3, 1), fighter('x', 'enemy', 3, 6)]);
    const g = gridFor(s);
    expect(g.cells[6 * g.cols + 3]!.attackable).toBe(true);
    expect(g.cells[3 * g.cols + 3]!.reachable).toBe(true);
    expect(g.cells[12 * g.cols + 7]!.reachable).toBe(false);
  });

  it('defend and rest end the turn; defending raises the roll against the defender next', () => {
    const s = startBattle([fighter('a', 'party', 3, 1, { speed: 9 }), fighter('x', 'enemy', 3, 2, { speed: 1 })]);
    const d = defend(s)!;
    expect(d.fighters[0]!.defending).toBe(true);
    expect(currentFighter(d).id).toBe('x');
    expect(rest(d)!.events[0]).toMatchObject({ type: 'rest' });
  });

  it('a new round clears defending', () => {
    let s = startBattle([fighter('a', 'party', 3, 1, { speed: 9 }), fighter('x', 'enemy', 3, 9, { speed: 1 })]);
    s = defend(s)!; // x
    s = rest(s)!; // round 2, a again
    expect(s.turn.round).toBe(2);
    expect(s.fighters[0]!.defending).toBe(false);
    expect(s.events.some((e) => e.type === 'round')).toBe(true);
  });
});

describe('melee', () => {
  it('walks next to the target, hits and deals Strength damage (stamina first)', () => {
    const s = startBattle([fighter('a', 'party', 3, 1, { strength: 6 }), fighter('x', 'enemy', 3, 5, { speed: 1 })]);
    const next = attack(s, { x: 3, y: 5 }, low)!;
    expect(next.fighters[0]!.pos).toEqual({ x: 3, y: 4 });
    expect(next.fighters[1]).toMatchObject({ stamina: 4, health: 20 });
    expect(next.events.map((e) => e.type)).toEqual(['move', 'attack']);
  });

  it('kills at zero health and ends the fight as a win', () => {
    const s = startBattle([
      fighter('a', 'party', 3, 1, { strength: 50 }),
      fighter('x', 'enemy', 3, 2, { health: 5, stamina: 0, speed: 1 }),
    ]);
    const next = attack(s, { x: 3, y: 2 }, low)!;
    expect(next.fighters[1]!.health).toBe(0);
    expect(next.turn.outcome).toBe('won');
    expect(next.events.at(-1)).toEqual({ type: 'end', outcome: 'won' });
  });

  it('a miss does no damage', () => {
    const s = startBattle([fighter('a', 'party', 3, 1, { melee: 0 }), fighter('x', 'enemy', 3, 2, { speed: 1 })]);
    const next = attack(s, { x: 3, y: 2 }, high)!;
    expect(next.fighters[1]).toMatchObject({ health: 20, stamina: 10 });
    expect(next.events.at(-1)).toMatchObject({ type: 'attack', hit: false, damage: 0 });
  });

  it('cannot attack allies, empty cells, or targets farther than Speed away', () => {
    const s = startBattle([
      fighter('a', 'party', 3, 1, { speed: 2 }),
      fighter('b', 'party', 4, 1, { speed: 1 }),
      fighter('x', 'enemy', 3, 9),
    ]);
    expect(attack(s, { x: 4, y: 1 }, low)).toBeUndefined();
    expect(attack(s, { x: 0, y: 0 }, low)).toBeUndefined();
    expect(attack(s, { x: 3, y: 9 }, low)).toBeUndefined();
  });

  it('a slash needs to be adjacent already and costs the attacker 1 stamina', () => {
    const s = startBattle([
      fighter('a', 'party', 3, 1),
      fighter('x', 'enemy', 3, 2, { speed: 1 }),
      fighter('y', 'enemy', 3, 9, { speed: 1 }),
    ]);
    expect(attack(s, { x: 3, y: 9 }, low, { kind: 'slash' })).toBeUndefined();
    const next = attack(s, { x: 3, y: 2 }, low, { kind: 'slash' })!;
    expect(next.fighters[0]!.stamina).toBe(9);
    expect(next.events.at(-1)).toMatchObject({ kind: 'slash' });
    const tired = startBattle([fighter('a', 'party', 3, 1, { stamina: 1 }), fighter('x', 'enemy', 3, 2)]);
    expect(attack(tired, { x: 3, y: 2 }, low, { kind: 'slash' })).toBeUndefined();
  });

  it('the party loses when its last member falls', () => {
    const s = startBattle([
      fighter('a', 'party', 3, 1, { speed: 1, health: 3, stamina: 0 }),
      fighter('x', 'enemy', 3, 2, { strength: 20, speed: 9 }),
    ]);
    // the party's first turn goes to its only member even though the enemy is faster
    const afterA = rest(s)!;
    expect(currentFighter(afterA).id).toBe('x');
    const next = attack(afterA, { x: 3, y: 1 }, low)!;
    expect(next.turn.outcome).toBe('dead');
  });
});

describe('flee', () => {
  it('ends the fight as a retreat, only on a party turn', () => {
    const s = startBattle([fighter('a', 'party', 3, 1), fighter('x', 'enemy', 3, 9, { speed: 1 })]);
    const out = flee(s)!;
    expect(out.turn.outcome).toBe('fled');
    const enemyTurnState = rest(s)!;
    expect(flee(enemyTurnState)).toBeUndefined();
  });

  it('fails when more than one party member is dead', () => {
    const s = startBattle([
      fighter('a', 'party', 3, 1, { speed: 9 }),
      fighter('b', 'party', 4, 1, { health: 0 }),
      fighter('c', 'party', 5, 1, { health: 0 }),
      fighter('x', 'enemy', 3, 9, { speed: 1 }),
    ]);
    const out = flee(s)!;
    expect(out.turn.outcome).toBeUndefined();
    expect(out.events[0]).toEqual({ type: 'flee', success: false });
  });
});

describe('enemy AI', () => {
  it('attacks the nearest reachable party member', () => {
    let s = startBattle([
      fighter('a', 'party', 1, 1, { speed: 1 }),
      fighter('b', 'party', 6, 4, { speed: 1 }),
      fighter('x', 'enemy', 5, 5, { speed: 1 }),
    ]);
    s = rest(s)!; // b? the later of equal speeds acts first
    while (currentFighter(s).side !== 'enemy') s = rest(s)!;
    const next = enemyTurn(s, low);
    expect(next.events.at(-1)).toMatchObject({ type: 'attack', attacker: 'x', target: 'b' });
  });

  it('steps toward the party when nothing is in reach', () => {
    let s = startBattle([fighter('a', 'party', 3, 1, { speed: 1 }), fighter('x', 'enemy', 3, 12, { speed: 3 })]);
    s = rest(s)!;
    const next = enemyTurn(s, low);
    expect(next.events[0]).toMatchObject({ type: 'move', id: 'x' });
    expect(next.fighters[1]!.pos.y).toBe(9);
  });

  it('a whole fight between seeded rolls always finishes', () => {
    let seed = 12345;
    const roll = rollFrom(() => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000);
    let s = startBattle([
      fighter('a', 'party', 3, 1, { speed: 6, melee: 70, strength: 10 }),
      fighter('b', 'party', 4, 1, { speed: 5, melee: 70, strength: 10 }),
      fighter('x', 'enemy', 3, 10, { speed: 4, melee: 60, strength: 8 }),
      fighter('y', 'enemy', 5, 10, { speed: 4, melee: 60, strength: 8 }),
    ]);
    for (let i = 0; i < 400 && !s.turn.outcome; i++) {
      if (currentFighter(s).side === 'enemy') s = enemyTurn(s, roll);
      else s = enemyTurn(s, roll); // let the same AI play the party for the test
    }
    expect(s.turn.outcome).toMatch(/won|dead/);
  });
});
