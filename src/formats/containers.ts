import { Reader } from './reader';

/**
 * Container records: chests, bags, gravestones, shops and enemy loot all share one record layout.
 * See docs/formats/containers.md. Three header flavours exist (world, shop/GDS and combat); the
 * rest of the record is the same. Parsing here is read-only: game state keeps its own copy.
 */

/** Header flag bits: which optional sections follow the inventory. */
export const ContainerFlag = {
  Lock: 0x01,
  Dialog: 0x02,
  Shop: 0x04,
  Encounter: 0x08,
  Time: 0x10,
  Door: 0x20,
} as const;

export const ITEM_RECORD_BYTES = 4;
/** Bytes of the shop block: 14 single-byte fields and a u16 category mask. */
export const SHOP_BLOCK_BYTES = 16;

export interface ContainerItem {
  itemIndex: number;
  /** Condition, charges or quantity depending on the item (same as a character's inventory). */
  conditionOrQuantity: number;
  status: number;
  modifiers: number;
}

export interface ContainerLock {
  /** 1 and 4 mean trapped; see `isTrapped`. */
  flag: number;
  /** Lock difficulty; some values stand for a particular key (see game/locks.ts). */
  rating: number;
  /** Non-zero: a word-lock riddle chest; the number picks the riddle text. */
  fairyChestIndex: number;
  /** Damage dealt to each party member when a trap goes off. */
  trapDamage: number;
}

export interface ContainerDialogRef {
  contextVar: number;
  dialogOrder: number;
  /** Dialogue key played when the container is closed again. */
  key: number;
}

export interface ContainerEncounterRef {
  requireEventFlag: number;
  /** Event flag set when the container has been opened. */
  setEventFlag: number;
  /** Town hotspot (GDS number and letter) the container leads to; undefined when the number is 0. */
  hotspot?: { gds: number; letter: string };
  /** Offset in cells inside the container's tile where an encounter triggers; undefined when none. */
  encounterCell?: { x: number; y: number };
}

export type ContainerLocation =
  | {
      kind: 'world';
      zone: number;
      fromChapter: number;
      toChapter: number;
      model: number;
      unknown: number;
      x: number;
      y: number;
    }
  | { kind: 'gds'; gds: number; letter: string }
  | { kind: 'combat'; combat: number; combatant: number };

export interface ContainerRecord {
  /** Offset of the record in the file it was read from. */
  address: number;
  location: ContainerLocation;
  /** Raw byte after the location; 7 for combat inventories. Meaning otherwise unknown. */
  locationType: number;
  capacity: number;
  flags: number;
  items: ContainerItem[];
  lock?: ContainerLock;
  /** Door index (doors that are containers: locked house doors). */
  door?: number;
  dialog?: ContainerDialogRef;
  /** The raw 16-byte shop block, parsed by the shop code. */
  shop?: Uint8Array;
  encounter?: ContainerEncounterRef;
  /** Time the container was last visited (shops restock from it), in ticks. */
  lastAccessed?: number;
}

export type HeaderKind = ContainerLocation['kind'];

/** A world container is trapped when its lock flag is 1 or 4 (and it is not a word lock). */
export function isTrapped(lock: Pick<ContainerLock, 'flag'>): boolean {
  return lock.flag === 1 || lock.flag === 4;
}

export const isWordLock = (lock: Pick<ContainerLock, 'fairyChestIndex'>): boolean => lock.fairyChestIndex !== 0;

/** Hotspot letters are stored as a number: 1 is 'A'. */
const hotspotLetter = (n: number): string => String.fromCharCode(0x40 + n);

/** Chapter range byte: high nibble first chapter, low nibble last chapter, both inclusive. */
export function presentInChapter(c: ContainerRecord, chapter: number): boolean {
  return c.location.kind !== 'world' || (chapter >= c.location.fromChapter && chapter <= c.location.toChapter);
}

