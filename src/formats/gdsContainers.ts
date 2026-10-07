import { Reader } from './reader';
import type { InventoryItem } from './gam';
import { ITEM_STATUS_BITS } from './gam';
import { gdsLetter, type GdsRef } from './gds';

/**
 * Town containers stored in a save (shops, inns, temples, barmaids): 98 variable-length records at
 * 0x443c9, each a header, an inventory and optional parts chosen by the header's flag bits.
 * See docs/formats/shops.md.
 */

export const SHOPS_OFFSET = 0x443c9;
export const SHOPS_COUNT = 98;

/** Bits of a container header's `flags` byte. */
export const ContainerFlag = {
  Lock: 0x01,
  Dialog: 0x02,
  Shop: 0x04,
  Encounter: 0x08,
  Time: 0x10,
  Door: 0x20,
} as const;

/** The 16 bytes of shop statistics. Several fields are shared between shop, inn, temple and bard uses. */
export interface ShopStats {
  /** Temple number; also keys the temple scene a shop belongs to. */
  templeNumber: number;
  /** Percent over an item's value the shop sells at (temples: fixed blessing cost). */
  sellFactor: number;
  /** Largest haggle discount in percent; 0 means the shop does not haggle (temples: blessing percent). */
  maxDiscount: number;
  /** Percent of the sell price the shop pays when buying (temples: blessing type, 4 + value). */
  buyFactor: number;
  /** Haggle difficulty (temples: heal factor). */
  haggleDifficulty: number;
  /** Percent chance a failed haggle makes the shop refuse to sell that item at all. */
  haggleAnnoyance: number;
  bardingSkill: number;
  bardingReward: number;
  bardingMaxReward: number;
  unknown: number;
  innSleepUntilHour: number;
  innCost: number;
  /** Bit 0 swords, bit 1 armour, bit 2 crossbows. */
  repairTypes: number;
  repairFactor: number;
  /** `SaleCategory` bits the shop trades in. */
  categories: number;
}

export interface ShopContainer {
  ref: GdsRef;
  capacity: number;
  items: InventoryItem[];
  stats: ShopStats | undefined;
  /** Byte offset of the record in the save. */
  address: number;
}

function readItems(r: Reader, count: number, capacity: number): InventoryItem[] {
  const items: InventoryItem[] = [];
  for (let i = 0; i < count; i++) {
    const itemIndex = r.u8();
    const conditionOrQuantity = r.u8();
    const status = r.u8();
    const modifiers = r.u8();
    const bit = (n: number) => (status & (1 << n)) !== 0;
    items.push({
      itemIndex, conditionOrQuantity, status, modifiers,
      activated: bit(ITEM_STATUS_BITS.activated), used: bit(ITEM_STATUS_BITS.used), broken: bit(ITEM_STATUS_BITS.broken),
      repairable: bit(ITEM_STATUS_BITS.repairable), equipped: bit(ITEM_STATUS_BITS.equipped), poisoned: bit(ITEM_STATUS_BITS.poisoned),
    });
  }
  r.skip(Math.max(0, capacity - count) * 4);
  return items;
}

export function readShopStats(r: Reader): ShopStats {
  return {
    templeNumber: r.u8(), sellFactor: r.u8(), maxDiscount: r.u8(), buyFactor: r.u8(),
    haggleDifficulty: r.u8(), haggleAnnoyance: r.u8(),
    bardingSkill: r.u8(), bardingReward: r.u8(), bardingMaxReward: r.u8(), unknown: r.u8(),
    innSleepUntilHour: r.u8(), innCost: r.u8(), repairTypes: r.u8(), repairFactor: r.u8(),
    categories: r.u16(),
  };
}

/** Parse the shop containers of a save image. Returns what was readable if the image ends early. */
export function parseShopContainers(bytes: Uint8Array, offset = SHOPS_OFFSET, count = SHOPS_COUNT): ShopContainer[] {
  const r = new Reader(bytes, offset);
  const out: ShopContainer[] = [];
  try {
    for (let i = 0; i < count; i++) {
      const address = r.pos;
      r.skip(4);
      const number = r.u32() & 0xff;
      const letter = gdsLetter(r.u32() & 0xff);
      r.skip(1); // location type
      const itemCount = r.u8();
      const capacity = r.u8();
      const flags = r.u8();
      const items = readItems(r, itemCount, capacity);
      if (flags & ContainerFlag.Lock) r.skip(4);
      if (flags & ContainerFlag.Door) r.skip(2);
      if (flags & ContainerFlag.Dialog) r.skip(6);
      const stats = flags & ContainerFlag.Shop ? readShopStats(r) : undefined;
      if (flags & ContainerFlag.Encounter) r.skip(9);
      if (flags & ContainerFlag.Time) r.skip(4);
      out.push({ ref: { number, letter }, capacity, items, stats, address });
    }
  } catch (err) {
    if (!(err instanceof RangeError)) throw err;
  }
  return out;
}

/** The container of a scene, or undefined. */
export function findShop(shops: readonly ShopContainer[], ref: GdsRef): ShopContainer | undefined {
  return shops.find((s) => s.ref.number === ref.number && s.ref.letter === ref.letter);
}
