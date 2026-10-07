import type { ContainerItem } from '../formats/containers';
import { ITEM_STATUS_BITS, type Character, type InventoryItem } from '../formats/gam';
import { ItemType, type ItemDef } from '../formats/objinfo';
import { ruleFor, toInventoryItem, type WorldContainer } from './containers';
import { giveItem, updateCharacter, type PartyState } from './party';
import type { WorldState } from './state';

/**
 * What the party carries from one chapter into the next. See docs/formats/chapters.md. Chapters 2 to 8
 * start with the money the party ended the previous chapter with (or a fixed purse), and chapters 4 and
 * 5 swap a character's inventory with a stash container in the world. Inns, rooms and the like that
 * are town containers (chapter 2 Locklear's room, chapter 6 Lurough inns) are not modelled yet.
 */

/** Save-character slots of the three characters whose kit changes. */
export const CHAR_LOCKLEAR = 0;
export const CHAR_GORATH = 1;
export const CHAR_OWYN = 2;

export const ITEM_TORCH = 84;
export const TORCH_COUNT = 6;

/** Zone 12 chests where Owyn's and Gorath's chapter 3 kit is stored when chapter 4 starts. */
export const OWYN_CHEST = { zone: 12, x: 694800, y: 700800 } as const;
export const GORATH_CHEST = { zone: 12, x: 698400, y: 696800 } as const;
/** Zone 0 reference container holding the kit Locklear starts chapter 5 with. */
export const LOCKLEAR_CH5_STASH = { zone: 0, x: 10, y: 0 } as const;

// ---- Money per chapter ------------------------------------------------------

/** The save keeps the party's purse at the end of each chapter as a u32 at this offset. */
export const chapterMoneyOffset = (chapter: number): number => 0x12f7 + ((chapter - 1) << 2) + 0x64;

export function readChapterMoney(bytes: Uint8Array, chapter: number): number {
  const o = chapterMoneyOffset(chapter);
  if (chapter < 1 || o + 4 > bytes.length) return 0;
  return (bytes[o]! | (bytes[o + 1]! << 8) | (bytes[o + 2]! << 16) | (bytes[o + 3]! << 24)) >>> 0;
}

export function writeChapterMoney(world: WorldState, chapter: number, royals: number): WorldState {
  const o = chapterMoneyOffset(chapter);
  if (chapter < 1 || o + 4 > world.bytes.length) return world;
  const bytes = world.bytes.slice();
  const v = Math.max(0, Math.floor(royals)) >>> 0;
  bytes[o] = v & 0xff;
  bytes[o + 1] = (v >>> 8) & 0xff;
  bytes[o + 2] = (v >>> 16) & 0xff;
  bytes[o + 3] = (v >>> 24) & 0xff;
  return { ...world, bytes };
}

// ---- Stash containers --------------------------------------------------------

/** The part of `ContainerStore` the hand-over needs. */
export interface StashSource {
  zone(zone: number): WorldContainer[];
  replace(c: WorldContainer): void;
}

const findAt = (s: StashSource, at: { zone: number; x: number; y: number }): WorldContainer | undefined =>
  s.zone(at.zone).find((c) => c.x === at.x && c.y === at.y);

const bit = (n: number): number => 1 << n;
const toContainerItem = (i: InventoryItem): ContainerItem => ({
  itemIndex: i.itemIndex, conditionOrQuantity: i.conditionOrQuantity, status: i.status, modifiers: i.modifiers,
});

/** Mirror the flag fields into the status byte, as the save does. */
function withEquipped(i: InventoryItem, equipped: boolean): InventoryItem {
  const status = equipped ? i.status | bit(ITEM_STATUS_BITS.equipped) : i.status & ~bit(ITEM_STATUS_BITS.equipped);
  return { ...i, equipped, status };
}

function equipFirstOfType(c: Character, defs: readonly ItemDef[], type: ItemType): Character {
  const at = c.inventory.items.findIndex((i) => defs[i.itemIndex]?.type === type);
  if (at < 0) return c;
  const items = c.inventory.items.map((i, n) => (n === at ? withEquipped(i, true) : i));
  return { ...c, inventory: { ...c.inventory, items } };
}

/** Move a character's whole inventory into a stash (replacing its contents) and give back an empty pack. */
function stashAndGiveTorch(party: PartyState, stash: WorldContainer | undefined, who: number, defs: readonly ItemDef[], activate: boolean, store: StashSource): PartyState {
  const c = party.characters.find((x) => x.index === who);
  if (!c) return party;
  if (stash) store.replace({ ...stash, items: c.inventory.items.slice(0, stash.capacity).map(toContainerItem) });
  let next = updateCharacter(party, who, (x) => ({ ...x, inventory: { ...x.inventory, items: [] } }));
  next = giveItem(next, ITEM_TORCH, TORCH_COUNT, ruleFor(defs, ITEM_TORCH), who).party;
  if (activate) {
    next = updateCharacter(next, who, (x) => ({
      ...x,
      inventory: {
        ...x.inventory,
        items: x.inventory.items.map((i) => (i.itemIndex === ITEM_TORCH ? { ...i, activated: true, status: i.status | bit(ITEM_STATUS_BITS.activated) } : i)),
      },
    }));
  }
  return next;
}

// ---- Hand-over ----------------------------------------------------------------

export interface HandoverInput {
  world: WorldState;
  party: PartyState;
  /** The chapter being entered. */
  chapter: number;
  items: readonly ItemDef[];
  /** Without it the inventory swaps are skipped and only money is handled. */
  containers?: StashSource;
}

/**
 * Apply the per-chapter purse and inventory rules: from chapter 2 the purse at hand-over is recorded
 * under the new chapter; chapter 4 starts with nothing; chapters 5 to 8 restore the purse recorded
 * when the previous chapter began (chapter 5 reads chapter 4's slot, and so on).
 */
export function applyChapterHandover(i: HandoverInput): { world: WorldState; party: PartyState } {
  let { world, party } = i;
  if (i.chapter !== 1) world = writeChapterMoney(world, i.chapter, party.gold);

  const store = i.containers;
  switch (i.chapter) {
    case 4:
      if (store) {
        party = stashAndGiveTorch(party, findAt(store, OWYN_CHEST), CHAR_OWYN, i.items, false, store);
        party = stashAndGiveTorch(party, findAt(store, GORATH_CHEST), CHAR_GORATH, i.items, true, store);
      }
      party = { ...party, gold: 0 };
      break;
    case 5: {
      const stash = store && findAt(store, LOCKLEAR_CH5_STASH);
      if (stash) {
        party = updateCharacter(party, CHAR_LOCKLEAR, (c) => {
          let next: Character = { ...c, inventory: { ...c.inventory, items: stash.items.map(toInventoryItem) } };
          for (const t of [ItemType.Sword, ItemType.Armor, ItemType.Crossbow]) next = equipFirstOfType(next, i.items, t);
          return next;
        });
      }
      party = { ...party, gold: readChapterMoney(world.bytes, 4) };
      break;
    }
    case 6:
    case 7:
    case 8:
      party = { ...party, gold: readChapterMoney(world.bytes, i.chapter - 1) };
      break;
  }
  return { world, party };
}
