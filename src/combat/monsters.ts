/**
 * Monster names (MNAMES.DAT) and sprite sets (BNAMES.DAT). See docs/formats/combat.md.
 * Both files are `u32 count`, `count` u16 offsets, then records the offsets point into.
 */

import { Reader } from '../formats/reader';

function cString(bytes: Uint8Array, at: number): { text: string; end: number } {
  let end = at;
  while (end < bytes.length && bytes[end] !== 0) end++;
  return { text: String.fromCharCode(...bytes.subarray(at, end)), end: end + 1 };
}

function offsets(bytes: Uint8Array): { start: number; offsets: number[] } {
  const r = new Reader(bytes);
  const count = r.u32();
  const list: number[] = [];
  for (let i = 0; i < count; i++) list.push(r.u16());
  return { start: r.pos, offsets: list };
}

/** Names indexed by monster index. Index 0 is a placeholder; monster `n` is record `n - 1` of the file. */
export function parseMonsterNames(bytes: Uint8Array): string[] {
  const { start, offsets: list } = offsets(bytes);
  const names = ['INVALID MONSTER'];
  for (const o of list) names.push(start + o >= bytes.length ? 'INVALID MONSTER' : cString(bytes, start + o).text);
  return names;
}

export interface MonsterSprites {
  /** File name prefix, e.g. `OWYN` for OWYN0.BMX. Empty when the monster has no sprites. */
  prefix: string;
  /** Suffix numbers of the (up to three) BMX files holding the sprites, in order. */
  suffixes: [number, number, number];
  /** Colour-swap table number (CSn.DAT) applied to the palette; above 9 means none. */
  colorSwap: number;
}

/** Sprite sets indexed by monster index; index 0 is an empty placeholder. */
export function parseMonsterSprites(bytes: Uint8Array): MonsterSprites[] {
  const { start, offsets: list } = offsets(bytes);
  const out: MonsterSprites[] = [{ prefix: '', suffixes: [0, 0, 0], colorSwap: 255 }];
  for (const o of list) {
    const at = start + o;
    if (at >= bytes.length) continue;
    const { text, end } = cString(bytes, at);
    out.push({
      prefix: text,
      suffixes: [bytes[end] ?? 0, bytes[end + 1] ?? 0, bytes[end + 2] ?? 0],
      colorSwap: bytes[end + 3] ?? 255,
    });
  }
  return out;
}

/** Ghosts take no damage from a plain weapon in BaKGL's resistance table; kept for the AI and log. */
export const GHOST_MONSTERS = [49, 56, 57] as const;
