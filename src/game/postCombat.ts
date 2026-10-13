import { getFlag, setFlag, type WorldState } from './state';

/**
 * Flags set after particular fights are won, and fights that never stay won (rules from BaKGL's
 * SetPostCombatCombatSpecificFlags, a format reference).
 */

/** Story fights that come back every time: winning them does not mark the encounter done. */
export const NEVER_ENDING_COMBATS: ReadonlySet<number> = new Set([
  235, 245, 291, 293, 335, 337, 338, 375, 410, 429, 430,
]);

/** The fight with Nago, after which dialogue snippet `AFTER_NAGO_KEY`'s flag actions run. */
export const NAGO_COMBAT = 74;
export const AFTER_NAGO_KEY = 0x1cfdf1;

/** A set of fights that, once all are won (each sets one flag), sets a quest flag. */
const QUEST_FIGHTS: readonly { combats: readonly number[]; flags: readonly number[]; then: number }[] = [
  // The rusalki of the Eortis quest.
  { combats: [131, 132, 133, 134, 135], flags: [0x14e7, 0x14e8, 0x14e9, 0x14ea, 0x14eb], then: 0xdb1c },
  { combats: [610, 613, 615, 618, 619, 621], flags: [0x16c6, 0x16c9, 0x16cb, 0x16ce, 0x16cf, 0x16d1], then: 0x1d17 },
];

/** The world after fight `combatIndex` was won and its encounter marked done. */
export function postCombatFlags(world: WorldState, combatIndex: number): WorldState {
  for (const q of QUEST_FIGHTS) {
    if (q.combats.includes(combatIndex) && q.flags.every((f) => getFlag(world, f))) return setFlag(world, q.then, true);
  }
  return world;
}
