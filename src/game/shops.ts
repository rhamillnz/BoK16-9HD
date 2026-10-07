import { effectiveSkill, type InventoryItem } from '../formats/gam';
import type { ShopContainer, ShopStats } from '../formats/gdsContainers';
import { ItemType, type ItemDef } from '../formats/objinfo';
import { gainRoyals, giveItem, loseRoyals, updateCharacter, type ItemRule, type PartyState } from './party';
import { getFlag, type WorldState } from './state';

/**
 * Shop rules: prices, selling, buying and haggling. Pure functions over party and shop state, with the
 * random source passed in. The formulas follow what docs/formats/shops.md describes (read from BaKGL).
 * Prices are royals (10 royals = 1 sovereign).
 */

/** `ItemDef.flags` bits (docs/formats/items.md). */
export const ItemFlag = {
  Stackable: 0x0800,
  ConditionBased: 0x1000,
  ChargeBased: 0x2000,
  QuantityBased: 0x8000,
} as const;

/** OBJINFO ids with special shop handling. */
export const ITEM_SCROLL = 133;
export const ITEM_BRANDY = 135;
export const ITEM_ALE = 136;

/** Modifier byte bits of the three blessings; a blessed item sells for more. */
const BLESSING_BITS = [
  { bit: 5, percent: 150 },
  { bit: 6, percent: 175 },
  { bit: 7, percent: 200 },
] as const;

/** A haggle discount this large marks the item as no longer for sale. */
export const UNPURCHASEABLE = 0xffffffff;

/** Uniform integer in [0, n). */
export type Rng = (n: number) => number;
export const defaultRng: Rng = (n) => Math.floor(Math.random() * n);

export interface ShopState {
  stats: ShopStats;
  items: InventoryItem[];
  capacity: number;
  /** Haggle discount in royals per item index, for the visit in progress. */
  discounts: Record<number, number>;
}

export function shopFromContainer(c: ShopContainer): ShopState | undefined {
  return c.stats && { stats: c.stats, items: c.items.map((i) => ({ ...i })), capacity: c.capacity, discounts: {} };
}

const hasFlag = (def: ItemDef, f: number) => (def.flags & f) !== 0;

export const ruleOf = (def: ItemDef | undefined): ItemRule | undefined =>
  def && { stackSize: def.stackSize, defaultStackSize: def.defaultStackSize, isKey: def.type === ItemType.Key };

/** How many "base units" of its value an item is worth: quantity over the default stack, or condition percent. */
export function quantityMultiple(item: InventoryItem, def: ItemDef): number {
  if (hasFlag(def, ItemFlag.Stackable) || hasFlag(def, ItemFlag.ChargeBased)) {
    return item.conditionOrQuantity / Math.max(1, def.defaultStackSize);
  }
  if (hasFlag(def, ItemFlag.ConditionBased)) return item.conditionOrQuantity / 100;
  return 1;
}

/** The Romney guild-war price hike: temple 2's shop in zone 3 charges six times while the war flag is set. */
export function isRomneyGuildWars(stats: ShopStats, zone: number, world: WorldState): boolean {
  if (stats.templeNumber !== 2 || zone !== 3) return false;
  return getFlag(world, 0xdc29) && !getFlag(world, 0xdc2a);
}

export interface PriceContext {
  scrollValues: readonly number[];
  romneyGuildWars?: boolean;
}

/** What the shop asks for an item, less `discount` royals off its per-unit price. */
export function sellPrice(item: InventoryItem, def: ItemDef, stats: ShopStats, discount: number, ctx: PriceContext): number {
  const sellFactor = (100 + stats.sellFactor) / 100;
  if (def.type === ItemType.Scroll) return ctx.scrollValues[item.conditionOrQuantity] ?? 0;
  let base = def.value;
  for (const b of BLESSING_BITS) if (item.modifiers & (1 << b.bit)) base = Math.trunc((base * b.percent) / 100);
  if (base <= 0) base = 1;
  const full = sellFactor * base;
  let unit = Math.min(full, Math.max(1, full - discount));
  if (ctx.romneyGuildWars) unit = Math.trunc((unit * 600) / 100);
  return Math.round(unit * quantityMultiple(item, def));
}

/** What the shop pays the party for an item. Armour fetches half. */
export function buyPrice(item: InventoryItem, def: ItemDef, stats: ShopStats, ctx: PriceContext): number {
  const price = Math.round((stats.buyFactor / 100) * sellPrice(item, def, stats, 0, ctx));
  return def.type === ItemType.Armor ? price >> 1 : price;
}

/** The shop takes an item it already stocks or whose category it trades in. */
export function canBuyItem(shop: ShopState, item: InventoryItem, def: ItemDef): boolean {
  return shop.items.some((i) => i.itemIndex === item.itemIndex) || (def.categories & shop.stats.categories) !== 0;
}

