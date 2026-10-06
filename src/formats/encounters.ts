import { Reader } from './reader';

/**
 * Per-tile encounter records from TzzXXYY.DAT. See docs/formats/zones-and-models.md §3.6.
 *
 * Each tile file holds one block per chapter; a block is a u16 count followed by up to
 * 10 records of 19 bytes. The record's `tableIndex` selects an entry in a per-type
 * definition file (DEF_COMB.DAT, DEF_DIAL.DAT, ...), which is not resolved here.
 */

export const ENCOUNTER_RECORD_SIZE = 0x13;
export const MAX_ENCOUNTERS_PER_TILE = 10;
export const ENCOUNTER_BLOCK_SIZE = ENCOUNTER_RECORD_SIZE * MAX_ENCOUNTERS_PER_TILE + 2;

/** Encounter categories (LIST_TYP.DAT order). */
export const EncounterType = {
  Background: 0,
  Combat: 1,
  Comment: 2,
  Dialog: 3,
  Health: 4,
  Sound: 5,
  Town: 6,
  Trap: 7,
  Zone: 8,
  Disable: 9,
  Enable: 10,
  Block: 11,
} as const;

/** Discriminator names for each known type id. Background is a GDS scene like Town. */
export type EncounterKind =
  | 'background' | 'combat' | 'comment' | 'dialog' | 'health' | 'sound'
  | 'town' | 'trap' | 'zone' | 'disable' | 'enable' | 'block';

const KIND_BY_TYPE: readonly EncounterKind[] = [
  'background', 'combat', 'comment', 'dialog', 'health', 'sound',
  'town', 'trap', 'zone', 'disable', 'enable', 'block',
];

/**
 * Typed view of what an encounter does. `tableIndex` indexes the matching DEF_*.DAT.
 * - background/town: enter a GDS scene (town, temple, inn...)
 * - combat/trap: start a fight; traps also place combatants
 * - dialog/block: run a dialogue; block also stops the party
 * - zone: transition to another zone
 * - enable/disable: set or clear an event flag (with a percent chance)
 * - comment/health/sound: defined by the type list, but BaKGL has no definition files for them
 */
export type EncounterAction =
  | { kind: EncounterKind; tableIndex: number }
  | { kind: 'unknown'; typeId: number; tableIndex: number };

export interface EncounterRecord {
  /** Position of the record in the chapter block (0..9). */
  index: number;
  typeId: number;
  action: EncounterAction;
  /** Trigger rectangle in tile cells (0..39), inclusive on all sides. top >= bottom in BaK's north-up y. */
  left: number;
  top: number;
  right: number;
  bottom: number;
  tableIndex: number;
  unknown0: number;
  unknown1: number;
  /** Non-zero: once triggered it stays off for the rest of the chapter (unless repeatable). */
  chapterFlag: number;
  /** Event flag that must be set (0 = none). */
  requiredState: number;
  /** Event flag that disables the encounter when set (0 = none). */
  inhibitState: number;
  /** Event flag set when the encounter completes (0 = none). */
  completionState: number;
  /** Non-zero: can fire every time the party enters. */
  repeatable: number;
}

export function encounterAction(typeId: number, tableIndex: number): EncounterAction {
  const kind = KIND_BY_TYPE[typeId];
  return kind ? { kind, tableIndex } : { kind: 'unknown', typeId, tableIndex };
}

/** Records of one chapter's block (chapter is 1-based). Throws if the block is cut off. */
export function parseTileEncounters(bytes: Uint8Array, chapter: number): EncounterRecord[] {
  if (!Number.isInteger(chapter) || chapter < 1) throw new RangeError(`bad chapter ${chapter}`);
  const r = new Reader(bytes, (chapter - 1) * ENCOUNTER_BLOCK_SIZE);
  const count = Math.min(r.u16(), MAX_ENCOUNTERS_PER_TILE);
  const out: EncounterRecord[] = [];
  for (let index = 0; index < count; index++) {
    const typeId = r.u16();
    const left = r.u8();
    const top = r.u8();
    const right = r.u8();
    const bottom = r.u8();
    const tableIndex = r.u16();
    out.push({
      index,
      typeId,
      action: encounterAction(typeId, tableIndex),
      left, top, right, bottom,
      tableIndex,
      unknown0: r.u8(),
      unknown1: r.u8(),
      chapterFlag: r.u8(),
      requiredState: r.u16(),
      inhibitState: r.u16(),
      completionState: r.u16(),
      repeatable: r.u16(),
    });
  }
  return out;
}

/** How many chapter blocks the file holds, judged by its length. */
export function encounterChapterCount(bytes: Uint8Array): number {
  return Math.ceil(bytes.length / ENCOUNTER_BLOCK_SIZE);
}
