import { describe, expect, it } from 'vitest';
import { applyCombatPractice, applyWear } from '../src/combat/rewards';
import {
  blessingPercent,
  bonusDamage,
  dullCondition,
  GUARDA_REVANCHE,
  hitScore,
  ItemMod,
  meleeDamage,
  parryValue,
  RaceKind,
  type AttackKind,
  type MeleeStats,
  type Roll,
  type WeaponStats,
} from '../src/combat/rules';
import type { BattleEvent } from '../src/combat/battle';
import { ItemType, type ItemDef } from '../src/formats/objinfo';
import type { PartyState } from '../src/game/party';
import { canCast } from '../src/game/spells';

// Table-driven checks of the combat rules against docs/formats/combat-audit.md (BaKGL's rules).

const weapon = (over: Partial<WeaponStats> = {}): WeaponStats => ({
  strengthSwing: 20,
  strengthThrust: 12,
  accuracySwing: 10,
  accuracyThrust: 30,
  condition: 100,
  race: RaceKind.None,
  ...over,
});
const who = (over: Partial<MeleeStats> = {}): MeleeStats => ({
  melee: 50,
  strength: 10,
  defense: 40,
  race: RaceKind.None,
  ...over,
});
const roll =
  (...values: number[]): Roll =>
  (lo, hi) =>
    Math.min(hi, Math.max(lo, values.shift() ?? lo));

describe('blessings', () => {
  it.each([
    [0, 100],
    [ItemMod.Blessing1, 105],
    [ItemMod.Blessing2, 110],
    [ItemMod.Blessing3, 115],
    [ItemMod.Blessing1 | ItemMod.Blessing3, 115],
    [ItemMod.Flaming, 100],
  ])('modifier byte %i is %i percent', (mods, pct) => expect(blessingPercent(mods)).toBe(pct));

  it('scales the attack score, not the parry floor, by a weapon blessing', () => {
    // (50 + 30) * 110 / 100 = 88, minus parry 10.
    const a = who({ weapon: weapon({ modifiers: ItemMod.Blessing2 }) });
    expect(hitScore(a, who(), 'thrust')).toBe(78);
  });

  it('scales the parry by an armour blessing and keeps an incapacitated defender at 0', () => {
    const armor = { rating: 10, condition: 100, race: RaceKind.None, modifiers: ItemMod.Blessing3 };
    expect(parryValue(who({ defense: 40, armor }))).toBe(11);
    expect(parryValue(who({ defense: 40, armor, incapacitated: true }))).toBe(0);
  });

  it('counts a staff (not condition based) as full condition for accuracy only', () => {
    const staff = weapon({ condition: 50, conditionBased: false });
    expect(hitScore(who({ weapon: staff }), who({ defense: 0 }), 'thrust')).toBe(80);
    expect(meleeDamage(who({ weapon: staff }), 'thrust')).toBe(10 + 6);
  });
});

