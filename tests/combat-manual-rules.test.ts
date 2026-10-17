import { describe, expect, it } from 'vitest';
import { enemyTurn, routChance } from '../src/combat/ai';
import {
  assess,
  assessFacts,
  attack,
  castHitChance,
  castableSpells,
  cellsBetween,
  currentFighter,
  defend,
  enemyRetreat,
  flee,
  inventoryTurn,
  lineOfSight,
  rest,
  retreatChance,
  shoot,
  shootTargets,
  startBattle,
  type Fighter,
} from '../src/combat/battle';
import { Direction } from '../src/combat/grid';
import { RaceKind, type WeaponStats } from '../src/combat/rules';
import { initiativeFor } from '../src/game/combatEncounter';
import { APPROACH_CONTEXT } from '../src/game/combatApproach';

/** Rules the original manual describes (see docs/GAME_MECHANICS.md, "Combat"). */

const bolt = (): WeaponStats => ({
  strengthSwing: 0,
  strengthThrust: 10,
  accuracySwing: 0,
  accuracyThrust: 10,
  condition: 100,
  race: RaceKind.None,
});
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
const low = (lo: number) => lo;
const high = (_: number, hi: number) => hi;
const archer = (x = 3, y = 1) => fighter('a', 'party', x, y, { speed: 9, ranged: { crossbow: 80, weapon: bolt() } });

describe('initiative (manual p. 42)', () => {
  it('lets the side that caught the other off guard take all its first-round turns first', () => {
    const list = [
      fighter('a', 'party', 1, 1, { speed: 3 }),
      fighter('b', 'party', 2, 1, { speed: 2 }),
      fighter('x', 'enemy', 1, 8, { speed: 9 }),
    ];
    const party = startBattle(list, [], 'party');
    expect(currentFighter(party).id).toBe('a');
    const after = rest(party)!;
    expect(currentFighter(after).id).toBe('b');
    const ambushed = startBattle(list, [], 'enemy');
    expect(currentFighter(ambushed).id).toBe('x');
    expect(currentFighter(startBattle(list, [], 'none')).id).toBe('x');
  });

  it('comes from how the party approached', () => {
    expect(initiativeFor(false, APPROACH_CONTEXT.snuck)).toBe('party');
    expect(initiativeFor(true, APPROACH_CONTEXT.unscouted)).toBe('enemy');
    expect(initiativeFor(false, APPROACH_CONTEXT.unscouted)).toBe('none');
    expect(initiativeFor(true, APPROACH_CONTEXT.spotted)).toBe('none');
  });
});

describe('shooting (manual pp. 44, 45, 50)', () => {
  it('needs at least one step to the nearest enemy', () => {
    const s = startBattle([archer(), fighter('x', 'enemy', 3, 2), fighter('y', 'enemy', 3, 6)]);
    expect(shootTargets(s)).toHaveLength(0);
  });

  it('needs a clear line: a fighter or blocked cell in between stops the shot', () => {
    expect(cellsBetween({ x: 0, y: 0 }, { x: 4, y: 0 })).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
    const s = startBattle([archer(3, 1), fighter('b', 'party', 3, 4), fighter('x', 'enemy', 3, 7)]);
    expect(lineOfSight(s, { x: 3, y: 1 }, { x: 3, y: 7 })).toBe(false);
    expect(shootTargets(s)).toHaveLength(0);
    const rock = startBattle([archer(3, 1), fighter('x', 'enemy', 3, 7)], [{ x: 3, y: 4 }]);
    expect(shootTargets(rock)).toHaveLength(0);
    expect(shootTargets(startBattle([archer(3, 1), fighter('x', 'enemy', 3, 7)]))).toHaveLength(1);
  });

  it('a missed bolt can strike someone next to the target', () => {
    const s = startBattle([archer(3, 1), fighter('x', 'enemy', 3, 6), fighter('b', 'party', 4, 6, { stamina: 0 })]);
    const next = shoot(s, { x: 3, y: 6 }, high)!;
    const e = next.events[0]!;
    expect(e).toMatchObject({ type: 'shoot', hit: false });
    // high roll: misses, then strays (roll 99 < 35 fails) - so use a roll that misses but strays.
    const seq = [99, 0, 0, 1, 1];
    let k = 0;
    const scripted = (lo: number, hi: number) => Math.min(hi, Math.max(lo, seq[k++] ?? lo));
    const strayed = shoot(s, { x: 3, y: 6 }, scripted)!;
    expect(strayed.events[0]).toMatchObject({ type: 'shoot', hit: false, stray: { target: 'b' } });
    expect(strayed.fighters.find((f) => f.id === 'b')!.health).toBeLessThan(20);
  });
});

