import { describe, expect, it } from 'vitest';
import type { Character, InventoryItem } from '../formats/gam';
import type { GdsRef } from '../formats/gds';
import {
  CHAPTER_EXPIRY_STEPS, CHAPTER_START_FLAGS, TOWN_STASH_RULES,
  applyChapterFlags, applyChapterRules, applyTownStashes, runExpirySteps, type TownStash, type TownStashRule, type TownStashSource,
} from './chapterRules';
import type { PartyState } from './party';
import { getFlag, type WorldState } from './state';

const item = (itemIndex: number): InventoryItem => ({
  itemIndex, conditionOrQuantity: 1, status: 0, modifiers: 0,
  activated: false, used: false, broken: false, repairable: false, equipped: false, poisoned: false,
});
const char = (index: number, items: InventoryItem[]): Character => ({ index, name: `c${index}`, inventory: { capacity: 4, items } } as unknown as Character);
const party = (chars: Character[]): PartyState => ({ gold: 0, characters: chars, activeCharacters: chars.map((c) => c.index), partyKeys: { capacity: 4, items: [] } });
const world = (expiring: WorldState['expiringEvents'] = []): WorldState => ({ chapter: 1, ticks: 0, ticksLastSlept: 0, bytes: new Uint8Array(0x2000), expiringEvents: expiring });
const ref: GdsRef = { number: 5, letter: 'B' };
const key = (r: GdsRef) => `${r.number}${r.letter}`;
function towns(initial: Record<string, TownStash>): TownStashSource & { map: Record<string, TownStash> } {
  const map = { ...initial };
  return { map, get: (r) => map[key(r)], set: (r, s) => { map[key(r)] = s; } };
}
const store: TownStashRule = { chapter: 2, who: 0, town: ref, mode: 'store' };
const fetch: TownStashRule = { chapter: 6, who: 0, town: ref, mode: 'fetch' };

describe('chapter rule tables', () => {
  it('are empty until real values are verified', () => {
    expect(TOWN_STASH_RULES).toHaveLength(0);
    expect(Object.keys(CHAPTER_START_FLAGS)).toHaveLength(0);
    expect(Object.keys(CHAPTER_EXPIRY_STEPS)).toHaveLength(0);
  });
  it('leave the world and party untouched', () => {
    const w = world(); const p = party([char(0, [item(1)])]);
    expect(applyChapterRules({ world: w, party: p, chapter: 7, towns: towns({}) })).toEqual({ world: w, party: p });
  });
});

describe('town stashes', () => {
  it('store moves the pack into the container', () => {
    const src = towns({ [key(ref)]: { capacity: 3, items: [] } });
    const out = applyTownStashes(party([char(0, [item(1), item(2), item(3), item(4)])]), 2, src, [store]);
    expect(out.characters[0]!.inventory.items).toEqual([]);
    expect(src.map[key(ref)]!.items.map((i) => i.itemIndex)).toEqual([1, 2, 3]);
  });
  it('fetch moves the container into the pack and empties it', () => {
    const src = towns({ [key(ref)]: { capacity: 3, items: [item(7), item(8)] } });
    const out = applyTownStashes(party([char(0, [item(1)])]), 6, src, [fetch]);
    expect(out.characters[0]!.inventory.items.map((i) => i.itemIndex)).toEqual([7, 8]);
    expect(src.map[key(ref)]!.items).toEqual([]);
  });
  it('ignores other chapters, missing containers, missing characters and a missing source', () => {
    const p = party([char(0, [item(1)])]);
    expect(applyTownStashes(p, 3, towns({ [key(ref)]: { capacity: 3, items: [] } }), [store])).toBe(p);
    expect(applyTownStashes(p, 2, towns({}), [store])).toBe(p);
    expect(applyTownStashes(p, 2, towns({ [key(ref)]: { capacity: 3, items: [] } }), [{ ...store, who: 9 }])).toBe(p);
    expect(applyTownStashes(p, 2, undefined, [store])).toBe(p);
  });
});

describe('chapter flags and expiry steps', () => {
  it('sets the listed flags for the chapter only', () => {
    const w = applyChapterFlags(world(), 7, { 7: [0x1ab1] });
    expect(getFlag(w, 0x1ab1)).toBe(true);
    expect(getFlag(applyChapterFlags(world(), 6, { 7: [0x1ab1] }), 0x1ab1)).toBe(false);
  });
  it('runs half-hour steps that fire finished events without moving the clock', () => {
    const ev = { type: 3, flags: 0, data: 0x1234, duration: 0x384 * 3 };
    const w = runExpirySteps(world([ev]), 2);
    expect(w.expiringEvents).toHaveLength(1);
    expect(w.expiringEvents[0]!.duration).toBe(0x384);
    const done = runExpirySteps(w, 1);
    expect(done.expiringEvents).toHaveLength(0);
    expect(getFlag(done, 0x1234)).toBe(true);
    expect(done.ticks).toBe(0);
  });
  it('applyChapterRules combines all three', () => {
    const src = towns({ [key(ref)]: { capacity: 3, items: [] } });
    const out = applyChapterRules({
      world: world([{ type: 3, flags: 0, data: 0x20, duration: 0x384 }]), party: party([char(0, [item(1)])]), chapter: 2, towns: src,
      rules: { stashes: [store], flags: { 2: [0x30] }, expirySteps: { 2: 1 } },
    });
    expect(out.party.characters[0]!.inventory.items).toEqual([]);
    expect(getFlag(out.world, 0x30)).toBe(true);
    expect(getFlag(out.world, 0x20)).toBe(true);
  });
});
