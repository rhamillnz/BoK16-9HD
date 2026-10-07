import { CONDITION_NAMES, effectiveSkill, type Character, type InventoryItem } from '../formats/gam';
import type { ShopStats } from '../formats/gdsContainers';
import { ItemType, type ItemDef } from '../formats/objinfo';
import { addCondition, loseRoyals, updateCharacter, type PartyState } from './party';
import { getFlag, setFlag, type WorldState } from './state';

/**
 * Temple rules: curing, blessing items and the teleport network. Pure functions over `PartyState` and
 * `WorldState`. Derived from reading BaKGL (`bak/temple.cpp`, `gui/temple/*`, `gui/teleportScreen.cpp`);
 * see docs/formats/temples.md. Money is counted in royals.
 */

export const TEMPLE_OF_SUNG = 4;
export const CHAPEL_OF_ISHAP = 12;
export const TEMPLE_COUNT = 12;

/** Event flag of temple n (1..12) having been visited: the teleport network only lists seen temples. */
export const TEMPLE_SEEN_FLAG = 0x1950;
/** Chapter 6: the Chapel of Ishap cannot be used for teleporting until this flag is set. */
export const PANTATHIANS_FLAG = 0x1ed4;

/** Dialogue keys the temple screens play. */
export const TEMPLE_DIALOG = {
  main: 0x13d668,
  healCantHealNotSick: 0x13d66b,
  healCantAfford: 0x13d66c,
  healCost: 0x13d66d,
  healPostHealing: 0x13d66e,
  healCantHealNotSickEnough: 0x13d673,
  blessItemAlreadyBlessed: 0x13d66f,
  blessCost: 0x13d670,
  blessCantBless: 0x13d671,
  teleportIntro: 0x13d65d,
  teleportCantAfford: 0x13d65e,
  teleportNoDestinations: 0x13d65f,
  teleportPost: 0x13d660,
  teleportCancel: 0x13d661,
  teleportSameTemple: 0x13d674,
  teleportBlockedDestination: 0x493fd,
  teleportBlockedSource: 0x493fe,
} as const;

/** Query values of the temple's main menu (KEYWORD.DAT indices). */
export const TEMPLE_CHOICE = { done: 268, talk: 269, bless: 271, cure: 272 } as const;
/** Query values of the bless confirmation dialogue: 260 accepts, 256 is the "remove old blessing" yes. */
export const BLESS_ACCEPT = 260;
export const UNBLESS_ACCEPT = 256;

/** Cost per point of each condition, in ConditionName order; Healing is never charged. */
const CONDITION_COST = [4, 10, 10, 3, 0, 2, 30] as const;
const HEALING_INDEX = CONDITION_NAMES.indexOf('healing');

/** Health and stamina pool as the cure sees it: `current` uses effective skills, `max` the stored caps. */
function healthPool(c: Character): { current: number; max: number } {
  return {
    current: effectiveSkill(c, 'health') + effectiveSkill(c, 'stamina'),
    max: effectiveSkill(c, 'health', 'max') + effectiveSkill(c, 'stamina', 'max'),
  };
}

/**
 * What curing one character costs in royals. Each ailing condition adds `value * rate + 10`, the sum is scaled
 * by the temple's cure factor percent, and the Temple of Sung also charges one royal for every missing point
 * of health and stamina (it restores those too).
 */
export function cureCost(c: Character, cureFactor: number, templeNumber: number): number {
  let total = 0;
  CONDITION_NAMES.forEach((name, i) => {
    const value = c.conditions[name];
    if (i !== HEALING_INDEX && value > 0) total += value * CONDITION_COST[i]! + 10;
  });
  total = Math.trunc((total * cureFactor) / 100);
  if (templeNumber === TEMPLE_OF_SUNG) {
    const { current, max } = healthPool(c);
    total += max - current;
  }
  return Math.max(0, total);
}

/**
 * Cure one character: every condition is cleared, Healing is raised by 20, and the Temple of Sung also
 * restores health and stamina in full and sets Healing to the maximum.
 */
export function cureCharacter(c: Character, templeNumber: number): Character {
  let next = c;
  for (const name of CONDITION_NAMES) next = addCondition(next, name, name === 'healing' ? 20 : -100);
  if (templeNumber === TEMPLE_OF_SUNG) {
    const { health, stamina } = next.skills;
    next = {
      ...next,
      skills: { ...next.skills, health: { ...health, trueSkill: health.max }, stamina: { ...stamina, trueSkill: stamina.max } },
    };
    next = addCondition(next, 'healing', 100);
  }
  return next;
}

/** Characters (party order) that a visit could cure, with what each would pay. */
export function cureQuotes(party: PartyState, cureFactor: number, templeNumber: number): { character: Character; cost: number }[] {
  return party.activeCharacters.flatMap((i) => {
    const character = party.characters.find((c) => c.index === i);
    return character ? [{ character, cost: cureCost(character, cureFactor, templeNumber) }] : [];
  });
}

export type CureResult = { ok: true; party: PartyState; cost: number } | { ok: false; reason: 'cannotAfford' | 'nothingToCure' };

