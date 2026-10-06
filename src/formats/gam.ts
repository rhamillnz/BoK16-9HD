import { Reader } from './reader';

/**
 * Save-game (`STARTUP.GAM`, `*.GAM`) parser. See docs/formats/savegame.md.
 *
 * A save is one flat, uncompressed image of the game's state; every block lives
 * at a fixed absolute offset. Only the party, location, time and event-flag
 * parts are decoded here. Zone containers, shops and combat state are not.
 */

export const GAM_OFFSETS = {
  chapter: 0x5a,
  mapPosition: 0x5c,
  chapterCopy: 0x64,
  gold: 0x66,
  time: 0x6a,
  location: 0x76,
  followRoad: 0x96,
  characterName: 0x9f,
  characterSkills: 0xdb,
  activeCharacters: 0x315,
  characterConditions: 0x330,
  characterAffectors: 0x35a,
  expiringEvents: 0x616,
  eventFlags: 0x6e2,
  complexEventFlags: 0xb09,
  activeSpells: 0x6b8,
  characterInventory: 0x3a804,
  partyKeys: 0x3aaa4,
} as const;

export const CHARACTER_COUNT = 6;
export const NAME_LENGTH = 10;
/** 2 unknown + 6 spell bytes + 16 skills * 5 + combat index + 6 unknown. */
export const CHARACTER_SKILL_STRIDE = 2 + 6 + 16 * 5 + 1 + 6;
export const CHARACTER_INVENTORY_STRIDE = 0x70;
export const CONDITION_COUNT = 7;
export const AFFECTOR_SLOTS = 8;
export const AFFECTOR_SIZE = 14;
export const ITEM_RECORD_SIZE = 4;

/** Event-flag pointers (see `readEventFlag`) for per-character skill state. */
const SKILL_SELECTED_FLAG = 0x1856;
const SKILL_IMPROVEMENT_FLAG = 0x18ce;
const SKILLS_PER_CHARACTER_FLAGS = 0x11;
const COMPLEX_EVENT_THRESHOLD = 0xdac0;

export const SKILL_NAMES = [
  'health', 'stamina', 'speed', 'strength', 'defense', 'crossbow', 'melee', 'casting',
  'assessment', 'armorcraft', 'weaponcraft', 'barding', 'haggling', 'lockpick', 'scouting', 'stealth',
] as const;
export type SkillName = (typeof SKILL_NAMES)[number];

export const CONDITION_NAMES = [
  'sick', 'plagued', 'poisoned', 'drunk', 'healing', 'starving', 'nearDeath',
] as const;
export type ConditionName = (typeof CONDITION_NAMES)[number];

/** Item status bit indices (bit n of the status byte). */
export const ITEM_STATUS_BITS = {
  activated: 1,
  used: 2,
  broken: 4,
  repairable: 5,
  equipped: 6,
  poisoned: 7,
} as const;

/** Game time: one tick is two game seconds. */
export interface GameTime {
  ticks: number;
  seconds: number;
  days: number;
  hour: number;
  minute: number;
}

export interface Skill {
  max: number;
  trueSkill: number;
  current: number;
  experience: number;
  /** Signed. */
  modifier: number;
  /** From event flags: skill is ticked in the skill-selection pool. */
  selected: boolean;
  /** From event flags: improved since last viewed. */
  unseenImprovement: boolean;
}

export interface SkillAffector {
  type: number;
  /** Skill index (0..15) from the single-bit mask, or -1 if the mask is not a single bit. */
  skill: number;
  skillMask: number;
  adjustment: number;
  startTime: number;
  endTime: number;
}

export interface InventoryItem {
  /** Index into OBJINFO.DAT (see items.md); this module does not interpret it. */
  itemIndex: number;
  /**
   * Raw byte. Condition %, charges or quantity depending on the item's
   * ConditionBased/ChargeBased/QuantityBased flag in its definition.
   */
  conditionOrQuantity: number;
  status: number;
  modifiers: number;
  activated: boolean;
  used: boolean;
  broken: boolean;
  repairable: boolean;
  equipped: boolean;
  poisoned: boolean;
}

export interface Inventory {
  capacity: number;
  items: InventoryItem[];
}

