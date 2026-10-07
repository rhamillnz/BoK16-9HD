import { Reader } from './reader';

/**
 * GDS scenes: towns, temples, inns and shops shown as a 2D screen with clickable hotspots.
 * See docs/formats/towns.md. Layout learned from xavieran/BaKGL (`bak/hotspot.cpp`,
 * `bak/encounter/gdsEntry.ipp`); this parser is our own.
 */

/** What clicking a hotspot does once its dialogue (if any) has finished. */
export const HotspotAction = {
  Unknown0: 0,
  Unknown1: 1,
  Dialog: 2,
  Exit: 3,
  Goto: 4,
  Barmaid: 5,
  Shop: 6,
  Inn: 7,
  Container: 8,
  Lute: 9,
  Repair2: 0xa,
  Teleport: 0xb,
  UnknownC: 0xc,
  Temple: 0xd,
  UnknownE: 0xe,
  ChapterEnd: 0xf,
  Repair: 0x10,
} as const;

export interface Hotspot {
  /** Position in the file; scene-local id. */
  index: number;
  /** Rectangle in 320x200 scene pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Bit n set (n = chapter - 1) hides the hotspot in that chapter; 0x8000 = act as soon as the scene opens. */
  chapterMask: number;
  /** Cursor index + 1. */
  keyword: number;
  action: number;
  unknownD: number;
  /** Goto: the GDS letter index to jump to (see `gdsLetter`). */
  arg1: number;
  /** Scene index (ADS) to show while the dialogue runs; 0 = unchanged. */
  arg2: number;
  /** Dialogue key started by a left click (0 or 0x10000 = none). */
  arg3: number;
  /** Dialogue key shown by a right click. */
  tooltip: number;
  unknown1a: number;
  /** Event-flag condition: low 16 bits = flag pointer, high 16 bits = expected value (see `hotspotActive`). */
  dialog: number;
  checkEventState: number;
}

export interface GdsScene {
  /** Resource base name; the scene scripts are `<name>.TTM` and `<name>.ADS`. */
  resource: string;
  ttm: string;
  ads: string;
  /** Bit 0x80 set: this is a temple and the low 7 bits are its number. */
  templeIndex: number;
  song: number;
  /** ADS scene index of the background / of the foreground (NPC) layer. */
  sceneIndex1: number;
  sceneIndex2: number;
  /** Dialogue key of the scene's introductory text (0 = none). */
  flavourText: number;
  hotspots: Hotspot[];
}

export const HOTSPOT_SIZE = 36;

/** Decode one GDS file (`GDS<number><letter>.DAT`). */
export function parseGds(bytes: Uint8Array): GdsScene {
  const r = new Reader(bytes);
  r.u16(); // length
  const resource = r.fixedString(6).toUpperCase();
  r.skip(6);
  r.u8();
  const templeIndex = r.u8();
  r.skip(3);
  const song = r.u16();
  r.u16();
  const sceneIndex1 = r.u16();
  r.u16();
  const sceneIndex2 = r.u16();
  const count = r.u16();
  let flavourText = r.u32();
  if (flavourText === 0x10000) flavourText = 0;
  r.skip(8);

  const hotspots: Hotspot[] = [];
  for (let index = 0; index < count && r.remaining >= HOTSPOT_SIZE; index++) {
    hotspots.push({
      index,
      x: r.u16(),
      y: r.u16(),
      width: r.u16(),
      height: r.u16(),
      chapterMask: r.u16(),
      keyword: r.u16(),
      action: r.u8(),
      unknownD: r.u8(),
      arg1: r.u16(),
      arg2: r.u16(),
      arg3: r.u32(),
      tooltip: r.u32(),
      unknown1a: r.u32(),
      dialog: r.u32(),
      checkEventState: r.u16(),
    });
  }
  return { resource, ttm: `${resource}.TTM`, ads: `${resource}.ADS`, templeIndex, song, sceneIndex1, sceneIndex2, flavourText, hotspots };
}

/** Temple number of a scene, or undefined when it is not a temple. */
export const templeNumber = (s: GdsScene): number | undefined => (s.templeIndex & 0x80 ? s.templeIndex & 0x7f : undefined);

/** `GDS` scene letter for an index: 0 and 1 are both 'A', then B, C... (BaKGL `MakeHotspotChar`). */
export function gdsLetter(n: number): string {
  return String.fromCharCode(n === 0 ? 65 : 65 + n - 1);
}

export interface GdsRef {
  /** Town number (1..). */
  number: number;
  /** Letter 'A'.. selecting one scene of the town. */
  letter: string;
}

export const gdsFileName = (ref: GdsRef): string => `GDS${ref.number}${ref.letter}.DAT`;

/** True when a left click starts a dialogue (the key is neither 0 nor the 0x10000 "none" marker). */
export const hotspotHasDialog = (h: Hotspot): boolean => h.arg3 !== 0 && h.arg3 !== 0x10000;

/** A town or background encounter's entry in DEF_TOWN.DAT / DEF_BKGR.DAT. */
export interface TownEntry {
  ref: GdsRef;
  /** Dialogue key asked before entering (0 = enter at once). */
  entryDialog: number;
  /** Dialogue key shown when the party leaves (0 = none). */
  exitDialog: number;
  /** Where the party stands outside the town, as a cell offset within the encounter's tile. */
  exitCellX: number;
  exitCellY: number;
  /** Raw u16; the 8-bit heading is its high byte. */
  exitHeading: number;
  walkToDest: boolean;
}

export const TOWN_ENTRY_SIZE = 22;

/** DEF_TOWN.DAT and DEF_BKGR.DAT: u32 count, then 22-byte entries. */
export function parseTownTable(bytes: Uint8Array): TownEntry[] {
  const r = new Reader(bytes);
  const count = Math.min(r.u32(), Math.floor((bytes.length - 4) / TOWN_ENTRY_SIZE));
  const out: TownEntry[] = [];
  for (let i = 0; i < count; i++) {
    r.skip(3);
    const number = r.u8();
    const letter = gdsLetter(r.u8());
    r.skip(2);
    const entryDialog = r.u32();
    const exitDialog = r.u32();
    const exitCellX = r.u8();
    const exitCellY = r.u8();
    const exitHeading = r.u16();
    const walkToDest = r.u8() === 1;
    r.skip(2);
    out.push({ ref: { number, letter }, entryDialog, exitDialog, exitCellX, exitCellY, exitHeading, walkToDest });
  }
  return out;
}
