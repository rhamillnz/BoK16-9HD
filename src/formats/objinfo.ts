import { Reader } from './reader';

/**
 * Item definitions (OBJINFO.DAT). See docs/formats/items.md.
 * Fixed-size 80-byte records, then a trailing table of u16 scroll prices.
 */

export const OBJINFO_RECORD_SIZE = 80;
/** Number of item definitions in the original OBJINFO.DAT. */
export const OBJINFO_ITEM_COUNT = 0x8a;

export enum ItemType {
  Unspecified = 0x00,
  Sword = 0x01,
  Crossbow = 0x02,
  Staff = 0x03,
  Armor = 0x04,
  Key = 0x07,
  Tool = 0x08,
  WeaponOil = 0x09,
  ArmorOil = 0x0a,
  SpecialOil = 0x0b,
  Bowstring = 0x0c,
  Scroll = 0x0d,
  Note = 0x10,
  Book = 0x11,
  Potion = 0x12,
  Restoratives = 0x13,
  ConditionModifier = 0x14,
  Light = 0x15,
  Ingredient = 0x16,
  Ration = 0x17,
  Food = 0x18,
  Other = 0x19,
}

export enum Race {
  None = 0,
  Tsurani = 1,
  Elf = 2,
  Human = 3,
  Dwarf = 4,
}

/** Bits of `ItemDef.categories` (which shop/inventory groups accept the item). */
export const SaleCategory = {
  Utility: 0x0001,
  Rations: 0x0002,
  PreciousGems: 0x0004,
  Keys: 0x0008,
  All: 0x0010,
  QuestItem: 0x0020,
  UsableMundaneItem: 0x0040,
  Sword: 0x0080,
  CrossbowRelated: 0x0100,
  Armor: 0x0200,
  UsableMagicalItem: 0x0400,
  Staff: 0x0800,
  Scroll: 0x1000,
  BookOrNote: 0x2000,
  Potions: 0x4000,
  Modifier: 0x8000,
} as const;

/** Weapon enchantments; bit `n` of `modifierMask >> 8` selects entry `n`. */
export const WEAPON_MODIFIERS = [
  'Flaming',
  'SteelFire',
  'Frost',
  'Enhancement1',
  'Enhancement2',
  'Blessing1',
  'Blessing2',
  'Blessing3',
] as const;
export type WeaponModifier = (typeof WEAPON_MODIFIERS)[number];

export interface ItemDef {
  /** Position in OBJINFO.DAT; the item id used elsewhere. */
  index: number;
  name: string;
  /** Raw bytes at +0x1e as u16. Unknown, kept verbatim. */
  unknown1: number;
  /** Raw behaviour flags (u16). Bit meanings not yet established. */
  flags: number;
  /** Raw u16 at +0x22. Unknown, kept verbatim. */
  unknown2: number;
  level: number;
  value: number;
  strengthSwing: number;
  strengthThrust: number;
  accuracySwing: number;
  accuracyThrust: number;
  /** Stored image index, or the item's own index when the stored value is 0. */
  imageIndex: number;
  imageSize: number;
  useSound: number;
  soundPlayTimes: number;
  stackSize: number;
  defaultStackSize: number;
  race: Race;
  /** Bitfield of SaleCategory. */
  categories: number;
  /** Numeric item type; values not listed in ItemType are preserved as-is. */
  type: number;
  effectMask: number;
  effect: number;
  /** Potion strength or book success chance, depending on type. */
  potionPowerOrBookChance: number;
  alternativeEffect: number;
  modifierMask: number;
  modifier: number;
  dullChance: number;
  maxDullAmount: number;
  minCondition: number;
}

export interface ObjInfo {
  items: ItemDef[];
  /** Trailing u16 table of scroll prices (royals), in file order. */
  scrollValues: number[];
}

/** Weapon modifiers enabled in a modifier mask. */
export function modifiersOf(modifierMask: number): WeaponModifier[] {
  const bits = (modifierMask >> 8) & 0xff;
  return WEAPON_MODIFIERS.filter((_, i) => (bits & (1 << i)) !== 0);
}

/** Parse OBJINFO.DAT. `itemCount` defaults to the original game's 138 definitions. */
export function parseObjInfo(bytes: Uint8Array, itemCount = OBJINFO_ITEM_COUNT): ObjInfo {
  if (bytes.length < itemCount * OBJINFO_RECORD_SIZE) {
    throw new RangeError(`OBJINFO too short: ${bytes.length} bytes for ${itemCount} items`);
  }
  const r = new Reader(bytes);
  const items: ItemDef[] = [];
  for (let index = 0; index < itemCount; index++) {
    const name = r.fixedString(30);
    const unknown1 = r.u16();
    const flags = r.u16();
    const unknown2 = r.u16();
    const level = r.i16();
    const value = r.i16();
    const strengthSwing = r.i16();
    const strengthThrust = r.i16();
    const accuracySwing = r.i16();
    const accuracyThrust = r.i16();
    const storedImage = r.u16();
    const imageSize = r.u16();
    items.push({
      index,
      name,
      unknown1,
      flags,
      unknown2,
      level,
      value,
      strengthSwing,
      strengthThrust,
      accuracySwing,
      accuracyThrust,
      imageIndex: storedImage !== 0 ? storedImage : index,
      imageSize,
      useSound: r.u8(),
      soundPlayTimes: r.u8(),
      stackSize: r.u8(),
      defaultStackSize: r.u8(),
      race: r.u16() as Race,
      categories: r.u16(),
      type: r.u16(),
      effectMask: r.u16(),
      effect: r.i16(),
      potionPowerOrBookChance: r.u16(),
      alternativeEffect: r.u16(),
      modifierMask: r.u16(),
      modifier: r.i16(),
      dullChance: r.u16(),
      maxDullAmount: r.u16(),
      minCondition: r.u16(),
    });
  }
  const scrollValues: number[] = [];
  while (r.remaining >= 2) scrollValues.push(r.u16());
  return { items, scrollValues };
}
