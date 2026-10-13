import { effectiveSkill, type SkillName } from '../formats/gam';
import type { CombatDef } from '../combat/combatData';
import { activeCharacters, type PartyState } from './party';
import { practiceCharacter } from './practice';

/**
 * What happens as the party walks into a combat encounter, before any fight (rules from BaKGL's
 * combatEncounterHandler, a format reference): an ambush can be scouted (once), which shows its scouting text
 * and calls the fight off; otherwise the party may slip past unseen on its worst Stealth; otherwise the fight's
 * entry dialogue plays with a context value saying how the approach went, then the fight starts.
 */

/** Combats that cannot be scouted or sneaked past (story fights). */
export const UNAVOIDABLE_COMBATS: ReadonlySet<number> = new Set([
  151, 152, 235, 245, 291, 293, 335, 337, 338, 375, 410, 429, 430,
]);

/** A scouted fight met within this many ticks counts as approached on purpose (30 x 30 ticks). */
export const SCOUTED_WINDOW = 0x1e * 0x1e;

/** Entry dialogue context (0x7530): crept up on them, failed to creep up, or met them without scouting. */
export const APPROACH_CONTEXT = { snuck: 0, spotted: 1, unscouted: 2 } as const;

export type Approach =
  | { kind: 'scouted'; party: PartyState; dialog: number }
  | { kind: 'avoided'; party: PartyState }
  | { kind: 'fight'; party: PartyState; context: number };

export interface ApproachInput {
  party: PartyState;
  def: Pick<CombatDef, 'combatIndex' | 'ambush' | 'scoutDialog'>;
  /** This ambush has been tried for scouting already (BaKGL's "recently encountered"). */
  scoutTried: boolean;
  /** Ticks when this combat was scouted, if it was. */
  scoutedAt?: number;
  now: number;
  /** Uniform 0..99. */
  roll: () => number;
  /** Dragon's Breath is active (harder to be noticed by an ambush). */
  dragonsBreath?: boolean;
}

function partySkill(p: PartyState, name: SkillName, best: boolean): number {
  const skills = activeCharacters(p).map((c) => effectiveSkill(c, name));
  if (skills.length === 0) return 0;
  return best ? Math.max(...skills) : Math.min(...skills);
}

function practiseAll(p: PartyState, name: SkillName): PartyState {
  let next = p;
  for (const c of activeCharacters(p)) next = practiceCharacter(next, c.index, name);
  return next;
}

/** The party's chance (percent) to slip past: its worst Stealth plus 30% of it, at most 90. */
export function avoidanceStealth(p: PartyState, ambush: boolean, dragonsBreath = false): number {
  let s = partySkill(p, 'stealth', false);
  if (s < 90) s += Math.trunc((s * 30) / 100);
  if (s > 90) s = 90;
  if (ambush && dragonsBreath) s += (100 - s) >> 1;
  return s;
}

export function approachCombat(i: ApproachInput): Approach {
  let party = i.party;
  const unavoidable = UNAVOIDABLE_COMBATS.has(i.def.combatIndex);
  if (!unavoidable && i.def.ambush && !i.scoutTried && i.def.scoutDialog !== 0) {
    if (partySkill(party, 'scouting', true) >= i.roll())
      return { kind: 'scouted', party: practiseAll(party, 'scouting'), dialog: i.def.scoutDialog };
  }
  if (!unavoidable && avoidanceStealth(party, i.def.ambush, i.dragonsBreath) >= i.roll())
    return { kind: 'avoided', party: practiseAll(party, 'stealth') };

  let context: number = APPROACH_CONTEXT.unscouted;
  if (i.scoutedAt !== undefined && i.now - i.scoutedAt < SCOUTED_WINDOW) {
    if (i.roll() > partySkill(party, 'stealth', false)) context = APPROACH_CONTEXT.spotted;
    else {
      context = APPROACH_CONTEXT.snuck;
      party = practiseAll(party, 'stealth');
    }
  }
  return { kind: 'fight', party, context };
}
