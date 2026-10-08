import type { Character, InventoryItem } from '../formats/gam';
import { practiceCharacter } from './practice';
import { ItemType, type ItemDef } from '../formats/objinfo';
import type { SpellDef } from '../formats/spells';
import { learnFromScroll, skillOfMask } from './spells';
import { addCondition, addToCharacter, updateCharacter, type ItemRule, type PartyState } from './party';

/**
 * Using, equipping, repairing and handing over inventory items. Pure like party.ts: each function
 * returns a new `PartyState` and a short message for the status line. OBJINFO has no weight field
 * and its effect fields are not fully decoded (docs/formats/items.md), so the limits are the
 * per-character slot capacity and the effects below are the documented approximations.
 */

export interface ItemUseResult {
  party: PartyState;
  /** One line for the player. */
  message: string;
  /** False when nothing changed. */
  ok: boolean;
}

/** Health restored by a potion or restorative whose power field is 0. */
export const DEFAULT_RESTORE = 10;
/** Condition points a repair adds to a damaged item. */
export const REPAIR_AMOUNT = 25;
/** Condition a tool loses with each repair; the tool is discarded at 0. */
export const TOOL_WEAR = 10;

const fail = (party: PartyState, message: string): ItemUseResult => ({ party, message, ok: false });

function characterOf(p: PartyState, index: number): Character | undefined {
  return p.characters.find((c) => c.index === index);
}

function setItems(p: PartyState, c: Character, items: InventoryItem[]): PartyState {
  return updateCharacter(p, c.index, (x) => ({ ...x, inventory: { ...x.inventory, items } }));
}

export function ruleOf(def: ItemDef | undefined): ItemRule | undefined {
  return def && { stackSize: def.stackSize, defaultStackSize: def.defaultStackSize, isKey: def.type === ItemType.Key };
}

/** Equipment groups: only one item of a group is equipped at a time. */
export type EquipGroup = 'melee' | 'crossbow' | 'armor';

export function equipGroup(def: ItemDef | undefined): EquipGroup | undefined {
  switch (def?.type) {
    case ItemType.Sword:
    case ItemType.Staff:
      return 'melee';
    case ItemType.Crossbow:
      return 'crossbow';
    case ItemType.Armor:
      return 'armor';
    default:
      return undefined;
  }
}

/** Items with a condition percentage (the ones a tool can repair). */
export function hasCondition(def: ItemDef | undefined): boolean {
  return equipGroup(def) !== undefined;
}

/** Equip the item in `slot`, unequipping whatever shared its group; equipping an equipped item removes it. */
export function toggleEquip(p: PartyState, charIndex: number, slot: number, defs: readonly ItemDef[]): ItemUseResult {
  const c = characterOf(p, charIndex);
  const it = c?.inventory.items[slot];
  if (!c || !it) return fail(p, 'Nothing there.');
  const def = defs[it.itemIndex];
  const group = equipGroup(def);
  if (!group) return fail(p, `${def?.name ?? 'That'} cannot be equipped.`);
  if (it.equipped) {
    return {
      party: setItems(
        p,
        c,
        c.inventory.items.map((x, i) => (i === slot ? { ...x, equipped: false } : x)),
      ),
      message: `${def!.name} unequipped.`,
      ok: true,
    };
  }
  if (it.broken) return fail(p, `${def!.name} is broken.`);
  const items = c.inventory.items.map((x, i) => {
    if (i === slot) return { ...x, equipped: true };
    return x.equipped && equipGroup(defs[x.itemIndex]) === group ? { ...x, equipped: false } : x;
  });
  return { party: setItems(p, c, items), message: `${def!.name} equipped.`, ok: true };
}

/** Take one from a stack, or remove the whole item when it is not a stack. */
function consumeOne(items: InventoryItem[], slot: number, def: ItemDef): InventoryItem[] {
  const it = items[slot]!;
  if (def.stackSize > 1 && it.conditionOrQuantity > 1) {
    return items.map((x, i) => (i === slot ? { ...x, conditionOrQuantity: x.conditionOrQuantity - 1 } : x));
  }
  return items.filter((_, i) => i !== slot);
}

function restoreHealth(c: Character, amount: number): Character {
  const h = c.skills.health;
  const next = Math.min(h.max, h.trueSkill + amount);
  return { ...c, skills: { ...c.skills, health: { ...h, trueSkill: next } } };
}

