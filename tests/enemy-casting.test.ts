import { describe, expect, it } from 'vitest';
import { enemyTurn } from '../src/combat/ai';
import { startBattle, type Fighter } from '../src/combat/battle';
import { Direction } from '../src/combat/grid';
import { monsterSpells, MONSTER_CASTER_SKILL } from '../src/combat/roster';
import { RaceKind } from '../src/combat/rules';
import { SpellCalc, type SpellDef } from '../src/formats/spells';

const spell = (o: Partial<SpellDef>): SpellDef => ({
  index: 0,
  name: 'S',
  minCost: 2,
  maxCost: 6,
  combat: true,
  targeting: 0,
  calc: SpellCalc.CostTimesDamage,
  damage: 2,
  duration: 0,
  ...o,
});
const FIRE = spell({ index: 7, name: 'Fire' });
const BOLT = spell({ index: 9, name: 'Bolt', minCost: 30, maxCost: 40 });
const MEND = spell({ index: 8, name: 'Mend', combat: false, targeting: 2, calc: SpellCalc.FixedAmount, damage: 9 });
const fighter = (id: string, side: 'party' | 'enemy', x: number, y: number, o: Partial<Fighter> = {}): Fighter => ({
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
  ...o,
});
const low = (lo: number) => lo;

describe('monsterSpells', () => {
  it('gives nothing below the caster skill and the affordable spells above it', () => {
    expect(monsterSpells(MONSTER_CASTER_SKILL - 1, [FIRE])).toEqual([]);
    expect(monsterSpells(MONSTER_CASTER_SKILL, [FIRE, BOLT, MEND]).map((d) => d.name)).toEqual(['Fire', 'Mend']);
    expect(monsterSpells(MONSTER_CASTER_SKILL, [BOLT]).map((d) => d.name)).toEqual(['Bolt']);
    expect(monsterSpells(90, [spell({ index: 1, objectRequired: 3 })])).toEqual([]);
  });
});

describe('enemy casting', () => {
  const mage = (o: Partial<Fighter> = {}) => fighter('x', 'enemy', 3, 7, { speed: 9, spells: [FIRE, MEND], ...o });

  it('casts a damage spell from stamina at range instead of walking', () => {
    const s = startBattle([fighter('a', 'party', 3, 1, { speed: 1 }), mage()]);
    const e = enemyTurn({ ...s, turn: { ...s.turn, current: 1 } }, low);
    expect(e.events[0]).toMatchObject({ type: 'cast', caster: 'x', target: 'a', kind: 'damage' });
    const x = e.fighters.find((f) => f.id === 'x')!;
    expect(x.health).toBe(20);
    expect(x.stamina).toBeLessThan(10);
  });

  it('heals a badly hurt ally before attacking', () => {
    const s = startBattle([
      fighter('a', 'party', 3, 1, { speed: 1 }),
      mage(),
      fighter('y', 'enemy', 4, 7, { speed: 1, health: 5 }),
    ]);
    const e = enemyTurn({ ...s, turn: { ...s.turn, current: 1 } }, low);
    expect(e.events[0]).toMatchObject({ type: 'cast', kind: 'heal', target: 'y' });
  });

  it('never casts below its minimum, so a spent caster falls back to other moves', () => {
    const s = startBattle([fighter('a', 'party', 3, 1, { speed: 1 }), mage({ stamina: 1 })]);
    const e = enemyTurn({ ...s, turn: { ...s.turn, current: 1 } }, low);
    expect(e.events[0]!.type).not.toBe('cast');
  });
});