export interface Character {
  index: number;
  name: string;
  /** UNKNOWN: two bytes at the start of the skill block (BaKGL calls it characterNameOffset). */
  unknownHeader: Uint8Array;
  /** Raw 48-bit spell bitfield, little-endian byte order. */
  spellBytes: Uint8Array;
  /** Indices of set bits in `spellBytes`. */
  spells: number[];
  skills: Record<SkillName, Skill>;
  /** UNKNOWN meaning (BaKGL: combatCharIndex). */
  combatCharIndex: number;
  /** UNKNOWN: six bytes after the combat index. */
  unknownTrailer: Uint8Array;
  conditions: Record<ConditionName, number>;
  affectors: SkillAffector[];
  inventory: Inventory;
}

export interface ExpiringEvent {
  /** 0 none, 1 light, 2 spell, 3 set state, 4 reset state. */
  type: number;
  flags: number;
  data: number;
  duration: number;
}

export interface GamSave {
  chapter: number;
  /** Second copy of the chapter at 0x64; normally equal to `chapter`. */
  chapterCopy: number;
  mapPosition: { x: number; y: number; heading: number };
  gold: number;
  time: GameTime;
  timeLastSlept: GameTime;
  location: {
    zone: number;
    tileX: number;
    tileY: number;
    x: number;
    y: number;
    /** UNKNOWN: five bytes between position and heading. */
    unknown: Uint8Array;
    /** Raw u16; the angular scale is not verified. */
    heading: number;
  };
  followRoad: boolean;
  characters: Character[];
  /** Character indices (0..5) in the active party, in order. */
  activeCharacters: number[];
  partyKeys: Inventory;
  expiringEvents: ExpiringEvent[];
  /** Raw u16 bitmask of active spells. */
  activeSpells: number;
  /** The save bytes, for reading event flags. */
  bytes: Uint8Array;
}

export function decodeTime(ticks: number): GameTime {
  const seconds = ticks * 2;
  const hours = Math.floor(seconds / 3600);
  return {
    ticks,
    seconds,
    days: Math.floor(hours / 24),
    hour: hours % 24,
    minute: Math.floor(seconds / 60) % 60,
  };
}

/** Byte and bit of an event pointer. Flags are bits within little-endian u16 words. */
export function eventFlagLocation(ptr: number): { byte: number; bit: number } {
  if (ptr >= COMPLEX_EVENT_THRESHOLD) {
    const source = (ptr + 0x2540) & 0xffff;
    const rem = source % 10;
    return {
      byte: Math.floor(source / 10) + GAM_OFFSETS.complexEventFlags,
      bit: rem !== 0 ? rem - 1 : 0,
    };
  }
  return { byte: ((ptr >> 3) & 0xfffe) + GAM_OFFSETS.eventFlags, bit: ptr & 0xf };
}

export function readEventFlag(bytes: Uint8Array, ptr: number): boolean {
  const { byte, bit } = eventFlagLocation(ptr);
  if (byte + 2 > bytes.length) {
    throw new RangeError(`event flag 0x${ptr.toString(16)} at ${byte} past end (${bytes.length})`);
  }
  const word = bytes[byte]! | (bytes[byte + 1]! << 8);
  return ((word >> bit) & 1) === 1;
}

function readTime(r: Reader): number {
  return r.u32();
}

function readInventory(r: Reader, offset: number): Inventory {
  r.pos = offset;
  const count = r.u8();
  const capacity = r.u16();
  if (count > capacity) {
    throw new RangeError(`inventory at 0x${offset.toString(16)} has ${count} items for capacity ${capacity}`);
  }
  const items: InventoryItem[] = [];
  for (let i = 0; i < count; i++) {
    const itemIndex = r.u8();
    const conditionOrQuantity = r.u8();
    const status = r.u8();
    const modifiers = r.u8();
    const bit = (n: number) => ((status >> n) & 1) === 1;
    items.push({
      itemIndex,
      conditionOrQuantity,
      status,
      modifiers,
      activated: bit(ITEM_STATUS_BITS.activated),
      used: bit(ITEM_STATUS_BITS.used),
      broken: bit(ITEM_STATUS_BITS.broken),
      repairable: bit(ITEM_STATUS_BITS.repairable),
      equipped: bit(ITEM_STATUS_BITS.equipped),
      poisoned: bit(ITEM_STATUS_BITS.poisoned),
    });
  }
  return { capacity, items };
}

