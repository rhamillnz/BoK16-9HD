/**
 * Combat data on disk: the combat table (DEF_COMB.DAT), the combat blocks of the save image and
 * the party's starting grid cells (P1.DAT). See docs/formats/combat.md.
 */

import { Reader } from '../formats/reader';
import { SKILL_NAMES, type SkillName } from '../formats/gam';

/** A position in BaK world units with an 8-bit heading. */
export interface PlacedPosition {
  x: number;
  y: number;
  heading: number;
}

/** One monster of a combat as DEF_COMB.DAT places it in the world (before the fight starts). */
export interface CombatantSpawn {
  /** Monster index (MNAMES.DAT / COMBAT.TBL slot). */
  monster: number;
  /** 0 stationary, 1 and 2 straight line, 3 and 4 follow the road. */
  movementType: number;
  position: PlacedPosition;
}

export interface CombatDef {
  /** Key into the save's combat blocks. */
  combatIndex: number;
  /** DEF_DIAL-style dialogue keys; 0 when none. */
  entryDialog: number;
  scoutDialog: number;
  /** Where the party ends up after a retreat, in tile-relative units. */
  retreat: { north: PlacedPosition; west: PlacedPosition; south: PlacedPosition; east: PlacedPosition };
  combatants: CombatantSpawn[];
  /** Hidden until scouted. */
  ambush: boolean;
}

export const COMBAT_RECORD_SIZE = 400;
const COMBATANT_SLOTS = 7;
const COMBATANT_SIZE = 48;

/** `DEF_COMB.DAT`: u32 count, then fixed 400-byte records. */
export function parseCombatTable(bytes: Uint8Array): CombatDef[] {
  const r = new Reader(bytes);
  const count = r.u32();
  const defs: CombatDef[] = [];
  const position = (): PlacedPosition => ({ x: r.u32(), y: r.u32(), heading: r.u16() >> 8 });
  for (let i = 0; i < count; i++) {
    r.skip(3);
    const combatIndex = r.u32();
    const entryDialog = r.u32();
    const scoutDialog = r.u32();
    r.skip(4);
    const north = position();
    const west = position();
    const south = position();
    const east = position();
    const enemyCount = r.u8();
    const combatants: CombatantSpawn[] = [];
    for (let k = 0; k < COMBATANT_SLOTS; k++) {
      const start = r.pos;
      if (k < enemyCount) {
        const monster = r.u16();
        const movementType = r.u16();
        combatants.push({ monster, movementType, position: position() });
      }
      r.pos = start + COMBATANT_SIZE;
    }
    r.skip(2);
    const ambush = r.u16() === 1;
    defs.push({ combatIndex, entryDialog, scoutDialog, retreat: { north, west, south, east }, combatants, ambush });
  }
  return defs;
}

// --- Save image blocks -------------------------------------------------------------------

export const COMBAT_SAVE = {
  entityLists: 0x1383,
  entityListCount: 700,
  gridLocations: 0x31349,
  gridLocationCount: 1699,
  stats: 0x914b,
  statsCount: 1699,
} as const;

const ENTITY_LIST_SIZE = 7 * 2;
export const GRID_LOCATION_SIZE = 22;
const STATS_SIZE = 2 + 6 + 16 * 5 + 1 + 6;
const STATE_DEAD = 0x02;
const NO_COMBATANT = 0xffff;

/** One monster fighter of a combat, decoded from the save. */
export interface EnemyRecord {
  /** Index into the save's combatant tables. */
  combatant: number;
  monster: number;
  gridX: number;
  gridY: number;
  dead: boolean;
  retreatFactor: number;
  skills: Record<SkillName, { max: number; trueSkill: number; modifier: number }>;
}

/** The enemies of one combat, read from the save's entity list, grid locations and stats. */
export function readCombatEnemies(save: Uint8Array, combatIndex: number): EnemyRecord[] {
  if (combatIndex < 0 || combatIndex >= COMBAT_SAVE.entityListCount) return [];
  const r = new Reader(save, COMBAT_SAVE.entityLists + combatIndex * ENTITY_LIST_SIZE);
  const enemies: EnemyRecord[] = [];
  for (let i = 0; i < 7; i++) {
    const c = r.u16();
    if (c === NO_COMBATANT || c >= COMBAT_SAVE.gridLocationCount) continue;
    const loc = new Reader(save, COMBAT_SAVE.gridLocations + c * GRID_LOCATION_SIZE);
    loc.skip(2);
    const monster = loc.u16();
    const gridX = loc.u8();
    const gridY = loc.u8();
    loc.skip(2);
    const state = loc.u8();
    loc.skip(5);
    const retreatFactor = loc.u8();
    const st = new Reader(save, COMBAT_SAVE.stats + c * STATS_SIZE + 8);
    const skills = {} as EnemyRecord['skills'];
    for (const name of SKILL_NAMES) {
      const max = st.u8();
      const trueSkill = st.u8();
      st.skip(2);
      const modifier = (st.u8() << 24) >> 24;
      skills[name] = { max, trueSkill, modifier };
    }
    enemies.push({ combatant: c, monster, gridX, gridY, dead: (state & STATE_DEAD) !== 0, retreatFactor, skills });
  }
  return enemies;
}

/** A party member's starting cell and combat sprite, from `P1.DAT` (six 22-byte grid records). */
export interface PartyGridSlot {
  monster: number;
  gridX: number;
  gridY: number;
}

export function parsePartyGrid(bytes: Uint8Array): PartyGridSlot[] {
  const slots: PartyGridSlot[] = [];
  for (let i = 0; i < 6 && (i + 1) * GRID_LOCATION_SIZE <= bytes.length; i++) {
    const r = new Reader(bytes, i * GRID_LOCATION_SIZE + 2);
    slots.push({ monster: r.u16(), gridX: r.u8(), gridY: r.u8() });
  }
  return slots;
}

// --- Retreat -----------------------------------------------------------------------------

export type RetreatSide = 'north' | 'west' | 'south' | 'east';

/**
 * Which retreat point to use: the side of the encounter the party stands on, judged by the larger
 * axis of its offset from the encounter's centre. BaKGL does this in code we have not read, so the
 * rule is a stand-in (**unverified**).
 */
export function retreatSide(party: { x: number; y: number }, centre: { x: number; y: number }): RetreatSide {
  const dx = party.x - centre.x;
  const dy = party.y - centre.y;
  if (Math.abs(dy) >= Math.abs(dx)) return dy >= 0 ? 'north' : 'south';
  return dx >= 0 ? 'east' : 'west';
}
