import { describe, expect, it } from 'vitest';
import type { Character, InventoryItem } from '../formats/gam';
import type { GdsRef } from '../formats/gds';
import {
  CHAPTER_EXPIRY_STEPS,
  CHAPTER_START_FLAGS,
  EXPIRY_STEP_TICKS,
  TOWN_STASH_RULES,
  applyChapterFlags,
  applyChapterRules,
  applyTownStashes,
  runExpirySteps,
  type TownStash,
  type TownStashRule,
  type TownStashSource,
} from './chapterRules';
import type { PartyState } from './party';
import { getFlag, type WorldState } from './state';

const item = (itemIndex: number): InventoryItem => ({
  itemIndex,
  conditionOrQuantity: 1,
  status: 0,
  modifiers: 0,
  activated: false,
  used: false,
  broken: false,
  repairable: false,
  equipped: false,
  poisoned: false,
});
const char = (index: number, items: InventoryItem[]): Character =>
  ({ index, name: `c${index}`, inventory: { capacity: 4, items } }) as unknown as Character;
const party = (chars: Character[]): PartyState => ({
  gold: 0,
  characters: chars,
  activeCharacters: chars.map((c) => c.index),
  partyKeys: { capacity: 4, items: [] },
});
const world = (expiring: WorldState['expiringEvents'] = []): WorldState => ({
  chapter: 1,
  ticks: 0,
  ticksLastSlept: 0,
  bytes: new Uint8Array(0x2000),
  expiringEvents: expiring,
});
const ref: GdsRef = { number: 5, letter: 'B' };
const key = (r: GdsRef) => `${r.number}${r.letter}`;
function towns(
  initial: Record<string, TownStash>,
  worldItems: Record<string, InventoryItem[]> = {},
): TownStashSource & { map: Record<string, TownStash> } {
  const map = { ...initial };
  return {
    map,
    get: (r) => map[key(r)],
    set: (r, s) => {
      map[key(r)] = s;
    },
    world: (at) => worldItems[`${at.zone}:${at.x},${at.y}`],
  };
}
const copyPack: TownStashRule = { chapter: 2, mode: 'copyPack', who: 0, town: ref };
const fill: TownStashRule = { chapter: 6, mode: 'fill', town: ref, from: { zone: 0, x: 20, y: 1 } };

describe('chapter rule tables', () => {
  it('hold the values BaKGL uses', () => {
    expect(TOWN_STASH_RULES.map((r) => `${r.chapter}:${r.mode}:${r.town.number}${r.town.letter}`)).toEqual([
      '2:copyPack:2B',
      '6:fill:60C',
      '6:fill:64C',
    ]);
    expect(CHAPTER_START_FLAGS[3]).toEqual([{ ptr: 0x1fbc, value: false }]);
    expect(CHAPTER_START_FLAGS[7]).toEqual([{ ptr: 0x1ab1, value: true }]);
    expect(CHAPTER_EXPIRY_STEPS * EXPIRY_STEP_TICKS).toBe(80 * 0x7530);
  });
  it('leave the party untouched', () => {
    const p = party([char(0, [item(1)])]);
    expect(applyChapterRules({ world: world(), party: p, chapter: 7, towns: towns({}) }).party).toBe(p);
  });
});

describe('town stashes', () => {
  it('copyPack empties the container and copies the pack in, which the character keeps', () => {
    const src = towns({ [key(ref)]: { capacity: 3, items: [item(9)] } });
    const p = party([char(0, [item(1), item(2), item(3), item(4)])]);
    applyTownStashes(p, 2, src, [copyPack]);
    expect(p.characters[0]!.inventory.items).toHaveLength(4);
    expect(src.map[key(ref)]!.items.map((i) => i.itemIndex)).toEqual([1, 2, 3]);
  });
  it('fill empties the container and copies a world container in', () => {
    const src = towns({ [key(ref)]: { capacity: 3, items: [item(9)] } }, { '0:20,1': [item(7), item(8)] });
    applyTownStashes(party([]), 6, src, [fill]);
    expect(src.map[key(ref)]!.items.map((i) => i.itemIndex)).toEqual([7, 8]);
  });
  it('ignores other chapters, missing containers, characters and sources', () => {
    const p = party([char(0, [item(1)])]);
    const untouched = { capacity: 3, items: [item(9)] };
    for (const [chapter, rule, src] of [
      [3, copyPack, towns({ [key(ref)]: untouched })],
      [2, { ...copyPack, who: 9 }, towns({ [key(ref)]: untouched })],
      [6, fill, towns({ [key(ref)]: untouched })],
    ] as const) {
      applyTownStashes(p, chapter, src, [rule]);
      expect(src.map[key(ref)]).toBe(untouched);
    }
    expect(() => applyTownStashes(p, 2, undefined, [copyPack])).not.toThrow();
    expect(() => applyTownStashes(p, 2, towns({}), [copyPack])).not.toThrow();
  });
});

describe('chapter flags and expiry steps', () => {
  it('sets and clears the listed flags for the chapter only', () => {
    const w = applyChapterFlags(world(), 7, { 7: [{ ptr: 0x1ab1, value: true }] });
    expect(getFlag(w, 0x1ab1)).toBe(true);
    expect(getFlag(applyChapterFlags(world(), 6, { 7: [{ ptr: 0x1ab1, value: true }] }), 0x1ab1)).toBe(false);
    expect(getFlag(applyChapterFlags(w, 3, { 3: [{ ptr: 0x1ab1, value: false }] }), 0x1ab1)).toBe(false);
  });
  it('runs steps that fire finished events without moving the clock', () => {
    const ev = { type: 3, flags: 0, data: 0x1234, duration: 0x384 * 3 };
    const w = runExpirySteps(world([ev]), 2, 0x384);
    expect(w.expiringEvents).toHaveLength(1);
    expect(w.expiringEvents[0]!.duration).toBe(0x384);
    const done = runExpirySteps(w, 1, 0x384);
    expect(done.expiringEvents).toHaveLength(0);
    expect(getFlag(done, 0x1234)).toBe(true);
    expect(done.ticks).toBe(0);
  });
  it('applyChapterRules combines all three; by default every timed event runs out', () => {
    const src = towns({ [key(ref)]: { capacity: 3, items: [] } });
    const out = applyChapterRules({
      world: world([{ type: 3, flags: 0, data: 0x20, duration: 0x7530 * 50 }]),
      party: party([char(0, [item(1)])]),
      chapter: 2,
      towns: src,
      rules: { stashes: [copyPack], flags: { 2: [{ ptr: 0x30, value: true }] } },
    });
    expect(src.map[key(ref)]!.items.map((i) => i.itemIndex)).toEqual([1]);
    expect(getFlag(out.world, 0x30)).toBe(true);
    expect(getFlag(out.world, 0x20)).toBe(true);
    expect(out.world.expiringEvents).toHaveLength(0);
  });
});