/**
 * Use the item in `slot` on its owner: food and rations cure starvation, potions and restoratives
 * heal (restoratives also clear poison and sickness). Scrolls teach their spell to a magic-user, books raise a
 * skill and lose a charge; notes are read in the original's text viewer and are refused for now.
 */
export interface UseContext {
  /** SPELLS.DAT, for naming the spell a scroll teaches. */
  spells?: readonly SpellDef[];
  /** Whether this character has read this book before (the first reading is a sure gain). */
  hasRead?: (charIndex: number, itemIndex: number) => boolean;
  /** Called after a book was read. */
  markRead?: (charIndex: number, itemIndex: number) => void;
  random?: (n: number) => number;
}

/** Book charges and scroll spells: the scroll's spell number is its condition/quantity field. */
function readMagicItem(p: PartyState, c: Character, slot: number, def: ItemDef, ctx: UseContext): ItemUseResult {
  const it = c.inventory.items[slot]!;
  if (def.type === ItemType.Scroll) {
    const r = learnFromScroll(p, c.index, it.conditionOrQuantity, ctx.spells ?? []);
    if (!r.ok) return fail(p, r.message);
    const owner = r.party.characters.find((x) => x.index === c.index)!;
    return {
      party: setItems(
        r.party,
        owner,
        owner.inventory.items.filter((_, i) => i !== slot),
      ),
      message: r.message,
      ok: true,
    };
  }
  if (def.type === ItemType.Book) {
    if (it.conditionOrQuantity <= 0) return fail(p, `${def.name} has no charges left.`);
    const skill = skillOfMask(def.effectMask);
    const random = ctx.random ?? ((n) => Math.floor(Math.random() * n));
    const seen = ctx.hasRead?.(c.index, def.index) ?? false;
    let gain = 0;
    if (!seen) gain = Math.max(0, def.effect);
    else if (random(100) > def.potionPowerOrBookChance) gain = Math.max(0, def.alternativeEffect);
    ctx.markRead?.(c.index, def.index);
    const left = it.conditionOrQuantity - 1;
    const next = updateCharacter(p, c.index, (x) => {
      const sk = skill && x.skills[skill];
      const skills =
        sk && gain > 0
          ? { ...x.skills, [skill!]: { ...sk, trueSkill: Math.min(sk.max, sk.trueSkill + gain) } }
          : x.skills;
      return {
        ...x,
        skills,
        inventory: {
          ...x.inventory,
          items: x.inventory.items.map((y, i) => (i === slot ? { ...y, conditionOrQuantity: left } : y)),
        },
      };
    });
    return {
      party: next,
      ok: true,
      message:
        gain > 0 && skill
          ? `${c.name} studies ${def.name} and improves ${skill}.`
          : `${c.name} reads ${def.name} but learns nothing new.`,
    };
  }
  return fail(p, `${def.name} cannot be read.`);
}

export function useItem(
  p: PartyState,
  charIndex: number,
  slot: number,
  defs: readonly ItemDef[],
  ctx: UseContext = {},
): ItemUseResult {
  const c = characterOf(p, charIndex);
  const it = c?.inventory.items[slot];
  const def = it && defs[it.itemIndex];
  if (!c || !it || !def) return fail(p, 'Nothing there.');
  const power = def.potionPowerOrBookChance || DEFAULT_RESTORE;
  let next: Character | undefined;
  let message = '';
  switch (def.type) {
    case ItemType.Ration:
    case ItemType.Food:
      next = addCondition(c, 'starving', -100);
      message = `${c.name} eats the ${def.name}.`;
      break;
    case ItemType.Potion:
      next = restoreHealth(c, power);
      message = `${c.name} drinks the ${def.name}.`;
      break;
    case ItemType.Restoratives:
      next = addCondition(addCondition(restoreHealth(c, power), 'poisoned', -100), 'sick', -100);
      message = `${c.name} uses the ${def.name}.`;
      break;
    case ItemType.Scroll:
    case ItemType.Book:
      return readMagicItem(p, c, slot, def, ctx);
    case ItemType.Note:
      return fail(p, `${def.name} cannot be read yet.`);
    default:
      return fail(p, `${def.name} cannot be used.`);
  }
  const items = consumeOne(c.inventory.items, slot, def);
  const updated: Character = { ...next, inventory: { ...c.inventory, items } };
  return { party: updateCharacter(p, c.index, () => updated), message, ok: true };
}