describe('spellcasting (manual p. 45)', () => {
  const caster = (x: number, y: number) =>
    fighter('m', 'party', x, y, {
      speed: 9,
      casting: 60,
      spells: [{ index: 4, name: 'Flamecast', minCost: 1, maxCost: 10, calc: 2, damage: 10 } as never],
    });

  it('is impossible with an enemy next to the caster', () => {
    const near = startBattle([caster(3, 1), fighter('x', 'enemy', 3, 2)]);
    expect(castableSpells(near)).toHaveLength(0);
  });

  it('bolts land on Casting Accuracy, less with distance', () => {
    expect(castHitChance(60, 1)).toBe(60);
    expect(castHitChance(60, 5)).toBe(48);
    expect(castHitChance(0, 9)).toBe(5);
  });
});

describe('defend and riposte (manual p. 50)', () => {
  it('a parried blow leaves the attacker open: the defender strikes back harder and surer', () => {
    let s = startBattle([
      fighter('d', 'party', 3, 1, { speed: 9, defense: 0 }),
      fighter('x', 'enemy', 3, 2, { speed: 1, melee: 10 }),
    ]);
    s = defend(s)!;
    // The enemy attacks and misses (high roll).
    s = attack(s, { x: 3, y: 1 }, high)!;
    expect(s.events[0]).toMatchObject({ type: 'attack', hit: false });
    expect(s.fighters[0]!.riposte).toBe('x');
    const plain = startBattle([
      fighter('d', 'party', 3, 1, { speed: 9 }),
      fighter('x', 'enemy', 3, 2, { speed: 1, stamina: 0 }),
    ]);
    const normal = attack(plain, { x: 3, y: 2 }, low)!.events.find((e) => e.type === 'attack') as { damage: number };
    // Round 2: the defender strikes back.
    const back = attack(
      { ...s, fighters: s.fighters.map((f) => (f.id === 'x' ? { ...f, stamina: 0 } : f)) },
      { x: 3, y: 2 },
      low,
    )!;
    const hit = back.events.find((e) => e.type === 'attack') as { damage: number };
    expect(hit.damage).toBeGreaterThan(normal.damage);
    expect(back.fighters[0]!.riposte).toBeUndefined();
  });
});

describe('rest, assess, retreat (manual pp. 46, 47)', () => {
  it('rest restores Health first, then Stamina, and leaves the fighter easier to hit', () => {
    const s = startBattle([
      fighter('a', 'party', 3, 1, { speed: 9, health: 10, stamina: 0 }),
      fighter('x', 'enemy', 3, 8),
    ]);
    const next = rest(s)!;
    const a = next.fighters[0]!;
    expect(a.health).toBe(13);
    expect(a.stamina).toBe(0);
    expect(a.resting).toBe(true);
    expect(next.events[0]).toMatchObject({ type: 'rest', healed: 3 });
  });

  it('assess uses the turn and reveals more with more skill', () => {
    const foe = fighter('x', 'enemy', 3, 8, { health: 7 });
    expect(assessFacts(foe, 10)).toEqual(['Health 7 of 20']);
    expect(assessFacts(foe, 60)).toHaveLength(3);
    const s = startBattle([fighter('a', 'party', 3, 1, { speed: 9, assessment: 45 }), foe]);
    const next = assess(s, { x: 3, y: 8 })!;
    expect(next.events[0]).toMatchObject({ type: 'assess', target: 'x' });
    expect(currentFighter(next).id).toBe('x');
  });

  it('retreat is harder with enemies pressing, and a failed attempt uses the turn', () => {
    const s = startBattle([
      fighter('a', 'party', 3, 1, { speed: 9 }),
      fighter('x', 'enemy', 3, 2),
      fighter('y', 'enemy', 4, 2),
    ]);
    expect(retreatChance(s)).toBe(50);
    const failed = flee(s, high)!;
    expect(failed.turn.outcome).toBeUndefined();
    expect(failed.events[0]).toEqual({ type: 'flee', success: false });
    expect(flee(s, low)!.turn.outcome).toBe('fled');
  });
});

