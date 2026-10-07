import {
  CONDITION_NAMES,
  type Character,
  type ConditionName,
  type GamSave,
  type InventoryItem,
} from '../formats/gam';

/**
 * Mutable-by-replacement party state: money, characters and their inventories. Every function
 * returns a new `PartyState` and leaves its input untouched, like `WorldState` in state.ts.
 * Item and character rules follow what the dialogue actions need (see dialogEffects.ts).
 */
export type PartyState = Pick<GamSave, 'gold' | 'characters' | 'activeCharacters' | 'partyKeys'>;

/** OBJINFO item indices that stand for money rather than a real item. */
export const ITEM_SOVEREIGNS = 53;
export const ITEM_ROYALS = 54;
/** One sovereign is ten royals; `gold` in the save is counted in royals. */
export const ROYALS_PER_SOVEREIGN = 10;

/** What the party needs to know about an item definition (a subset of ItemDef). */
export interface ItemRule {
  stackSize: number;
  defaultStackSize: number;
  /** ItemType.Key items go to the shared key ring. */
  isKey: boolean;
}

export function partyFromSave(save: PartyState): PartyState {
  return {
    gold: save.gold,
    characters: save.characters,
    activeCharacters: [...save.activeCharacters],
    partyKeys: save.partyKeys,
  };
}

export function gainRoyals(p: PartyState, royals: number): PartyState {
  return { ...p, gold: p.gold + Math.max(0, royals) };
}

/** Money never goes below zero, like the original. */
export function loseRoyals(p: PartyState, royals: number): PartyState {
  return { ...p, gold: Math.max(0, p.gold - Math.max(0, royals)) };
}

export function updateCharacter(p: PartyState, index: number, f: (c: Character) => Character): PartyState {
  const characters = p.characters.map((c) => (c.index === index ? f(c) : c));
  return { ...p, characters };
}

/** The active characters, in party order, that exist in the save. */
export function activeCharacters(p: PartyState): Character[] {
  return p.activeCharacters.flatMap((i) => p.characters.filter((c) => c.index === i));
}

function newItem(itemIndex: number, quantity: number, rule: ItemRule | undefined): InventoryItem {
  const stackable = (rule?.stackSize ?? 1) > 1;
  return {
    itemIndex,
    conditionOrQuantity: stackable ? Math.min(quantity, 255) : 100,
    status: 0, modifiers: 0,
    activated: false, used: false, broken: false, repairable: false, equipped: false, poisoned: false,
  };
}

/** Add to an existing stack of the same item first, then into a free slot. Returns undefined when full. */
function addToCharacter(c: Character, itemIndex: number, quantity: number, rule: ItemRule | undefined): Character | undefined {
  const stackSize = rule?.stackSize ?? 1;
  let left = quantity;
  const items = c.inventory.items.map((it) => {
    if (stackSize <= 1 || left <= 0 || it.itemIndex !== itemIndex || it.equipped) return it;
    const room = stackSize - it.conditionOrQuantity;
    if (room <= 0) return it;
    const add = Math.min(room, left);
    left -= add;
    return { ...it, conditionOrQuantity: it.conditionOrQuantity + add };
  });
  const copies = stackSize > 1 ? Math.ceil(left / stackSize) : left > 0 ? left : 0;
  for (let i = 0; i < copies; i++) {
    if (items.length >= c.inventory.capacity) return undefined;
    const q = Math.min(stackSize, left);
    items.push(newItem(itemIndex, q, rule));
    left -= q;
  }
  return { ...c, inventory: { ...c.inventory, items } };
}

/**
 * Give an item to the party: money items add to the purse, keys go to the key ring, anything else
 * to `preferred` (when active) and then to the first active character with room.
 * When nobody has room the item is dropped and `lost` is true.
 */