describe('enchanted and poisoned weapons', () => {
  const armor = (modifiers = 0, poisoned = false) => ({
    rating: 0,
    condition: 100,
    race: RaceKind.None,
    modifiers,
    poisoned,
  });
  const cases: [string, number, boolean, number, boolean, AttackKind, number][] = [
    // name, weapon mods, poisoned weapon, armour mods, poisoned armour, kind, bonus
    ['plain', 0, false, 0, false, 'thrust', 0],
    ['poison', 0, true, 0, false, 'thrust', 10],
    ['poison cancelled by poisoned armour', 0, true, 0, true, 'thrust', 0],
    ['flaming 75% of thrust 12', ItemMod.Flaming, false, 0, false, 'thrust', 9],
    ['steel fire 100% of swing 20', ItemMod.SteelFire, false, 0, false, 'slash', 20],
    ['frost 50% of swing 20', ItemMod.Frost, false, 0, false, 'slash', 10],
    ['enhancement 1 doubles', ItemMod.Enhancement1, false, 0, false, 'thrust', 24],
    ['enhancement 2 is 75%', ItemMod.Enhancement2, false, 0, false, 'thrust', 9],
    ['enchantment replaces poison', ItemMod.Frost, true, 0, false, 'thrust', 6],
    ['same enchantment on armour cancels', ItemMod.Frost, false, ItemMod.Frost, false, 'thrust', 0],
    ['another enchantment on armour does not', ItemMod.Frost, false, ItemMod.Flaming, false, 'thrust', 6],
    ['poisoned armour does not stop an enchantment', ItemMod.Frost, false, 0, true, 'thrust', 6],
  ];
  it.each(cases)('%s', (_n, mods, poisoned, aMods, aPoisoned, kind, bonus) => {
    const w = weapon({ modifiers: mods, poisoned });
    expect(bonusDamage(w, who({ armor: armor(aMods, aPoisoned) }), kind)).toBe(bonus);
  });

  it('adds the bonus after the condition-scaled strength', () => {
    const w = weapon({ condition: 50, modifiers: ItemMod.SteelFire });
    // Strength 10 + 12 * 50% + 12 (steel fire is not scaled by condition).
    expect(meleeDamage(who({ weapon: w }), 'thrust', who())).toBe(10 + 6 + 12);
  });

  it('doubles Guarda Revanche against moredhel only', () => {
    const w = weapon({ index: GUARDA_REVANCHE });
    const base = 10 + 12;
    expect(meleeDamage(who({ weapon: w }), 'thrust', who({ monster: 18 }))).toBe(base * 2);
    expect(meleeDamage(who({ weapon: w }), 'thrust', who({ monster: 21 }))).toBe(base * 2);
    expect(meleeDamage(who({ weapon: w }), 'thrust', who({ monster: 15 }))).toBe(base);
    expect(meleeDamage(who({ weapon: weapon({ index: 3 }) }), 'thrust', who({ monster: 18 }))).toBe(base);
  });
});

describe('dulling', () => {
  const stats = { dullChance: 50, maxDullAmount: 4, minCondition: 0 };
  it.each([
    // roll order: chance (0-99), amount (1..max-1), [crossbow snap 0-49]
    ['no wear when the chance roll is at or above dullChance', 50, 90, [50], 256, false, 90],
    ['full dull loses the rolled amount', 50, 90, [49, 3], 256, false, 87],
    ['a thrust loses half, rounded down', 50, 90, [0, 3], 128, false, 89],
    ['a thrust rolling 1 loses nothing', 50, 90, [0, 1], 128, false, 90],
    ['maxDullAmount 1 always rolls 1', 50, 90, [0], 256, false, 89],
    ['crossbow snaps when the snap roll reaches its new condition', 50, 40, [0, 1, 39], 256, true, 0],
    ['crossbow survives a low snap roll', 50, 40, [0, 1, 10], 256, true, 39],
  ] as const)('%s', (_n, _c, cond, rolls, factor, crossbow, want) => {
    const s = _n.startsWith('maxDullAmount 1') ? { ...stats, maxDullAmount: 1 } : stats;
    expect(dullCondition(cond, s, factor, roll(...rolls), crossbow)).toBe(want);
  });

  it('never drops below the item minimum condition', () => {
    expect(dullCondition(5, { dullChance: 100, maxDullAmount: 9, minCondition: 4 }, 256, roll(0, 8))).toBe(4);
    expect(dullCondition(1, { dullChance: 100, maxDullAmount: 9, minCondition: 0 }, 256, roll(0, 8))).toBe(0);
  });
});