function readCharacter(bytes: Uint8Array, r: Reader, index: number): Character {
  r.pos = GAM_OFFSETS.characterName + index * NAME_LENGTH;
  const name = r.fixedString(NAME_LENGTH);

  r.pos = GAM_OFFSETS.characterSkills + index * CHARACTER_SKILL_STRIDE;
  const unknownHeader = bytes.slice(r.pos, r.pos + 2);
  r.skip(2);
  const spellBytes = bytes.slice(r.pos, r.pos + 6);
  r.skip(6);
  const spells: number[] = [];
  for (let bit = 0; bit < 48; bit++) {
    if (((spellBytes[bit >> 3]! >> (bit & 7)) & 1) === 1) spells.push(bit);
  }

  const skills = {} as Record<SkillName, Skill>;
  SKILL_NAMES.forEach((skillName, i) => {
    const max = r.u8();
    const trueSkill = r.u8();
    const current = r.u8();
    const experience = r.u8();
    const modifier = (r.u8() << 24) >> 24;
    const flagOffset = index * SKILLS_PER_CHARACTER_FLAGS + i;
    skills[skillName] = {
      max,
      trueSkill,
      current,
      experience,
      modifier,
      selected: readEventFlag(bytes, SKILL_SELECTED_FLAG + flagOffset),
      unseenImprovement: readEventFlag(bytes, SKILL_IMPROVEMENT_FLAG + flagOffset),
    };
  });
  const combatCharIndex = r.u8();
  const unknownTrailer = bytes.slice(r.pos, r.pos + 6);
  r.skip(6);

  r.pos = GAM_OFFSETS.characterConditions + index * CONDITION_COUNT;
  const conditions = {} as Record<ConditionName, number>;
  for (const c of CONDITION_NAMES) conditions[c] = r.u8();

  r.pos = GAM_OFFSETS.characterAffectors + index * AFFECTOR_SLOTS * AFFECTOR_SIZE;
  const affectors: SkillAffector[] = [];
  for (let i = 0; i < AFFECTOR_SLOTS; i++) {
    const type = r.u16();
    if (type === 0) {
      r.skip(AFFECTOR_SIZE - 2);
      continue;
    }
    const skillMask = r.u16();
    const adjustment = r.i16();
    const startTime = readTime(r);
    const endTime = readTime(r);
    const skill = skillMask !== 0 && (skillMask & (skillMask - 1)) === 0 ? Math.log2(skillMask) : -1;
    affectors.push({ type, skill, skillMask, adjustment, startTime, endTime });
  }

  const inventory = readInventory(r, GAM_OFFSETS.characterInventory + index * CHARACTER_INVENTORY_STRIDE);
  return {
    index, name, unknownHeader, spellBytes, spells, skills, combatCharIndex,
    unknownTrailer, conditions, affectors, inventory,
  };
}

export function parseGam(bytes: Uint8Array): GamSave {
  const r = new Reader(bytes);
  r.pos = GAM_OFFSETS.chapter;
  const chapter = r.u16();
  const mapPosition = { x: r.u16(), y: r.u16(), heading: r.u16() };
  r.pos = GAM_OFFSETS.chapterCopy;
  const chapterCopy = r.u16();
  r.pos = GAM_OFFSETS.gold;
  const gold = r.u32();
  r.pos = GAM_OFFSETS.time;
  const time = decodeTime(r.u32());
  const timeLastSlept = decodeTime(r.u32());

  r.pos = GAM_OFFSETS.location;
  const zone = r.u8();
  const tileX = r.u8();
  const tileY = r.u8();
  const x = r.u32();
  const y = r.u32();
  const unknown = bytes.slice(r.pos, r.pos + 5);
  r.skip(5);
  const heading = r.u16();

  r.pos = GAM_OFFSETS.followRoad;
  const followRoad = r.u8() !== 0;

  const characters: Character[] = [];
  for (let i = 0; i < CHARACTER_COUNT; i++) characters.push(readCharacter(bytes, r, i));

  r.pos = GAM_OFFSETS.activeCharacters;
  const activeCount = r.u8();
  const activeCharacters: number[] = [];
  for (let i = 0; i < activeCount; i++) activeCharacters.push(r.u8());

  const partyKeys = readInventory(r, GAM_OFFSETS.partyKeys);

  r.pos = GAM_OFFSETS.expiringEvents;
  const eventCount = r.u16();
  const expiringEvents: ExpiringEvent[] = [];
  for (let i = 0; i < eventCount; i++) {
    expiringEvents.push({ type: r.u8(), flags: r.u8(), data: r.u16(), duration: r.u32() });
  }

  r.pos = GAM_OFFSETS.activeSpells;
  const activeSpells = r.u16();

  return {
    chapter, chapterCopy, mapPosition, gold, time, timeLastSlept,
    location: { zone, tileX, tileY, x, y, unknown, heading },
    followRoad, characters, activeCharacters, partyKeys, expiringEvents, activeSpells, bytes,
  };
}