/** Read one container record at the reader's position. */
export function readContainer(r: Reader, kind: HeaderKind): ContainerRecord {
  const address = r.pos;
  let location: ContainerLocation;
  if (kind === 'world') {
    const zone = r.u8();
    const range = r.u8();
    const model = r.u8();
    const unknown = r.u8();
    const x = r.u32();
    const y = r.u32();
    location = { kind, zone, fromChapter: range >> 4, toChapter: range & 0xf, model, unknown, x, y };
  } else if (kind === 'gds') {
    r.skip(4);
    const gds = r.u32();
    const letter = hotspotLetter(r.u32() & 0xff);
    location = { kind, gds, letter };
  } else {
    r.skip(4);
    const combatant = r.u32();
    const combat = r.u32();
    location = { kind, combat, combatant };
  }
  const locationType = r.u8();
  const count = r.u8();
  const capacity = r.u8();
  const flags = r.u8();
  if (count > capacity)
    throw new RangeError(`container at 0x${address.toString(16)} holds ${count} items for capacity ${capacity}`);

  const items: ContainerItem[] = [];
  for (let i = 0; i < count; i++)
    items.push({ itemIndex: r.u8(), conditionOrQuantity: r.u8(), status: r.u8(), modifiers: r.u8() });
  r.skip((capacity - count) * ITEM_RECORD_BYTES);

  const rec: ContainerRecord = { address, location, locationType, capacity, flags, items };
  if (flags & ContainerFlag.Lock)
    rec.lock = { flag: r.u8(), rating: r.u8(), fairyChestIndex: r.u8(), trapDamage: r.u8() };
  if (flags & ContainerFlag.Door) rec.door = r.u16();
  if (flags & ContainerFlag.Dialog) rec.dialog = { contextVar: r.u8(), dialogOrder: r.u8(), key: r.u32() };
  if (flags & ContainerFlag.Shop) {
    r.skip(SHOP_BLOCK_BYTES);
    rec.shop = r.bytes.slice(r.pos - SHOP_BLOCK_BYTES, r.pos);
  }
  if (flags & ContainerFlag.Encounter) {
    const requireEventFlag = r.u16();
    const setEventFlag = r.u16();
    const gds = r.u8();
    const letter = r.u8();
    const hasCell = r.u8();
    const cx = r.u8();
    const cy = r.u8();
    rec.encounter = { requireEventFlag, setEventFlag };
    if (gds !== 0) rec.encounter.hotspot = { gds, letter: hotspotLetter(letter) };
    if (hasCell !== 0) rec.encounter.encounterCell = { x: cx, y: cy };
  }
  if (flags & ContainerFlag.Time) rec.lastAccessed = r.u32();
  return rec;
}

/**
 * `OBJFIXED.DAT`: two skipped bytes, then for each zone in order a u16 count followed by that many
 * world containers. Returns every container with the zone from its own header.
 */
export function parseFixedObjects(bytes: Uint8Array): ContainerRecord[] {
  const r = new Reader(bytes, 2);
  const out: ContainerRecord[] = [];
  while (r.remaining >= 2) {
    const count = r.u16();
    for (let i = 0; i < count; i++) out.push(readContainer(r, 'world'));
  }
  return out;
}

/** Where each zone's world containers sit in a save image: [offset, count], indexed by zone number (0 = first block). */
export const SAVE_ZONE_CONTAINERS: readonly (readonly [number, number])[] = [
  [0x3ab4f, 15],
  [0x3b621, 36],
  [0x3be55, 25],
  [0x3c55f, 54],
  [0x3d0b4, 65],
  [0x3dc07, 63],
  [0x3e708, 131],
  [0x3f8b2, 115],
  [0x40c97, 67],
  [0x416b7, 110],
  [0x42868, 25],
  [0x43012, 30],
  [0x4378f, 60],
];

/** The world containers of `zone` as stored in a save image (the live state). Empty for unknown zones or short images. */
export function parseSaveZoneContainers(save: Uint8Array, zone: number): ContainerRecord[] {
  const block = SAVE_ZONE_CONTAINERS[zone];
  if (!block || block[0] >= save.length) return [];
  const r = new Reader(save, block[0]);
  const out: ContainerRecord[] = [];
  for (let i = 0; i < block[1]; i++) out.push(readContainer(r, 'world'));
  return out;
}

/** A synthetic or decoded record as bytes; the inverse of `readContainer`, used by tests and tools. */
export function writeContainer(c: ContainerRecord): Uint8Array {
  const out: number[] = [];
  const u16 = (v: number) => out.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (v: number) => out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  const loc = c.location;
  if (loc.kind === 'world') {
    out.push(loc.zone, (loc.fromChapter << 4) | loc.toChapter, loc.model, loc.unknown);
    u32(loc.x);
    u32(loc.y);
  } else if (loc.kind === 'gds') {
    out.push(0, 0, 0, 0);
    u32(loc.gds);
    u32(loc.letter.charCodeAt(0) - 0x40);
  } else {
    out.push(0, 0, 0, 0);
    u32(loc.combatant);
    u32(loc.combat);
  }
  out.push(c.locationType, c.items.length, c.capacity, c.flags);
  for (const it of c.items) out.push(it.itemIndex, it.conditionOrQuantity, it.status, it.modifiers);
  for (let i = c.items.length; i < c.capacity; i++) out.push(0, 0, 0, 0);
  if (c.lock) out.push(c.lock.flag, c.lock.rating, c.lock.fairyChestIndex, c.lock.trapDamage);
  if (c.door !== undefined) u16(c.door);
  if (c.dialog) {
    out.push(c.dialog.contextVar, c.dialog.dialogOrder);
    u32(c.dialog.key);
  }
  if (c.shop) out.push(...c.shop);
  if (c.encounter) {
    u16(c.encounter.requireEventFlag);
    u16(c.encounter.setEventFlag);
    out.push(c.encounter.hotspot?.gds ?? 0, (c.encounter.hotspot?.letter.charCodeAt(0) ?? 0x40) - 0x40);
    out.push(c.encounter.encounterCell ? 1 : 0, c.encounter.encounterCell?.x ?? 0, c.encounter.encounterCell?.y ?? 0);
  }
  if (c.lastAccessed !== undefined) u32(c.lastAccessed);
  return Uint8Array.from(out);
}
