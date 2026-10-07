import type { ItemRule } from './party';

/**
 * Lock rules for chests and doors (see docs/formats/containers.md). A lock has a rating. Ratings up
 * to 100 can be picked by a skilled enough character; certain exact ratings belong to a particular
 * key, which opens that lock and no other. Random choices take an injected roll in [0, 100) so the
 * rules are deterministic under test.
 */

/** OBJINFO index of the lockpick ('P'). */
export const ITEM_PICKLOCK = 0x50;
/** Keys are items 60 + n; key n opens the lock whose rating is `LOCK_RATINGS[n]`. */
export const KEY_ITEM_BASE = 60;
export const LOCK_RATINGS: readonly number[] = [0x00, 0x32, 0x5a, 0x65, 0x66, 0x67, 0x68, 0x46, 0x3c, 0x50, 0x69, 0x6a];

export type LockDifficulty = 'easy' | 'medium' | 'hard' | 'unpickable';

export function classifyLock(rating: number): LockDifficulty {
  if (rating < 0x33) return 'easy';
  if (rating < 0x51) return 'medium';
  if (rating < 0x65) return 'hard';
  return 'unpickable';
}

/** Position of `rating` in the key table (1..11), or undefined when no key is made for this rating. */
export function lockKeyNumber(rating: number): number | undefined {
  const i = LOCK_RATINGS.indexOf(rating);
  return i > 0 ? i : undefined;
}

/** The OBJINFO item that opens a lock of this rating, if there is one. */
export function keyItemForLock(rating: number): number | undefined {
  const n = lockKeyNumber(rating);
  return n === undefined ? undefined : KEY_ITEM_BASE + n;
}

export const isKeyItem = (itemIndex: number): boolean => itemIndex > KEY_ITEM_BASE && itemIndex <= KEY_ITEM_BASE + LOCK_RATINGS.length - 1;

/** The rating a key was cut for. */
function keyRating(itemIndex: number): number {
  return LOCK_RATINGS[itemIndex - KEY_ITEM_BASE] ?? 0;
}

export const keyOpensLock = (itemIndex: number, rating: number): boolean => keyItemForLock(rating) === itemIndex;

export const canPickLock = (skill: number, rating: number): boolean => rating <= 100 && skill > rating;

/**
 * What a character can tell about a lock by looking: 0 easy for them, 1 too complicated,
 * 2 takes a special key, 3 broken beyond repair.
 */
export function describeLock(skill: number, rating: number): 0 | 1 | 2 | 3 {
  if (rating > 106) return 3;
  if (rating > 100) return 2;
  return skill > rating ? 0 : 1;
}

/** Percent chance that a failed pick snaps the lockpick. */
export function picklockBreakChance(skill: number, rating: number): number {
  return Math.min(100, Math.max(0, Math.trunc(((rating - skill) * 2) / 3)));
}

/** Percent chance that a wrong ordinary key snaps in the lock; special keys never break. */
export function keyBreakChance(itemIndex: number, skill: number): number {
  const rating = keyRating(itemIndex);
  if (rating > 100) return 0;
  const diff = 100 - rating;
  return Math.min(100, Math.max(0, Math.trunc(((diff - Math.trunc(skill / 3)) * 2) / 3)));
}

/** Percent chance that a failed pick still teaches the character something. */
export const PICKLOCK_LEARN_CHANCE = 40;

export type LockAttempt =
  | { kind: 'opened'; with: 'key' | 'picklock' }
  | { kind: 'failed' }
  | { kind: 'broke'; item: number }
  | { kind: 'nothing' };

export interface LockAttemptResult {
  attempt: LockAttempt;
  /** The lock opened. */
  unlocked: boolean;
  /** The item to take out of the party's inventory (a snapped key or lockpick), if any. */
  consumed?: number;
  /** A failed pick that should still count as practice for the Lockpick skill. */
  learned: boolean;
}

/**
 * Try to open a lock of `rating` with the key or lockpick `itemIndex` held by a character with
 * Lockpick `skill`. `roll` yields integers in [0, 100).
 */
export function attemptLock(itemIndex: number, skill: number, rating: number, roll: () => number): LockAttemptResult {
  if (itemIndex === ITEM_PICKLOCK) {
    if (canPickLock(skill, rating)) return { attempt: { kind: 'opened', with: 'picklock' }, unlocked: true, learned: true };
    const learned = roll() < PICKLOCK_LEARN_CHANCE;
    if (roll() < picklockBreakChance(skill, rating)) return { attempt: { kind: 'broke', item: itemIndex }, unlocked: false, consumed: itemIndex, learned };
    return { attempt: { kind: 'failed' }, unlocked: false, learned };
  }
  if (!isKeyItem(itemIndex)) return { attempt: { kind: 'nothing' }, unlocked: false, learned: false };
  if (keyOpensLock(itemIndex, rating)) return { attempt: { kind: 'opened', with: 'key' }, unlocked: true, learned: false };
  if (roll() < keyBreakChance(itemIndex, skill)) return { attempt: { kind: 'broke', item: itemIndex }, unlocked: false, consumed: itemIndex, learned: false };
  return { attempt: { kind: 'failed' }, unlocked: false, learned: false };
}

/** Item rule for keys (they live on the party key ring). */
export const KEY_RULE: ItemRule = { stackSize: 1, defaultStackSize: 1, isKey: true };