export function giveItem(
  p: PartyState,
  itemIndex: number,
  quantity: number,
  rule: ItemRule | undefined,
  preferred?: number,
): { party: PartyState; lost: boolean } {
  if (itemIndex === ITEM_SOVEREIGNS) return { party: gainRoyals(p, quantity * ROYALS_PER_SOVEREIGN), lost: false };
  if (itemIndex === ITEM_ROYALS) return { party: gainRoyals(p, quantity), lost: false };
  if (rule?.isKey) {
    const keys = p.partyKeys;
    const items = [...keys.items, newItem(itemIndex, 1, rule)];
    return { party: { ...p, partyKeys: { ...keys, items } }, lost: false };
  }
  const order = activeCharacters(p).map((c) => c.index);
  if (preferred !== undefined && order.includes(preferred)) order.unshift(preferred);
  for (const index of order) {
    const c = p.characters.find((x) => x.index === index)!;
    const next = addToCharacter(c, itemIndex, Math.max(1, quantity), rule);
    if (next) return { party: updateCharacter(p, index, () => next), lost: false };
  }
  return { party: p, lost: true };
}

/** Remove `quantity` of an item (money items come off the purse); stops quietly when there is less. */
export function removeItem(p: PartyState, itemIndex: number, quantity: number, rule: ItemRule | undefined): PartyState {
  if (itemIndex === ITEM_SOVEREIGNS) return loseRoyals(p, quantity * ROYALS_PER_SOVEREIGN);
  if (itemIndex === ITEM_ROYALS) return loseRoyals(p, quantity);
  const stackSize = rule?.stackSize ?? 1;
  const take = (items: InventoryItem[], n: number): { items: InventoryItem[]; left: number } => {
    let left = n;
    const out: InventoryItem[] = [];
    for (const it of items) {
      if (left <= 0 || it.itemIndex !== itemIndex) {
        out.push(it);
      } else if (stackSize > 1) {
        const used = Math.min(left, it.conditionOrQuantity);
        left -= used;
        if (it.conditionOrQuantity > used) out.push({ ...it, conditionOrQuantity: it.conditionOrQuantity - used });
      } else {
        left -= 1;
      }
    }
    return { items: out, left };
  };
  if (rule?.isKey) {
    const r = take(p.partyKeys.items, quantity);
    return { ...p, partyKeys: { ...p.partyKeys, items: r.items } };
  }
  let left = quantity;
  let next = p;
  for (const c of activeCharacters(p)) {
    if (left <= 0) break;
    const r = take(c.inventory.items, left);
    if (r.left === left) continue;
    left = r.left;
    next = updateCharacter(next, c.index, (x) => ({ ...x, inventory: { ...x.inventory, items: r.items } }));
  }
  return next;
}

export function addCondition(c: Character, name: ConditionName, amount: number): Character {
  const value = Math.max(0, Math.min(100, c.conditions[name] + amount));
  return { ...c, conditions: { ...c.conditions, [name]: value } };
}

/**
 * A HealCharacters action. From 100 on it is a full rest: every condition is cleared and health is
 * restored to its maximum. Below 100 the original takes 20 percent off the current health (it is
 * used at the start of chapter 4), which is kept here.
 */
export function healCharacter(c: Character, amount: number): Character {
  const health = c.skills.health;
  if (amount >= 100) {
    let next: Character = { ...c, skills: { ...c.skills, health: { ...health, trueSkill: health.max } } };
    for (const name of CONDITION_NAMES) next = addCondition(next, name, -100);
    return next;
  }
  const reduced = Math.max(0, health.trueSkill + Math.trunc((health.trueSkill * -20) / 100));
  return { ...c, skills: { ...c.skills, health: { ...health, trueSkill: reduced } } };
}

export function learnSpell(c: Character, spell: number): Character {
  if (spell < 0 || spell >= c.spellBytes.length * 8 || c.spells.includes(spell)) return c;
  const spellBytes = c.spellBytes.slice();
  spellBytes[spell >> 3] = spellBytes[spell >> 3]! | (1 << (spell & 7));
  return { ...c, spellBytes, spells: [...c.spells, spell].sort((a, b) => a - b) };
}