/** Move the item in `slot` to another active character, merging stacks. Fails when they are full. */
export function giveToCharacter(
  p: PartyState,
  fromIndex: number,
  slot: number,
  toIndex: number,
  defs: readonly ItemDef[],
): ItemUseResult {
  const from = characterOf(p, fromIndex);
  const to = characterOf(p, toIndex);
  const it = from?.inventory.items[slot];
  const def = it && defs[it.itemIndex];
  if (!from || !to || !it || !def) return fail(p, 'Nothing there.');
  if (fromIndex === toIndex) return fail(p, 'Already carried by them.');
  const quantity = def.stackSize > 1 ? it.conditionOrQuantity : 1;
  const added = addToCharacter(to, it.itemIndex, quantity, ruleOf(def));
  if (!added) return fail(p, `${to.name} cannot carry any more.`);
  // addToCharacter makes a fresh item; carry over the condition of non-stacking items.
  if (def.stackSize <= 1) {
    const last = added.inventory.items.length - 1;
    added.inventory.items[last] = { ...it, equipped: false };
  }
  const moved = setItems(
    updateCharacter(p, to.index, () => added),
    { ...from },
    from.inventory.items.filter((_, i) => i !== slot),
  );
  return { party: moved, message: `${def.name} given to ${to.name}.`, ok: true };
}

/**
 * Repair the damaged item in `slot` with the first Tool anyone in the party carries. The crafts
 * skill of the owner (armorcraft for armour, weaponcraft otherwise) is the percent chance of
 * success; a failed attempt still wears the tool. `random` is a uniform integer in [0, n).
 */
export function repairItem(
  p: PartyState,
  charIndex: number,
  slot: number,
  defs: readonly ItemDef[],
  random: (n: number) => number = (n) => Math.floor(Math.random() * n),
): ItemUseResult {
  const c = characterOf(p, charIndex);
  const it = c?.inventory.items[slot];
  const def = it && defs[it.itemIndex];
  if (!c || !it || !def) return fail(p, 'Nothing there.');
  if (!hasCondition(def)) return fail(p, `${def.name} cannot be repaired.`);
  if (!it.broken && it.conditionOrQuantity >= 100) return fail(p, `${def.name} is in perfect condition.`);
  if (it.broken && !it.repairable) return fail(p, `${def.name} is beyond repair.`);

  let toolOwner: Character | undefined;
  let toolSlot = -1;
  for (const owner of [c, ...p.characters.filter((x) => x.index !== c.index && p.activeCharacters.includes(x.index))]) {
    const s = owner.inventory.items.findIndex((x) => defs[x.itemIndex]?.type === ItemType.Tool && !x.broken);
    if (s >= 0) {
      toolOwner = owner;
      toolSlot = s;
      break;
    }
  }
  if (!toolOwner) return fail(p, 'You need a tool to repair things.');

  const craft = equipGroup(def) === 'armor' ? c.skills.armorcraft : c.skills.weaponcraft;
  const success = random(100) < Math.min(95, Math.max(5, craft.current));

  let party = p;
  if (success) {
    const items = c.inventory.items.map((x, i) =>
      i === slot
        ? {
            ...x,
            broken: false,
            repairable: false,
            conditionOrQuantity: Math.min(100, x.conditionOrQuantity + REPAIR_AMOUNT),
          }
        : x,
    );
    party = setItems(party, c, items);
  }
  const owner = characterOf(party, toolOwner.index)!;
  const tool = owner.inventory.items[toolSlot]!;
  const worn = tool.conditionOrQuantity - TOOL_WEAR;
  const toolItems =
    worn <= 0
      ? owner.inventory.items.filter((_, i) => i !== toolSlot)
      : owner.inventory.items.map((x, i) => (i === toolSlot ? { ...x, conditionOrQuantity: worn } : x));
  party = setItems(party, owner, toolItems);
  party = practiceCharacter(party, c.index, equipGroup(def) === 'armor' ? 'armorcraft' : 'weaponcraft'); // every attempt exercises the craft
  return { party, ok: success, message: success ? `${def.name} repaired.` : `The repair of ${def.name} failed.` };
}