/** Pay for and apply a cure. */
export function applyCure(party: PartyState, characterIndex: number, cureFactor: number, templeNumber: number): CureResult {
  const c = party.characters.find((x) => x.index === characterIndex);
  const cost = c ? cureCost(c, cureFactor, templeNumber) : 0;
  if (!c || cost === 0) return { ok: false, reason: 'nothingToCure' };
  if (cost > party.gold) return { ok: false, reason: 'cannotAfford' };
  return { ok: true, cost, party: updateCharacter(loseRoyals(party, cost), characterIndex, (x) => cureCharacter(x, templeNumber)) };
}

// ---- Blessings -----------------------------------------------------------------------------------------

/** Blessing levels are item modifier bits 5, 6 and 7. */
const BLESSING_BITS = [0x20, 0x40, 0x80] as const;
const BLESSING_MASK = 0xe0;

export const isBlessed = (item: Pick<InventoryItem, 'modifiers'>): boolean => (item.modifiers & BLESSING_MASK) !== 0;

/** Only weapons (swords) and armour can be blessed. */
export const canBless = (def: Pick<ItemDef, 'type'>): boolean => def.type === ItemType.Sword || def.type === ItemType.Armor;

/** The blessing a temple gives: its blessing level (1 to 3) picks the modifier bit. */
export function blessingBit(shop: Pick<ShopStats, 'buyFactor'>): number {
  return BLESSING_BITS[Math.min(2, Math.max(0, shop.buyFactor - 1))]!;
}

/** Price in royals: ten times the temple's fixed cost plus a percentage of the item's value. */
export function blessPrice(def: Pick<ItemDef, 'value'>, shop: Pick<ShopStats, 'sellFactor' | 'maxDiscount'>): number {
  return Math.max(1, shop.sellFactor * 10 + Math.trunc((def.value * shop.maxDiscount) / 100));
}

/** Blessing replaces any earlier one. */
export function blessedModifiers(modifiers: number, shop: Pick<ShopStats, 'buyFactor'>): number {
  return (modifiers & ~BLESSING_MASK) | blessingBit(shop);
}

export type BlessResult =
  | { ok: true; party: PartyState; cost: number }
  | { ok: false; reason: 'cannotBless' | 'cannotAfford' | 'noSuchItem' };

/** Pay for and apply a blessing to the item at `slot` of a character's inventory. */
export function applyBlessing(
  party: PartyState,
  characterIndex: number,
  slot: number,
  items: readonly ItemDef[],
  shop: ShopStats,
): BlessResult {
  const c = party.characters.find((x) => x.index === characterIndex);
  const item = c?.inventory.items[slot];
  const def = item && items[item.itemIndex];
  if (!c || !item || !def) return { ok: false, reason: 'noSuchItem' };
  if (!canBless(def)) return { ok: false, reason: 'cannotBless' };
  const cost = blessPrice(def, shop);
  if (cost > party.gold) return { ok: false, reason: 'cannotAfford' };
  const paid = loseRoyals(party, cost);
  const blessed = updateCharacter(paid, characterIndex, (x) => ({
    ...x,
    inventory: {
      ...x.inventory,
      items: x.inventory.items.map((it, i) => (i === slot ? { ...it, modifiers: blessedModifiers(it.modifiers, shop) } : it)),
    },
  }));
  return { ok: true, party: blessed, cost };
}

// ---- Teleporting -------------------------------------------------------------------------------------------

/**
 * Cost in royals of travelling between two temples whose spots on the teleport map are `src` and `dst`
 * (REQ_TELE.DAT pixels): the longer axis plus 3/8 of the shorter, scaled by the source temple's multiplier
 * and constant, rounded to whole royals.
 */
export function teleportCost(
  src: { x: number; y: number },
  dst: { x: number; y: number },
  multiplier: number,
  constant: number,
): number {
  const dx = Math.abs(Math.trunc(src.x - dst.x));
  const dy = Math.abs(Math.trunc(src.y - dst.y));
  const distance = Math.max(dx, dy) + Math.trunc((Math.min(dx, dy) * 3) / 8);
  const scaled = (distance * multiplier + constant) * 10;
  return Math.trunc((scaled + 5) / 10);
}

export const templeSeen = (w: WorldState, temple: number): boolean => getFlag(w, TEMPLE_SEEN_FLAG + temple);
export const markTempleSeen = (w: WorldState, temple: number): WorldState => (templeSeen(w, temple) ? w : setFlag(w, TEMPLE_SEEN_FLAG + temple, true));

/** Temples (1..12) the party has visited. */
export function seenTemples(w: WorldState): number[] {
  const out: number[] = [];
  for (let t = 1; t <= TEMPLE_COUNT; t++) if (templeSeen(w, t)) out.push(t);
  return out;
}

/** Teleporting needs at least two known temples. */
export const canTeleportAnywhere = (w: WorldState): boolean => seenTemples(w).length > 1;

/** In chapter 6 the Chapel of Ishap is closed to teleporting (either end) until the Pantathians event. */
export function teleportBlocked(w: WorldState, temple: number): boolean {
  return w.chapter === 6 && temple === CHAPEL_OF_ISHAP && !getFlag(w, PANTATHIANS_FLAG);
}
