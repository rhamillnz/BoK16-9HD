import { gdsLetter } from './gds';
import { Reader } from './reader';

/**
 * The 98 containers that belong to GDS scenes (shops, inns, temples, bards) in a save image, from
 * `0x443c9`. Each has a hotspot reference and, for shops, a stats block. See docs/formats/inns.md.
 */
export const GDS_CONTAINERS_OFFSET = 0x443c9;
export const GDS_CONTAINER_COUNT = 98;

/** Container header flag bits. */
const HAS_LOCK = 0x01;
const HAS_DIALOG = 0x02;
const HAS_SHOP = 0x04;
const HAS_ENCOUNTER = 0x08;
const HAS_TIME = 0x10;
const HAS_DOOR = 0x20;

/** The 16-byte stats block of a shop, inn or temple. Names follow BaKGL's `ShopStats`. */
export interface ShopStats {
  templeNumber: number;
  sellFactor: number;
  maxDiscount: number;
  buyFactor: number;
  haggleDifficulty: number;
  haggleAnnoyanceFactor: number;
  bardingSkill: number;
  bardingReward: number;
  bardingMaxReward: number;
  /** UNKNOWN. */
  unknown: number;
  /** Inns: the hour the party sleeps until. */
  innSleepTilHour: number;
  /** Inns: price of a night, in sovereigns. */
  innCost: number;
  repairTypes: number;
  repairFactor: number;
  categories: number;
}

export interface GdsContainer {
  /** Town/scene number of the hotspot the container belongs to. */
  number: number;
  /** Scene letter. */
  letter: string;
  shop: ShopStats | undefined;
}

function readShop(r: Reader): ShopStats {
  return {
    templeNumber: r.u8(), sellFactor: r.u8(), maxDiscount: r.u8(), buyFactor: r.u8(),
    haggleDifficulty: r.u8(), haggleAnnoyanceFactor: r.u8(),
    bardingSkill: r.u8(), bardingReward: r.u8(), bardingMaxReward: r.u8(), unknown: r.u8(),
    innSleepTilHour: r.u8(), innCost: r.u8(), repairTypes: r.u8(), repairFactor: r.u8(),
    categories: r.u16(),
  };
}

/**
 * Read the GDS containers of a save. Records are variable length (the flags say which optional
 * blocks follow the inventory), so they are walked in order; stops early if the image is too short.
 */
export function parseGdsContainers(save: Uint8Array, count = GDS_CONTAINER_COUNT): GdsContainer[] {
  const r = new Reader(save, GDS_CONTAINERS_OFFSET);
  const out: GdsContainer[] = [];
  for (let i = 0; i < count; i++) {
    if (r.remaining < 16) break;
    r.skip(4); // unknown
    const number = r.u32() & 0xff;
    const letter = gdsLetter(r.u32() & 0xff);
    r.skip(1); // location type
    r.skip(1); // item count
    const capacity = r.u8();
    const flags = r.u8();
    r.skip(capacity * 4); // items then unused slots, 4 bytes each
    if (flags & HAS_LOCK) r.skip(4);
    if (flags & HAS_DOOR) r.skip(2);
    if (flags & HAS_DIALOG) r.skip(6);
    const shop = flags & HAS_SHOP ? readShop(r) : undefined;
    if (flags & HAS_ENCOUNTER) r.skip(9);
    if (flags & HAS_TIME) r.skip(4);
    out.push({ number, letter, shop });
  }
  return out;
}

/** The shop stats of the scene with this number and letter. */
export function findShop(containers: readonly GdsContainer[], number: number, letter: string): ShopStats | undefined {
  return containers.find((c) => c.shop && c.number === number && c.letter === letter)?.shop;
}