/** Quantity of an item a single purchase moves: the default stack for stacking and charged items, else one. */
export function purchaseQuantity(item: InventoryItem, def: ItemDef): number {
  if (hasFlag(def, ItemFlag.Stackable) || hasFlag(def, ItemFlag.ChargeBased)) {
    return Math.min(item.conditionOrQuantity, Math.max(1, def.defaultStackSize));
  }
  return item.conditionOrQuantity;
}

/** The shop item as it would be handed over: stacking items in one default stack, others as stocked. */
export function offeredItem(item: InventoryItem, def: ItemDef): InventoryItem {
  return { ...item, conditionOrQuantity: purchaseQuantity(item, def) };
}

// ---- haggling --------------------------------------------------------------------------------

export interface HaggleResult {
  /** `'refused'`: the shopkeeper is annoyed and will no longer sell the item. */
  outcome: 'discount' | 'failed' | 'refused' | 'noHaggle' | 'alreadyHaggled' | 'scroll';
  /** Royals off one unit. */
  discount: number;
  percent: number;
  /** The party exercised its Haggling skill (the caller applies the practice rules). */
  exercised: boolean;
}

/** Best of three rolls in [0, skill), as the original does so higher skill pulls ahead. */
function bestOfThree(skill: number, rng: Rng): number {
  const s = Math.max(1, Math.trunc(skill));
  let best = 0;
  for (let i = 0; i < 3; i++) best = Math.max(best, rng(0x1000) % s);
  return best;
}

/**
 * One attempt to haggle over `def`. A discount can be had once per item per visit; asking again only risks
 * annoying the shop. Skill is the effective Haggling of the character doing the talking.
 */
export function haggle(shop: ShopState, def: ItemDef, skill: number, rng: Rng = defaultRng): HaggleResult {
  const none = (outcome: HaggleResult['outcome']): HaggleResult => ({ outcome, discount: 0, percent: 0, exercised: false });
  if (def.index === ITEM_SCROLL) return none('scroll');
  const stats = shop.stats;
  if (stats.maxDiscount === 0) return none('noHaggle');

  const fail = (skillRoll: number): HaggleResult => {
    const exercised = rng(0x1000) % 100 < Math.trunc((100 - skillRoll) / 5);
    const annoyed = rng(0x1000) % 100 < stats.haggleAnnoyance;
    return { outcome: annoyed ? 'refused' : 'failed', discount: annoyed ? UNPURCHASEABLE : 0, percent: 0, exercised };
  };
  if ((shop.discounts[def.index] ?? 0) !== 0) return fail(1);

  const scaled = (stats.sellFactor + 100) * def.value;
  const basic = Math.trunc(scaled / 100);
  const remainder = scaled % 100;
  const skillRoll = bestOfThree(skill, rng);
  const margin = Math.max(0, Math.min(skillRoll - bestOfThree(stats.haggleDifficulty, rng), skillRoll));
  if (margin <= 0) return fail(skillRoll);

  const target = ((stats.maxDiscount - remainder) >> 1) + margin;
  const percent = Math.max(0, Math.min(bestOfThree(target, rng), stats.maxDiscount));
  return { outcome: 'discount', discount: Math.trunc((basic * percent) / 100), percent, exercised: true };
}

/** Record a haggle result on the shop (a refusal is stored as an unpurchaseable price). */
export function applyHaggle(shop: ShopState, itemIndex: number, r: HaggleResult): ShopState {
  if (r.outcome !== 'discount' && r.outcome !== 'refused') return shop;
  return { ...shop, discounts: { ...shop.discounts, [itemIndex]: r.discount } };
}

export const isRefused = (shop: ShopState, itemIndex: number) => shop.discounts[itemIndex] === UNPURCHASEABLE;

// ---- transactions ----------------------------------------------------------------------------

export type Refusal = 'unavailable' | 'tooDrunk' | 'cantAfford' | 'noRoom' | 'wontBuy' | 'onlyWeapon' | 'cantSellKey';

export interface Transaction {
  party: PartyState;
  shop: ShopState;
}

function actualPrice(shop: ShopState, item: InventoryItem, def: ItemDef, ctx: PriceContext): number {
  return sellPrice(item, def, shop.stats, shop.discounts[item.itemIndex] ?? 0, ctx);
}

/** Price the party would pay for the offered quantity of the stocked item (a refused item has none). */
export function priceOf(shop: ShopState, item: InventoryItem, def: ItemDef, ctx: PriceContext): number | undefined {
  if (isRefused(shop, item.itemIndex)) return undefined;
  return actualPrice(shop, offeredItem(item, def), def, ctx);
}

/** Give an item to `who` only (never to another character); `lost` when there is no room. */
function giveTo(party: PartyState, who: number, itemIndex: number, quantity: number, def: ItemDef): { party: PartyState; lost: boolean } {
  const r = giveItem({ ...party, activeCharacters: [who] }, itemIndex, quantity, ruleOf(def), who);
  return { party: { ...r.party, activeCharacters: party.activeCharacters }, lost: r.lost };
}

