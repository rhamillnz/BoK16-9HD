import { gdsLetter, type GdsRef } from './gds';
import { Reader } from './reader';

/**
 * The 98 town containers in a save (shops, inns, temples, ...), one per GDS scene that has one.
 * Every record is a 16-byte header, the item slots, then optional blocks chosen by the flag bits.
 * See docs/formats/temples.md. Only the header, the shop statistics and the item slots are kept.
 */

export const GDS_CONTAINERS_OFFSET = 0x443c9;
export const GDS_CONTAINER_COUNT = 98;

const FLAG_LOCK = 0x01;
const FLAG_DIALOG = 0x02;
const FLAG_SHOP = 0x04;
const FLAG_ENCOUNTER = 0x08;
const FLAG_TIME = 0x10;
const FLAG_DOOR = 0x20;

/**
 * The shop block. Temples reuse the fields under other names: `sellFactor` is the fixed blessing
 * cost, `maxDiscount` the blessing percentage, `buyFactor` the blessing level (1-3),
 * `haggleDifficulty` the cure cost factor, `haggleAnnoyance` the teleport cost multiplier and
 * `categories` the teleport cost constant.
 */
export interface ShopStats {
  templeNumber: number;
  sellFactor: number;
  maxDiscount: number;
  buyFactor: number;
  haggleDifficulty: number;
  haggleAnnoyance: number;
  bardingSkill: number;
  bardingReward: number;
  bardingMaxReward: number;
  unknown: number;
  innSleepTilHour: number;
  innCost: number;
  repairTypes: number;
  repairFactor: number;
  categories: number;
}

export interface GdsContainer {
  /** Index in the save's table. */
  index: number;
  /** The GDS scene the container belongs to. */
  ref: GdsRef;
  flags: number;
  shop: ShopStats | undefined;
  /** Byte offset of the record, for writing changes back. */
  address: number;
}

export function readShopStats(r: Reader): ShopStats {
  return {
    templeNumber: r.u8(),
    sellFactor: r.u8(),
    maxDiscount: r.u8(),
    buyFactor: r.u8(),
    haggleDifficulty: r.u8(),
    haggleAnnoyance: r.u8(),
    bardingSkill: r.u8(),
    bardingReward: r.u8(),
    bardingMaxReward: r.u8(),
    unknown: r.u8(),
    innSleepTilHour: r.u8(),
    innCost: r.u8(),
    repairTypes: r.u8(),
    repairFactor: r.u8(),
    categories: r.u16(),
  };
}

/** Parse the table of town containers from the save bytes. Stops early at a truncated record. */
export function parseGdsContainers(save: Uint8Array, count = GDS_CONTAINER_COUNT, offset = GDS_CONTAINERS_OFFSET): GdsContainer[] {
  const r = new Reader(save, offset);
  const out: GdsContainer[] = [];
  try {
    for (let index = 0; index < count; index++) {
      const address = r.pos;
      r.skip(4);
      const number = r.u32() & 0xff;
      const letter = gdsLetter(r.u32() & 0xff);
      r.skip(1); // location type
      const items = r.u8();
      const capacity = r.u8();
      const flags = r.u8();
      r.skip(Math.max(items, capacity) * 4);
      if (flags & FLAG_LOCK) r.skip(4);
      if (flags & FLAG_DOOR) r.skip(2);
      if (flags & FLAG_DIALOG) r.skip(6);
      const shop = flags & FLAG_SHOP ? readShopStats(r) : undefined;
      if (flags & FLAG_ENCOUNTER) r.skip(9);
      if (flags & FLAG_TIME) r.skip(4);
      out.push({ index, ref: { number, letter }, flags, shop, address });
    }
  } catch (err) {
    if (!(err instanceof RangeError)) throw err;
  }
  return out;
}

/** The container of a scene. */
export function findGdsContainer(list: readonly GdsContainer[], ref: GdsRef): GdsContainer | undefined {
  return list.find((c) => c.ref.number === ref.number && c.ref.letter === ref.letter);
}