describe('wear from a battle', () => {
  const def = (type: number): ItemDef => ({ type, dullChance: 100, maxDullAmount: 4, minCondition: 0 }) as ItemDef;
  const defs = [def(ItemType.Sword), def(ItemType.Armor), def(ItemType.Staff)];
  const item = (itemIndex: number) => ({
    itemIndex,
    conditionOrQuantity: 90,
    status: 0,
    modifiers: 0,
    activated: false,
    used: false,
    broken: false,
    repairable: false,
    equipped: true,
    poisoned: false,
  });
  const party = (sword = 0) =>
    ({
      gold: 0,
      activeCharacters: [0],
      characters: [{ index: 0, inventory: { capacity: 8, items: [item(sword), item(1)] } }],
    }) as unknown as PartyState;
  const hit = (kind: AttackKind, attacker: string, target: string): BattleEvent =>
    ({ type: 'attack', attacker, target, kind, hit: true, damage: 1, killed: false }) as BattleEvent;
  const high: Roll = (_lo, hi) => hi;

  it('a slash dulls the sword in full, a thrust by half', () => {
    const slashed = applyWear(party(), [hit('slash', 'party0', 'e')], defs, high);
    const thrust = applyWear(party(), [hit('thrust', 'party0', 'e')], defs, high);
    expect(slashed.characters[0]!.inventory.items[0]).toMatchObject({ conditionOrQuantity: 87, used: true });
    expect(thrust.characters[0]!.inventory.items[0]!.conditionOrQuantity).toBe(89);
  });

  it('armour wears on every hit taken, a miss wears nothing, a staff is never dulled', () => {
    const miss = { ...hit('slash', 'e', 'party0'), hit: false } as BattleEvent;
    const worn = applyWear(party(), [hit('thrust', 'e', 'party0'), miss, hit('thrust', 'e', 'party0')], defs, high);
    expect(worn.characters[0]!.inventory.items[1]!.conditionOrQuantity).toBe(84);
    const staff = applyWear(party(2), [hit('slash', 'party0', 'e')], defs, high);
    expect(staff.characters[0]!.inventory.items[0]!.conditionOrQuantity).toBe(90);
  });
});

describe('skill practice from melee', () => {
  const skill = (trueSkill: number) => ({
    max: trueSkill,
    trueSkill,
    current: trueSkill,
    experience: 0,
    modifier: 0,
    selected: false,
    unseenImprovement: false,
  });
  const party = () =>
    ({
      gold: 0,
      activeCharacters: [0, 1],
      characters: [
        { index: 0, skills: { melee: skill(50), strength: skill(40), defense: skill(20) } },
        { index: 1, skills: { melee: skill(50), strength: skill(40), defense: skill(100) } },
      ],
    }) as unknown as PartyState;
  const swing = (attacker: string, target: string, hit: boolean): BattleEvent =>
    ({ type: 'attack', attacker, target, kind: 'thrust', hit, damage: 0, killed: false }) as BattleEvent;
  const xp = (p: PartyState, i: number, name: 'melee' | 'strength' | 'defense') =>
    p.characters[i]!.skills[name].experience;

  it('a hit gives the attacker Melee twice and Strength, the defender Defense once', () => {
    const p = applyCombatPractice(party(), [swing('party0', 'party1', true)]);
    // fraction 3 of the skill: melee 50 -> 1 each time (floor), strength 40 -> 1, defense 100 -> 3.
    expect(xp(p, 0, 'melee')).toBe(2);
    expect(xp(p, 0, 'strength')).toBe(1);
    expect(xp(p, 1, 'defense')).toBe(3);
  });

  it('a miss gives the defender Defense three times and the attacker Melee once', () => {
    const p = applyCombatPractice(party(), [swing('party0', 'party1', false)]);
    expect(xp(p, 0, 'melee')).toBe(1);
    expect(xp(p, 0, 'strength')).toBe(0);
    expect(xp(p, 1, 'defense')).toBe(9);
  });

  it('ignores enemies and counts both sides when the party fights itself', () => {
    const p = applyCombatPractice(party(), [swing('enemy1', 'party0', true), swing('party1', 'enemy1', false)]);
    expect(xp(p, 0, 'defense')).toBe(0); // 20 * 3 / 100 = 0 experience
    expect(xp(p, 1, 'melee')).toBe(1);
  });
});

describe('spell affordability', () => {
  const caster = (health: number, stamina: number, minCost: number) => {
    const sk = (n: number) => ({ max: 50, trueSkill: n, current: n, experience: 0, modifier: 0 });
    return {
      c: { spells: [7], skills: { casting: sk(30), health: sk(health), stamina: sk(stamina) } } as never,
      s: { index: 7, minCost } as never,
    };
  };
  it.each([
    [5, 5, 10, true], // BaKGL: total >= minCost
    [5, 4, 10, false],
    [10, 0, 10, true],
  ])('health %i + stamina %i against minimum cost %i', (h, st, min, ok) => {
    const { c, s } = caster(h, st, min);
    expect(canCast(c, s)).toBe(ok);
  });
});
