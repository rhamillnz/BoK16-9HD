import { describe, expect, it } from 'vitest';
import {
  HitFlag,
  hitEffect,
  ItemMod,
  MONSTER_RESISTANCE,
  RaceKind,
  monsterDamage,
  resistsPoison,
  weaponHitFlags,
  type WeaponStats,
} from '../src/combat/rules';

const sword = (over: Partial<WeaponStats> = {}): WeaponStats => ({
  strengthSwing: 10,
  strengthThrust: 10,
  accuracySwing: 0,
  accuracyThrust: 0,
  condition: 100,
  race: RaceKind.Human,
  ...over,
});

describe('monster resistances (the original table)', () => {
  it('has one entry per monster index', () => {
    expect(MONSTER_RESISTANCE).toHaveLength(64);
  });

  it('spiders and scorpions shrug off poison (manual), not plain steel', () => {
    for (const m of [39, 44]) {
      expect(resistsPoison(m)).toBe(true);
      expect(monsterDamage(m, weaponHitFlags(sword({ poisoned: true })), 20)).toBe(10);
      expect(monsterDamage(m, weaponHitFlags(sword()), 20)).toBe(20);
    }
  });

  it('spirits, undead, trolls and the Dread take half from any weapon', () => {
    for (const m of [22, 26, 48, 49, 56, 57, 61]) expect(monsterDamage(m, weaponHitFlags(sword()), 20)).toBe(10);
    expect(monsterDamage(53, weaponHitFlags(sword()), 20)).toBe(20); // goblin
  });

  it('the Rime Giant resists frost; the Servitor resists fire but frost does half again', () => {
    const frost = weaponHitFlags(sword({ modifiers: ItemMod.Frost }));
    const fire = weaponHitFlags(sword({ modifiers: ItemMod.Flaming }));
    expect(monsterDamage(33, frost, 20)).toBe(10);
    expect(monsterDamage(28, fire, 20)).toBe(10);
    expect(monsterDamage(28, frost, 20)).toBe(30);
  });

  it('a staff blow carries no enchantment or poison', () => {
    expect(weaponHitFlags(sword({ poisoned: true, modifiers: ItemMod.Frost }), true)).toBe(HitFlag.Weapon);
  });
});

describe('enchanted blows show on the target (manual)', () => {
  it('maps each enchantment to its effect', () => {
    expect(hitEffect(sword({ poisoned: true }))).toBe('poison');
    expect(hitEffect(sword({ modifiers: ItemMod.Flaming }))).toBe('flame');
    expect(hitEffect(sword({ modifiers: ItemMod.SteelFire }))).toBe('flame');
    expect(hitEffect(sword({ modifiers: ItemMod.Frost }))).toBe('frost');
    expect(hitEffect(sword({ modifiers: ItemMod.Blessing1 }))).toBe('blessed');
    expect(hitEffect(sword({ modifiers: ItemMod.Blessing2 }))).toBe('holy');
    expect(hitEffect(sword())).toBeUndefined();
    expect(hitEffect(sword({ modifiers: ItemMod.Frost }), true)).toBeUndefined();
  });
});
