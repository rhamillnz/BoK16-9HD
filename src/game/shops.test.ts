import { describe, expect, it } from 'vitest';
import { SKILL_NAMES, type Character, type InventoryItem, type Skill } from '../formats/gam';
import { ContainerFlag, findShop, parseShopContainers, type ShopStats } from '../formats/gdsContainers';
import { ItemType, type ItemDef } from '../formats/objinfo';
import type { PartyState } from './party';
import {
  UNPURCHASEABLE, applyHaggle, buy, buyPrice, canBuyItem, haggle, isRefused, priceOf, sell, sellPrice, ItemFlag,
  type PriceContext, type ShopState,
} from './shops';

// ---- fixtures --------------------------------------------------------------------------------

const stats = (over: Partial<ShopStats> = {}): ShopStats => ({
  templeNumber: 1, sellFactor: 20, maxDiscount: 30, buyFactor: 50, haggleDifficulty: 40, haggleAnnoyance: 50,
  bardingSkill: 0, bardingReward: 0, bardingMaxReward: 0, unknown: 0, innSleepUntilHour: 0, innCost: 0,
  repairTypes: 0, repairFactor: 0, categories: 0x0080, ...over,
});

const item = (itemIndex: number, conditionOrQuantity = 100, modifiers = 0): InventoryItem => ({
  itemIndex, conditionOrQuantity, status: 0, modifiers,
  activated: false, used: false, broken: false, repairable: false, equipped: false, poisoned: false,
});

const DEFS = [] as ItemDef[];
const def = (index: number, o: Partial<ItemDef>) => (DEFS[index] = { index, value: 100, stackSize: 1, defaultStackSize: 1, flags: 0, categories: 0, type: 0, ...o } as ItemDef);
def(1, { name: 'Sword', value: 100, type: ItemType.Sword, categories: 0x0080 });
def(2, { name: 'Armour', value: 200, type: ItemType.Armor, categories: 0x0200 });
def(3, { name: 'Rations', value: 10, type: ItemType.Ration, categories: 0x0002, flags: ItemFlag.Stackable, stackSize: 10, defaultStackSize: 5 });
def(4, { name: 'Key', type: ItemType.Key });
def(5, { name: 'Gambeson', value: 100, flags: ItemFlag.ConditionBased, categories: 0x0080 });
def(133, { name: 'Scroll', type: ItemType.Scroll, categories: 0x1000 });
def(135, { name: 'Brandy', value: 5, flags: ItemFlag.Stackable, stackSize: 5, defaultStackSize: 1 });

const ctx: PriceContext = { scrollValues: [0, 77] };

function skill(max: number, trueSkill: number): Skill {
  return { max, trueSkill, current: 0, experience: 0, modifier: 0, selected: false, unseenImprovement: false };
}
function character(index: number, capacity = 4, haggling = 50): Character {
  const skills = Object.fromEntries(SKILL_NAMES.map((n) => [n, skill(0, 0)])) as Character['skills'];
  skills.health = skill(60, 60);
  skills.haggling = skill(100, haggling);
  return {
    index, name: `C${index}`, unknownHeader: new Uint8Array(2), spellBytes: new Uint8Array(6), spells: [], skills,
    combatCharIndex: 0, unknownTrailer: new Uint8Array(6),
    conditions: { sick: 0, plagued: 0, poisoned: 0, drunk: 0, healing: 0, starving: 0, nearDeath: 0 },
    affectors: [], inventory: { capacity, items: [] },
  };
}
const party = (gold = 1000): PartyState => ({
  gold, characters: [character(0), character(1)], activeCharacters: [0, 1], partyKeys: { capacity: 8, items: [] },
});
const shop = (items: InventoryItem[], s = stats()): ShopState => ({ stats: s, items, capacity: 8, discounts: {} });

/** Rng that returns the given values in turn, then 0. */
const seq = (...v: number[]) => { let i = 0; return () => v[i++] ?? 0; };

// ---- container parsing -----------------------------------------------------------------------

function container(o: { number: number; letter: number; flags: number; items: number[][]; capacity: number; extra?: number[] }): number[] {
  const out = [0, 0, 0, 0, o.number, 0, 0, 0, o.letter, 0, 0, 0, 7, o.items.length, o.capacity, o.flags];
  for (const it of o.items) out.push(...it);
  for (let i = o.items.length; i < o.capacity; i++) out.push(0, 0, 0, 0);
  return [...out, ...(o.extra ?? [])];
}

