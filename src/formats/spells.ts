import { Reader } from './reader';

/**
 * Spell table (`SPELLS.DAT`). Layout described in docs/formats/spells.md; written independently
 * from reading BaKGL's `bak/spells.cpp`.
 */

/** How a spell's `damage` number is turned into an amount (names from BaKGL; meanings partly guessed). */
export const SpellCalc = {
  NonCostRelated: 0,
  FixedAmount: 1,
  CostTimesDamage: 2,
  CostTimesDuration: 3,
  Special1: 4,
  Special2: 5,
} as const;

export interface SpellDef {
  /** Position in SPELLS.DAT; the spell number used in character spell bitfields and on scrolls. */
  index: number;
  name: string;
  minCost: number;
  maxCost: number;
  /** The flag BaKGL calls "martial": a spell meant for combat. */
  combat: boolean;
  /** 0, 1, 4 enemies; 2, 3 allies; 5, 6 empty cells (BaKGL's observations). */
  targeting: number;
  /** Effect sprite colour, absent when the file holds 0xffff. */
  color?: number;
  animation?: number;
  /** Item that must be carried to cast, absent when 0xffff. */
  objectRequired?: number;
  calc: number;
  damage: number;
  duration: number;
}

const NONE = 0xffff;

/** Parse SPELLS.DAT: u16 count, 11 u16 per spell, a u16 gap, then NUL-terminated names at the recorded offsets. */
export function parseSpells(bytes: Uint8Array): SpellDef[] {
  const r = new Reader(bytes);
  const count = r.u16();
  const spells: SpellDef[] = [];
  const nameOffsets: number[] = [];
  for (let i = 0; i < count; i++) {
    nameOffsets.push(r.u16());
    const minCost = r.u16();
    const maxCost = r.u16();
    const combat = r.u16() === 1;
    const targeting = r.u16();
    const color = r.u16();
    const animation = r.u16();
    const objectRequired = r.u16();
    const calc = r.u16();
    const damage = r.i16();
    const duration = r.i16();
    spells.push({
      index: i,
      name: '',
      minCost,
      maxCost,
      combat,
      targeting,
      calc,
      damage,
      duration,
      ...(color !== NONE ? { color } : {}),
      ...(animation !== NONE ? { animation } : {}),
      ...(objectRequired !== NONE ? { objectRequired } : {}),
    });
  }
  r.u16();
  const base = r.pos;
  spells.forEach((s, i) => {
    let p = base + nameOffsets[i]!;
    let name = '';
    while (p < bytes.length && bytes[p] !== 0) name += String.fromCharCode(bytes[p++]!);
    s.name = name;
  });
  return spells;
}
