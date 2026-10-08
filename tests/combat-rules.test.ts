import { describe, expect, it } from 'vitest';
import {
  accuracyBonus,
  applyDamage,
  armorReduction,
  hitScore,
  meleeDamage,
  monsterRace,
  parryValue,
  RaceKind,
  reduceDamage,
  rollFrom,
  rollToHit,
  type MeleeStats,
  type WeaponStats,
} from '../src/combat/rules';

const sword: WeaponStats = {
  strengthSwing: 12,
  strengthThrust: 8,
  accuracySwing: 10,
  accuracyThrust: 20,
  condition: 50,
  race: RaceKind.Human,
};
const fighter = (over: Partial<MeleeStats> = {}): MeleeStats => ({
  melee: 50,
  strength: 10,
  defense: 40,
  race: RaceKind.None,
  ...over,
});
const fixed = (n: number) => () => n;

describe('hit chance', () => {
  it('scales weapon accuracy by race and condition', () => {
    // Human sword in the hands of a race-None wielder: -2%, then half condition.
    expect(accuracyBonus(sword, RaceKind.None, 'thrust')).toBe(Math.trunc((Math.trunc((20 * 98) / 100) * 50) / 100));
    expect(accuracyBonus(sword, RaceKind.Elf, 'thrust')).toBe(Math.trunc((Math.trunc((20 * 98) / 100) * 50) / 100));
    expect(accuracyBonus({ ...sword, race: RaceKind.None }, RaceKind.None, 'slash')).toBe(5);
  });

  it('subtracts Defense / 4 as parry unless the defender cannot act', () => {
    expect(parryValue(fighter({ defense: 40 }))).toBe(10);
    expect(parryValue(fighter({ defense: 40, incapacitated: true }))).toBe(0);
    expect(parryValue(fighter({ defense: 1000 }))).toBe(98);
  });

  it('clamps the score to 2..98', () => {
    expect(hitScore(fighter({ melee: 0 }), fighter({ defense: 400 }), 'thrust')).toBe(2);
    expect(hitScore(fighter({ melee: 500 }), fighter({ defense: 0 }), 'thrust')).toBe(98);
  });

  it('hits when the 0-99 roll is below the score', () => {
    const a = fighter({ melee: 60 });
    const d = fighter({ defense: 40 }); // score 60 - 10 = 50
    expect(hitScore(a, d, 'thrust')).toBe(50);
    expect(rollToHit(a, d, 'thrust', fixed(49))).toBe(true);
    expect(rollToHit(a, d, 'thrust', fixed(50))).toBe(false);
  });

  it('adds 20 to the roll against a defending target', () => {
    const a = fighter({ melee: 60 });
    expect(rollToHit(a, fighter({ defense: 40, defending: true }), 'thrust', fixed(35))).toBe(false);
    expect(rollToHit(a, fighter({ defense: 40 }), 'thrust', fixed(35))).toBe(true);
  });
});

describe('damage', () => {
  it('is Strength plus weapon strength by condition, at least 1', () => {
    expect(meleeDamage(fighter({ strength: 10, weapon: sword }), 'thrust')).toBe(10 + 4);
    expect(meleeDamage(fighter({ strength: 10, weapon: sword }), 'slash')).toBe(10 + 6);
    expect(meleeDamage(fighter({ strength: 0 }), 'thrust')).toBe(1);
  });

  it('is reduced by armour and Defense', () => {
    const none = fighter({ defense: 40 });
    expect(armorReduction(none)).toBe(0);
    const armored = fighter({ defense: 40, armor: { rating: 20, condition: 100, race: RaceKind.None } });
    expect(armorReduction(armored)).toBe(10 + 20);
    expect(reduceDamage(20, armored, fixed(0))).toBe(14);
    const tough = fighter({ defense: 400, armor: { rating: 100, condition: 100, race: RaceKind.None } });
    expect(armorReduction(tough)).toBe(98);
    expect(reduceDamage(1, tough, (lo) => lo)).toBe(1);
    expect(reduceDamage(1, tough, (_, hi) => hi)).toBe(2);
  });

  it('drains stamina first, then health, never below zero', () => {
    expect(applyDamage({ health: 10, stamina: 5 }, 3)).toEqual({ health: 10, stamina: 2 });
    expect(applyDamage({ health: 10, stamina: 5 }, 8)).toEqual({ health: 7, stamina: 0 });
    expect(applyDamage({ health: 10, stamina: 5 }, 99)).toEqual({ health: 0, stamina: 0 });
  });
});

describe('helpers', () => {
  it('rollFrom stays inside the range', () => {
    const r = rollFrom(() => 0.999999);
    expect(r(1, 2)).toBe(2);
    expect(rollFrom(() => 0)(0, 99)).toBe(0);
  });

  it('moredhel and gorath are elves', () => {
    expect(monsterRace(18)).toBe(RaceKind.Elf);
    expect(monsterRace(21)).toBe(RaceKind.Elf);
    expect(monsterRace(3)).toBe(RaceKind.None);
  });
});