describe('parseShopContainers', () => {
  const statsBytes = [3, 20, 30, 50, 40, 25, 0, 0, 0, 0, 8, 12, 5, 9, 0x80, 0x02];
  const bytes = new Uint8Array([
    ...container({ number: 2, letter: 2, flags: ContainerFlag.Shop, capacity: 3, items: [[1, 100, 0, 0], [3, 10, 0, 0xe0]], extra: statsBytes }),
    // a container with a lock, a dialog and a time stamp before/after the (absent) shop part
    ...container({ number: 5, letter: 0, flags: ContainerFlag.Lock | ContainerFlag.Dialog | ContainerFlag.Time, capacity: 1, items: [], extra: [1, 2, 3, 4, 0, 0, 0, 0, 0, 0, 9, 9, 9, 9] }),
    ...container({ number: 7, letter: 1, flags: ContainerFlag.Shop | ContainerFlag.Encounter, capacity: 0, items: [], extra: [...statsBytes, 0, 0, 0, 0, 0, 0, 0, 0, 0] }),
  ]);

  it('reads items, skipped slots, optional parts and shop stats', () => {
    const all = parseShopContainers(bytes, 0, 3);
    expect(all.map((c) => `${c.ref.number}${c.ref.letter}`)).toEqual(['2B', '5A', '7A']);
    const s = findShop(all, { number: 2, letter: 'B' })!;
    expect(s.items.map((i) => [i.itemIndex, i.conditionOrQuantity, i.modifiers])).toEqual([[1, 100, 0], [3, 10, 0xe0]]);
    expect(s.stats).toMatchObject({ templeNumber: 3, sellFactor: 20, maxDiscount: 30, buyFactor: 50, haggleDifficulty: 40, haggleAnnoyance: 25, innSleepUntilHour: 8, innCost: 12, repairTypes: 5, repairFactor: 9, categories: 0x0280 });
    expect(all[1]!.stats).toBeUndefined();
    expect(all[2]!.stats?.categories).toBe(0x0280);
  });

  it('returns what it could read when the image ends early', () => {
    expect(parseShopContainers(bytes.slice(0, 60), 0, 3)).toHaveLength(1);
  });
});

// ---- prices ----------------------------------------------------------------------------------

describe('prices', () => {
  const s = stats();
  it('sell price adds the shop factor and scales by quantity and condition', () => {
    expect(sellPrice(item(1), DEFS[1]!, s, 0, ctx)).toBe(120);
    expect(sellPrice(item(3, 10), DEFS[3]!, s, 0, ctx)).toBe(24); // 10 * 1.2 * (10/5)
    expect(sellPrice(item(5, 50), DEFS[5]!, s, 0, ctx)).toBe(60);
  });
  it('blessings raise the value', () => {
    expect(sellPrice(item(1, 100, 1 << 6), DEFS[1]!, s, 0, ctx)).toBe(Math.round(1.2 * 175));
  });
  it('a discount comes off but never below one royal', () => {
    expect(sellPrice(item(1), DEFS[1]!, s, 20, ctx)).toBe(100);
    expect(sellPrice(item(1), DEFS[1]!, s, 500, ctx)).toBe(1);
  });
  it('scrolls cost their spell value', () => {
    expect(sellPrice(item(133, 1), DEFS[133]!, s, 0, ctx)).toBe(77);
  });
  it('the shop pays the buy factor of the sell price, half for armour', () => {
    expect(buyPrice(item(1), DEFS[1]!, s, ctx)).toBe(60);
    expect(buyPrice(item(2), DEFS[2]!, s, ctx)).toBe(Math.round(0.5 * 240) >> 1);
  });
  it('the Romney guild-war factor multiplies by six', () => {
    expect(sellPrice(item(1), DEFS[1]!, s, 0, { ...ctx, romneyGuildWars: true })).toBe(720);
  });
});

// ---- buying and selling ----------------------------------------------------------------------

