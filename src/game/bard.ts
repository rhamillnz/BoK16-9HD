import { SONG_BARD_BEST, SONG_BARD_FAILED, SONG_BARD_GOOD, SONG_BARD_POOR } from '../audio/songs';
import type { ShopStats } from '../formats/gdsContainers';
import { activeCharacters, gainRoyals, ROYALS_PER_SOVEREIGN, type PartyState } from './party';
import { practiceCharacter } from './practice';
import { effectiveSkill, type Character } from '../formats/gam';

/**
 * Playing the lute at an inn (a town scene's Lute hotspot). The party's best bard plays; the inn's barding skill
 * grades the performance, which pays part of the inn's purse (more in later chapters) and practises everyone's
 * Barding. A failed performance gets the party thrown out. Rules from BaKGL (bak/bard.cpp, a format reference).
 */
export type BardStatus = 'failed' | 'poor' | 'good' | 'best';

/** Grade a performance: below 3/4 of the inn's skill fails, below it is poor, below halfway to 100 is good. */
export function classifyBard(skill: number, innSkill: number): BardStatus {
  if (skill < innSkill) return skill < Math.trunc((innSkill * 3) / 4) ? 'failed' : 'poor';
  return skill < Math.trunc((innSkill + 100) / 2) ? 'good' : 'best';
}

/** Royals earned: the inn's purse (sovereigns) plus 5% per chapter after the first, then a share by grade. */
export function bardReward(status: BardStatus, purseSovereigns: number, chapter: number): number {
  const purse = purseSovereigns * ROYALS_PER_SOVEREIGN;
  const reward = purse + Math.round((chapter - 1) * 0.05 * purse);
  switch (status) {
    case 'failed':
      return 0;
    case 'poor':
      return Math.trunc(reward / 4);
    case 'good':
      return Math.trunc(reward / 2);
    case 'best':
      return reward;
  }
}

/** Dialogue keys: the inn has already paid for a song, and the four grades. */
export const BARD_ALREADY_DONE = 0x47;
export const BARD_DIALOG: Readonly<Record<BardStatus, number>> = { failed: 0x49, poor: 0x58, good: 0x59, best: 0x5a };
export const BARD_SONG: Readonly<Record<BardStatus, number>> = {
  failed: SONG_BARD_FAILED,
  poor: SONG_BARD_POOR,
  good: SONG_BARD_GOOD,
  best: SONG_BARD_BEST,
};

/** The active character with the best Barding (first on ties). */
export function bestBard(p: PartyState): { character: Character; skill: number } | undefined {
  let best: { character: Character; skill: number } | undefined;
  for (const c of activeCharacters(p)) {
    const skill = effectiveSkill(c, 'barding');
    if (!best || skill > best.skill) best = { character: c, skill };
  }
  return best;
}

export interface BardResult {
  /** Undefined when the inn has already paid (or nobody can play). */
  status?: BardStatus;
  bard?: Character;
  reward: number;
  party: PartyState;
  stats: ShopStats;
  dialog: number;
}

/** One performance at an inn with `stats` (its `bardingReward` is 0 once it has paid this visit's purse). */
export function performBard(party: PartyState, stats: ShopStats, chapter: number): BardResult {
  const bard = bestBard(party);
  if (!bard || stats.bardingReward === 0) return { reward: 0, party, stats, dialog: BARD_ALREADY_DONE };
  const status = classifyBard(bard.skill, stats.bardingSkill);
  const reward = bardReward(status, stats.bardingMaxReward, chapter);
  let next = gainRoyals(party, reward);
  const multiplier = status === 'failed' || status === 'poor' ? 1 : 2;
  for (const c of activeCharacters(next)) next = practiceCharacter(next, c.index, 'barding', 'exercised', multiplier);
  return {
    status,
    bard: bard.character,
    reward,
    party: next,
    stats: reward > 0 ? { ...stats, bardingReward: 0 } : stats,
    dialog: BARD_DIALOG[status],
  };
}
