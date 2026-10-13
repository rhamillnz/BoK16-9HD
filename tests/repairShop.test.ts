import { describe, expect, it } from 'vitest';
import type { InventoryItem } from '../src/formats/gam';
import type { ShopStats } from '../src/formats/gdsContainers';
import { ItemType, type ItemDef } from '../src/formats/objinfo';
import { BESSY_MAULER, canShopRepair, needsRepair, repairCost, repaired } from '../src/game/repairShop';

const def = (type: number, value = 200) => ({ type, value }) as ItemDef;
const item = (over: Partial<InventoryItem> = {}): InventoryItem => ({
  itemIndex: 1,
  conditionOrQuantity: 60,
  status: 0,
  modifiers: 0,
  activated: false,
  used: false,
  broken: false,
  repairable: true,
  equipped: false,
  poisoned: false,
  ...over,
});
const stats = (repairTypes: number, repairFactor = 50) => ({ repairTypes, repairFactor }) as ShopStats;

describe('repair shops', () => {
  it('mend the kinds of item their bits allow', () => {
    expect(canShopRepair(def(ItemType.Sword), stats(1))).toBe(true);
    expect(canShopRepair(def(ItemType.Armor), stats(1))).toBe(false);
    expect(canShopRepair(def(ItemType.Armor), stats(2))).toBe(true);
    expect(canShopRepair(def(ItemType.Crossbow), stats(4))).toBe(true);
    expect(canShopRepair(def(ItemType.Key), stats(7))).toBe(false);
  });

  it('price by value, factor and damage; crossbows are flat', () => {
    expect(repairCost(item(), def(ItemType.Sword, 200), stats(1, 50))).toBe(40); // 200 * 50 * 40 / 10000
    expect(repairCost(item(), def(ItemType.Crossbow), stats(4))).toBe(400);
    expect(repairCost(item({ itemIndex: BESSY_MAULER }), def(ItemType.Crossbow), stats(4))).toBe(800);
  });

  it('only take worn or broken items and return them as new', () => {
    expect(needsRepair(item({ repairable: false }))).toBe(true);
    expect(needsRepair(item({ conditionOrQuantity: 100 }))).toBe(false);
    expect(needsRepair(item({ conditionOrQuantity: 100, broken: true }))).toBe(true);
    const fixed = repaired(item({ broken: true, status: 0xff }));
    expect(fixed).toMatchObject({ conditionOrQuantity: 100, repairable: false, broken: false });
    expect(needsRepair(fixed)).toBe(false);
    expect(fixed.status & 0xff).not.toBe(0xff);
  });
});