describe('buy', () => {
  it('pays the price and puts the item with the buyer, leaving stock alone', () => {
    const r = buy(party(), shop([item(1)]), 1, 1, DEFS, ctx);
    expect(r).toMatchObject({ ok: true, price: 120 });
    if (!r.ok) return;
    expect(r.result.party.gold).toBe(880);
    expect(r.result.party.characters[1]!.inventory.items.map((i) => i.itemIndex)).toEqual([1]);
    expect(r.result.party.characters[0]!.inventory.items).toHaveLength(0);
    expect(r.result.shop.items).toHaveLength(1);
  });
  it('buys a default stack of stacking items', () => {
    const r = buy(party(), shop([item(3, 10)]), 3, 0, DEFS, ctx);
    expect(r.ok && r.result.party.characters[0]!.inventory.items[0]!.conditionOrQuantity).toBe(5);
    expect(r.ok && r.price).toBe(12);
  });
  it('refuses when poor, full or too drunk', () => {
    expect(buy(party(5), shop([item(1)]), 1, 0, DEFS, ctx)).toEqual({ ok: false, reason: 'cantAfford' });
    const full = party();
    full.characters[0]!.inventory = { capacity: 1, items: [item(2)] };
    expect(buy(full, shop([item(1)]), 1, 0, DEFS, ctx)).toEqual({ ok: false, reason: 'noRoom' });
    const drunk = party();
    drunk.characters[0]!.conditions.drunk = 100;
    expect(buy(drunk, shop([item(135, 3)]), 135, 0, DEFS, ctx)).toEqual({ ok: false, reason: 'tooDrunk' });
  });
  it('keeps the stocked item modifiers and uses the haggled price once', () => {
    let sh = shop([item(1, 100, 1 << 5)]);
    sh = { ...sh, discounts: { 1: 30 } };
    const r = buy(party(), sh, 1, 0, DEFS, ctx);
    expect(r.ok && r.price).toBe(Math.round(1.2 * 150 - 30));
    expect(r.ok && r.result.party.characters[0]!.inventory.items[0]!.modifiers).toBe(1 << 5);
    expect(r.ok && r.result.shop.discounts).toEqual({});
  });
  it('will not sell an item the shopkeeper has refused', () => {
    const sh = { ...shop([item(1)]), discounts: { 1: UNPURCHASEABLE } };
    expect(isRefused(sh, 1)).toBe(true);
    expect(priceOf(sh, item(1), DEFS[1]!, ctx)).toBeUndefined();
    expect(buy(party(), sh, 1, 0, DEFS, ctx)).toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('sell', () => {
  const owner = (items: InventoryItem[]) => {
    const p = party();
    p.characters[0]!.inventory.items = items;
    return p;
  };
  it('pays the buy price, removes the item and adds it to the shop stock', () => {
    const r = sell(owner([item(5, 50)]), shop([item(1)]), 0, 0, DEFS, ctx);
    expect(r).toMatchObject({ ok: true, price: 30 });
    if (!r.ok) return;
    expect(r.result.party.gold).toBe(1030);
    expect(r.result.party.characters[0]!.inventory.items).toHaveLength(0);
    expect(r.result.shop.items.map((i) => i.itemIndex)).toEqual([1, 5]);
  });
  it('only takes what the shop trades in, and never keys or the only weapon', () => {
    expect(sell(owner([item(2)]), shop([item(1)]), 0, 0, DEFS, ctx)).toEqual({ ok: false, reason: 'wontBuy' });
    expect(sell(owner([item(4)]), shop([item(1)]), 0, 0, DEFS, ctx)).toEqual({ ok: false, reason: 'cantSellKey' });
    expect(sell(owner([{ ...item(1), equipped: true }]), shop([item(1)]), 0, 0, DEFS, ctx)).toEqual({ ok: false, reason: 'onlyWeapon' });
    expect(canBuyItem(shop([item(2)]), item(2), DEFS[2]!)).toBe(true); // already stocked
  });
});

// ---- haggling --------------------------------------------------------------------------------

describe('haggle', () => {
  const sh = shop([item(1)]);
  it('wins a discount when the skill roll beats the shop roll', () => {
    // skill rolls 80,10,10 -> 80; shop rolls 5,5,5 -> 5; margin 75; target (30-20)/2+75 = 80 ... remainder is 0 here
    const r = haggle(sh, DEFS[1]!, 100, seq(80, 10, 10, 5, 5, 5, 60, 10, 10));
    expect(r.outcome).toBe('discount');
    expect(r.percent).toBe(30); // best roll 60 clamps to maxDiscount
    expect(r.discount).toBe(Math.trunc((120 * 30) / 100));
    expect(r.exercised).toBe(true);
    expect(applyHaggle(sh, 1, r).discounts[1]).toBe(36);
  });
  it('fails when the shop rolls higher, and may annoy the shopkeeper', () => {
    expect(haggle(sh, DEFS[1]!, 100, seq(1, 1, 1, 30, 30, 30, 99, 99)).outcome).toBe('failed');
    const r = haggle(sh, DEFS[1]!, 100, seq(1, 1, 1, 30, 30, 30, 99, 10));
    expect(r.outcome).toBe('refused');
    expect(applyHaggle(sh, 1, r).discounts[1]).toBe(UNPURCHASEABLE);
  });
  it('does not haggle where the shop does not, over scrolls, or twice', () => {
    expect(haggle(shop([item(1)], stats({ maxDiscount: 0 })), DEFS[1]!, 100).outcome).toBe('noHaggle');
    expect(haggle(sh, DEFS[133]!, 100).outcome).toBe('scroll');
    const once = { ...sh, discounts: { 1: 10 } };
    expect(['failed', 'refused']).toContain(haggle(once, DEFS[1]!, 100, seq(0, 0, 0)).outcome);
  });
  it('survives a zero skill', () => {
    expect(() => haggle(sh, DEFS[1]!, 0)).not.toThrow();
  });
});