describe('enemy morale (manual p. 51)', () => {
  it('a hurt enemy may run, more readily once its leader is down; guards with no retreat factor hold', () => {
    const boss = fighter('boss', 'enemy', 1, 8, { maxHealth: 60, health: 60 });
    const grunt = fighter('g', 'enemy', 3, 8, { health: 5, retreat: 3 });
    const guard = fighter('h', 'enemy', 5, 8, { health: 5 });
    const s = startBattle([fighter('a', 'party', 3, 1), boss, grunt, guard]);
    expect(routChance(s, grunt)).toBe(21);
    expect(routChance(s, guard)).toBe(0);
    const leaderless = { ...s, fighters: s.fighters.map((f) => (f.id === 'boss' ? { ...f, health: 0 } : f)) };
    expect(routChance(leaderless, grunt)).toBe(51);
    expect(routChance(leaderless, guard)).toBe(30);
  });

  it('a routed enemy leaves the field alive, and the fight is won when no enemy remains', () => {
    let s = startBattle(
      [fighter('a', 'party', 3, 1, { speed: 1 }), fighter('x', 'enemy', 3, 8, { speed: 9, health: 2, retreat: 9 })],
      [],
      'enemy',
    );
    s = enemyRetreat(s)!;
    expect(s.fighters[1]!.fled).toBe(true);
    expect(s.turn.outcome).toBe('won');
    const viaAi = enemyTurn(
      startBattle(
        [fighter('a', 'party', 3, 1, { speed: 1 }), fighter('x', 'enemy', 3, 8, { speed: 9, health: 2, retreat: 9 })],
        [],
        'enemy',
      ),
      low,
    );
    expect(viaAi.events[0]).toMatchObject({ type: 'retreat', id: 'x' });
  });
});

describe('poison in a fight (manual p. 51)', () => {
  it('a poisoned fighter loses 2 at the end of each of its turns', () => {
    const s = startBattle([
      fighter('a', 'party', 3, 1, { speed: 9, poisoned: true, stamina: 0 }),
      fighter('x', 'enemy', 3, 8),
    ]);
    const next = defend(s)!;
    expect(next.fighters[0]!.health).toBe(18);
    expect(next.events.some((e) => e.type === 'poison')).toBe(true);
  });
});

describe('the inventory in a fight (manual: opening it uses the turn)', () => {
  it('spends the turn, carrying what items did to the character into the fight', () => {
    const s = startBattle(
      [fighter('party0', 'party', 2, 1, { health: 5, poisoned: true }), fighter('m', 'enemy', 5, 5)],
      [],
      'party',
    );
    expect(currentFighter(s).id).toBe('party0');
    const next = inventoryTurn(s, { health: 50, stamina: 7, poisoned: false })!;
    const me = next.fighters.find((f) => f.id === 'party0')!;
    expect(me.health).toBe(20); // capped at max
    expect(me.stamina).toBe(7);
    expect(me.poisoned).toBe(false);
    expect(currentFighter(next).id).toBe('m');
    expect(next.events.some((e) => e.type === 'inventory')).toBe(true);
    // Nothing used: the turn still goes.
    expect(currentFighter(inventoryTurn(s)!).id).toBe('m');
  });
});
