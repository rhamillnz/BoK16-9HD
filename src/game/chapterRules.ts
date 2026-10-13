import type { InventoryItem } from '../formats/gam';
import type { GdsRef } from '../formats/gds';
import type { PartyState } from './party';
import { elapseExpiringEvents, setFlag, type WorldState } from './state';

/**
 * Chapter-start rules beyond the purse and the chapter 4 and 5 kit swaps (chapterHandover.ts): town containers
 * filled when a chapter starts, event flags set or cleared, and the expiry of timed events. The values are the
 * ones BaKGL's chapter transition uses (a format reference; see docs/formats/chapters.md).
 */

/** A town container's contents (a plain container such as Locklear's room, or a shop or inn's stock). */
export interface TownStash {
  capacity: number;
  items: InventoryItem[];
}

/** Town containers and the world containers the rules copy from. */
export interface TownStashSource {
  get(ref: GdsRef): TownStash | undefined;
  set(ref: GdsRef, stash: TownStash): void;
  /** A world container's items by zone and position (zone 0 holds reference containers that only the rules read). */
  world(at: { zone: number; x: number; y: number }): InventoryItem[] | undefined;
}

export type TownStashRule =
  | {
      chapter: number;
      /** The container is emptied, then takes a copy of the character's pack (the character keeps it). */
      mode: 'copyPack';
      /** Save character slot. */
      who: number;
      town: GdsRef;
    }
  | {
      chapter: number;
      /** The container is emptied, then takes a copy of a world container's items. */
      mode: 'fill';
      town: GdsRef;
      from: { zone: number; x: number; y: number };
    };

/**
 * Chapter 2: Locklear stays in Krondor, and his room (scene 2B) holds what he carried. Chapter 6: the two Lurough
 * inns (60C, 64C) stock what the Lurough quest needs, from zone 0's reference containers.
 */
export const TOWN_STASH_RULES: readonly TownStashRule[] = [
  { chapter: 2, mode: 'copyPack', who: 0, town: { number: 2, letter: 'B' } },
  { chapter: 6, mode: 'fill', town: { number: 60, letter: 'C' }, from: { zone: 0, x: 20, y: 1 } },
  { chapter: 6, mode: 'fill', town: { number: 64, letter: 'C' }, from: { zone: 0, x: 30, y: 1 } },
];

/** Event pointers set (true) or cleared (false) when a chapter starts, by chapter. */
export const CHAPTER_START_FLAGS: Readonly<Record<number, readonly { ptr: number; value: boolean }[]>> = {
  3: [{ ptr: 0x1fbc, value: false }],
  7: [{ ptr: 0x1ab1, value: true }],
};

/** Every chapter start lets timed events run down: this many steps of `EXPIRY_STEP_TICKS`. */
export const CHAPTER_EXPIRY_STEPS = 80;
export const EXPIRY_STEP_TICKS = 0x7530;

export interface ChapterRules {
  stashes?: readonly TownStashRule[];
  flags?: Readonly<Record<number, readonly { ptr: number; value: boolean }[]>>;
  expirySteps?: number;
}

const copy = (items: readonly InventoryItem[], capacity: number) => items.slice(0, capacity).map((i) => ({ ...i }));

/** Fill town containers as the rules for `chapter` say. Rules whose container, character or source is missing are skipped. */
export function applyTownStashes(
  party: PartyState,
  chapter: number,
  source: TownStashSource | undefined,
  rules: readonly TownStashRule[] = TOWN_STASH_RULES,
): void {
  if (!source) return;
  for (const r of rules) {
    if (r.chapter !== chapter) continue;
    const stash = source.get(r.town);
    if (!stash) continue;
    const items =
      r.mode === 'copyPack' ? party.characters.find((x) => x.index === r.who)?.inventory.items : source.world(r.from);
    if (!items) continue;
    source.set(r.town, { capacity: stash.capacity, items: copy(items, stash.capacity) });
  }
}

/** Set and clear the event flags a chapter starts with. */
export function applyChapterFlags(
  world: WorldState,
  chapter: number,
  table: ChapterRules['flags'] = CHAPTER_START_FLAGS,
): WorldState {
  let w = world;
  for (const f of table?.[chapter] ?? []) w = setFlag(w, f.ptr, f.value);
  return w;
}

/** Let `steps` steps of `stepTicks` of timed events run down without moving the clock; finished ones fire. */
export function runExpirySteps(world: WorldState, steps: number, stepTicks = EXPIRY_STEP_TICKS): WorldState {
  let w = world;
  for (let n = 0; n < steps && w.expiringEvents.length > 0; n++) w = elapseExpiringEvents(w, stepTicks).state;
  return w;
}

export function applyChapterRules(i: {
  world: WorldState;
  party: PartyState;
  chapter: number;
  towns?: TownStashSource;
  rules?: ChapterRules;
}): { world: WorldState; party: PartyState } {
  applyTownStashes(i.party, i.chapter, i.towns, i.rules?.stashes);
  let world = applyChapterFlags(i.world, i.chapter, i.rules?.flags);
  world = runExpirySteps(world, i.rules?.expirySteps ?? CHAPTER_EXPIRY_STEPS);
  return { world, party: i.party };
}
