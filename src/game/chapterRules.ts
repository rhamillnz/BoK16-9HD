import type { InventoryItem } from '../formats/gam';
import type { GdsRef } from '../formats/gds';
import { updateCharacter, type PartyState } from './party';
import { TIMES, elapseExpiringEvents, setFlag, type WorldState } from './state';

/**
 * Data-driven chapter-start rules that are not yet filled in: town containers that take a
 * character's pack (chapter 2 Locklear's room, chapter 6 Lurough inns), event flags set when a
 * chapter starts (chapter 7's 0x1ab1) and the half-hour expiry steps run at a chapter start. The
 * machinery is here and tested; the tables are empty because the real values are not verified.
 * See docs/formats/chapters.md, "Open values".
 */

/** The stored part of a town container (see `ShopContainer` in formats/gdsContainers.ts). */
export interface TownStash {
  capacity: number;
  items: InventoryItem[];
}

/** The part of the town containers a rule needs. */
export interface TownStashSource {
  get(ref: GdsRef): TownStash | undefined;
  set(ref: GdsRef, stash: TownStash): void;
}

export interface TownStashRule {
  /** Chapter being entered. */
  chapter: number;
  /** Save character slot. */
  who: number;
  town: GdsRef;
  /** `store`: the pack goes into the container and the pack is emptied. `fetch`: the container's items become the pack and it is emptied. */
  mode: 'store' | 'fetch';
}

/** Open values: nothing is listed until the real containers are verified. */
export const TOWN_STASH_RULES: readonly TownStashRule[] = [];
/** Open values: event pointers to set when a chapter starts, by chapter (chapter 7 has 0x1ab1 to place). */
export const CHAPTER_START_FLAGS: Readonly<Record<number, readonly number[]>> = {};
/** Open values: number of half-hour expiry steps run when a chapter starts, by chapter (default 0). */
export const CHAPTER_EXPIRY_STEPS: Readonly<Record<number, number>> = {};

export interface ChapterRules {
  stashes?: readonly TownStashRule[];
  flags?: Readonly<Record<number, readonly number[]>>;
  expirySteps?: Readonly<Record<number, number>>;
}

/** Move packs into or out of town containers as the rules for `chapter` say. Rules whose container or character is missing are skipped. */
export function applyTownStashes(
  party: PartyState, chapter: number, source: TownStashSource | undefined, rules: readonly TownStashRule[] = TOWN_STASH_RULES,
): PartyState {
  if (!source) return party;
  let next = party;
  for (const r of rules) {
    if (r.chapter !== chapter) continue;
    const c = next.characters.find((x) => x.index === r.who);
    const stash = source.get(r.town);
    if (!c || !stash) continue;
    if (r.mode === 'store') {
      source.set(r.town, { capacity: stash.capacity, items: c.inventory.items.slice(0, stash.capacity).map((i) => ({ ...i })) });
      next = updateCharacter(next, r.who, (x) => ({ ...x, inventory: { ...x.inventory, items: [] } }));
    } else {
      const items = stash.items.slice(0, c.inventory.capacity).map((i) => ({ ...i }));
      source.set(r.town, { capacity: stash.capacity, items: [] });
      next = updateCharacter(next, r.who, (x) => ({ ...x, inventory: { ...x.inventory, items } }));
    }
  }
  return next;
}

/** Set the event flags a chapter starts with. */
export function applyChapterFlags(world: WorldState, chapter: number, table: Readonly<Record<number, readonly number[]>> = CHAPTER_START_FLAGS): WorldState {
  let w = world;
  for (const ptr of table[chapter] ?? []) w = setFlag(w, ptr, true);
  return w;
}

/**
 * Let `steps` half hours of expiring events elapse without moving the clock, so timed events (and the
 * flags they set or reset) that would have finished fire at once.
 */
export function runExpirySteps(world: WorldState, steps: number): WorldState {
  let w = world;
  for (let n = 0; n < steps; n++) w = elapseExpiringEvents(w, TIMES.halfHour).state;
  return w;
}

export function applyChapterRules(
  i: { world: WorldState; party: PartyState; chapter: number; towns?: TownStashSource; rules?: ChapterRules },
): { world: WorldState; party: PartyState } {
  const party = applyTownStashes(i.party, i.chapter, i.towns, i.rules?.stashes);
  let world = applyChapterFlags(i.world, i.chapter, i.rules?.flags);
  world = runExpirySteps(world, (i.rules?.expirySteps ?? CHAPTER_EXPIRY_STEPS)[i.chapter] ?? 0);
  return { world, party };
}