/** Can character `who` take the item (a free slot or room in a stack)? */
export function canCarry(party: PartyState, who: number, item: InventoryItem, def: ItemDef): boolean {
  return !giveTo(party, who, item.itemIndex, def.stackSize > 1 ? item.conditionOrQuantity : 1, def).lost;
}

/** Buy the stocked item for character `who`. Shops never run out of stock. */
export function buy(
  party: PartyState, shop: ShopState, itemIndex: number, who: number, defs: readonly ItemDef[], ctx: PriceContext,
): { ok: true; result: Transaction; price: number } | { ok: false; reason: Refusal } {
  const def = defs[itemIndex];
  const stocked = shop.items.find((i) => i.itemIndex === itemIndex);
  if (!def || !stocked || isRefused(shop, itemIndex)) return { ok: false, reason: 'unavailable' };
  const c = party.characters.find((x) => x.index === who);
  if (!c) return { ok: false, reason: 'unavailable' };
  if ((itemIndex === ITEM_BRANDY || itemIndex === ITEM_ALE) && c.conditions.drunk >= 100) return { ok: false, reason: 'tooDrunk' };
  const offered = offeredItem(stocked, def);
  const price = actualPrice(shop, offered, def, ctx);
  const stacking = def.stackSize > 1;
  const given = giveTo(party, who, itemIndex, stacking ? offered.conditionOrQuantity : 1, def);
  if (given.lost) return { ok: false, reason: 'noRoom' };
  if (party.gold < price) return { ok: false, reason: 'cantAfford' };
  // Keep the stocked item's status and modifiers on the bought one (blessings, condition).
  const bought = carryOver(given.party, who, itemIndex, stocked, stacking);
  const paid = loseRoyals(bought, price);
  const discounts = { ...shop.discounts };
  delete discounts[itemIndex];
  return { ok: true, price, result: { party: paid, shop: { ...shop, discounts } } };
}

/** Copy modifiers (and for single items the condition) of the stocked item onto the newly given one. */
function carryOver(p: PartyState, who: number, itemIndex: number, stocked: InventoryItem, stack: boolean): PartyState {
  return updateCharacter(p, who, (c) => {
    const items = c.inventory.items.slice();
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]!;
      if (it.itemIndex !== itemIndex || it.equipped) continue;
      items[i] = { ...it, conditionOrQuantity: stocked.conditionOrQuantity > 0 && !stack ? stocked.conditionOrQuantity : it.conditionOrQuantity, modifiers: stocked.modifiers, status: stocked.status, broken: stocked.broken, repairable: stocked.repairable, poisoned: stocked.poisoned };
      break;
    }
    return { ...c, inventory: { ...c.inventory, items } };
  });
}

/** Sell the item at slot `slot` of character `who`'s inventory to the shop. */
export function sell(
  party: PartyState, shop: ShopState, who: number, slot: number, defs: readonly ItemDef[], ctx: PriceContext,
): { ok: true; result: Transaction; price: number } | { ok: false; reason: Refusal } {
  const c = party.characters.find((x) => x.index === who);
  const item = c?.inventory.items[slot];
  const def = item && defs[item.itemIndex];
  if (!c || !item || !def) return { ok: false, reason: 'unavailable' };
  if (def.type === ItemType.Key) return { ok: false, reason: 'cantSellKey' };
  if (item.equipped && (def.type === ItemType.Sword || def.type === ItemType.Staff)) return { ok: false, reason: 'onlyWeapon' };
  if (!canBuyItem(shop, item, def)) return { ok: false, reason: 'wontBuy' };
  const price = buyPrice(item, def, shop.stats, ctx);
  const items = c.inventory.items.filter((_, i) => i !== slot);
  let next = updateCharacter(party, who, (x) => ({ ...x, inventory: { ...x.inventory, items } }));
  next = gainRoyals(next, price);
  return { ok: true, price, result: { party: next, shop: { ...shop, items: addToShop(shop, { ...item, equipped: false }, def) } } };
}

/** Sold items join the shop's stock; stackable ones merge into an existing stack. Full shops take nothing more. */
function addToShop(shop: ShopState, item: InventoryItem, def: ItemDef): InventoryItem[] {
  const stackable = hasFlag(def, ItemFlag.Stackable);
  const items = shop.items.map((i) => ({ ...i }));
  const same = stackable ? items.find((i) => i.itemIndex === item.itemIndex && i.conditionOrQuantity < def.stackSize) : undefined;
  if (same) {
    same.conditionOrQuantity = Math.min(def.stackSize, same.conditionOrQuantity + item.conditionOrQuantity);
    return items;
  }
  if (shop.items.some((i) => i.itemIndex === item.itemIndex)) return items; // already stocked: infinite stock stays one entry
  if (shop.capacity > 0 && items.length >= shop.capacity) return items;
  return [...items, item];
}

/** The haggling skill of a character as the game would use it. */
export function haggleSkill(party: PartyState, who: number): number {
  const c = party.characters.find((x) => x.index === who);
  return c ? effectiveSkill(c, 'haggling') : 0;
}
