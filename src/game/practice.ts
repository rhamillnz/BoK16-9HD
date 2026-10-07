import { SKILL_NAMES, type Character, type Skill, type SkillName } from '../formats/gam';
import { updateCharacter, type PartyState } from './party';

/**
 * Skill improvement by practice. Pure functions: every call returns new state. The rules follow the
 * original as documented in docs/formats/practice.md.
 */

/** How the experience gained is worked out (BaKGL's SkillChange). */
export type PracticeKind = 'exercised' | 'direct' | 'fraction' | 'difference';

const VAR1 = [3, 3, 1, 1, 2, 3, 1, 3, 8, 5, 5, 0x20, 2, 3, 8, 1];
const VAR2 = [0x33, 0x33, 8, 8, 8, 0x33, 8, 0x33, 0, 0, 0, 0x80, 0x20, 0x33, 0, 0x40];
const SKILL_MIN = [0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const SKILL_MAX = [250, 250, 250, 250, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100];
/** The bonus pool shared out between the skills a character has ticked for improvement. */
export const SELECTED_SKILL_POOL_TOTAL = 26;

/** Share of the pool each selected skill gets: 26 split evenly, 0 when nothing is selected. */
export function selectedSkillPool(c: Pick<Character, 'skills'>): number {
  const n = SKILL_NAMES.filter((s) => c.skills[s].selected).length;
  return n > 0 ? Math.trunc(SELECTED_SKILL_POOL_TOTAL / n) : 0;
}

/** Experience points (256 per skill level) for one practice. */
export function experienceGain(name: SkillName, skill: Skill, kind: PracticeKind, multiplier: number, pool: number): number {
  const i = SKILL_NAMES.indexOf(name);
  let xp: number;
  switch (kind) {
    case 'exercised': {
      xp = Math.trunc(((VAR1[i]! - VAR2[i]!) * skill.trueSkill) / 100) + VAR2[i]!;
      if (multiplier !== 0) xp *= multiplier;
      break;
    }
    case 'difference': xp = (100 - skill.trueSkill) * multiplier; break;
    case 'fraction': xp = Math.trunc((skill.trueSkill * multiplier) / 100); break;
    default: xp = multiplier;
  }
  if (skill.selected) xp += Math.trunc((xp * pool) / (SELECTED_SKILL_POOL_TOTAL * 2));
  return xp;
}

/** Practise one skill of a character. Skills the character does not have (max 0) never improve. */
export function practiceSkill(c: Character, name: SkillName, kind: PracticeKind = 'exercised', multiplier = 1): Character {
  const skill = c.skills[name];
  if (skill.max === 0) return c;
  const i = SKILL_NAMES.indexOf(name);
  const total = experienceGain(name, skill, kind, multiplier, selectedSkillPool(c)) + skill.experience;
  const levels = Math.trunc(total / 256);
  let experience = total % 256;
  if (experience < 0) experience = 0;
  const trueSkill = Math.min(SKILL_MAX[i]!, Math.max(SKILL_MIN[i]!, skill.trueSkill + levels));
  const next: Skill = {
    ...skill,
    experience,
    trueSkill,
    max: Math.max(skill.max, trueSkill),
    unseenImprovement: skill.unseenImprovement || trueSkill !== skill.trueSkill,
  };
  return { ...c, skills: { ...c.skills, [name]: next } };
}

/** Practise a skill of one party member by character index. */
export function practiceCharacter(p: PartyState, index: number, name: SkillName, kind: PracticeKind = 'exercised', multiplier = 1): PartyState {
  return updateCharacter(p, index, (c) => practiceSkill(c, name, kind, multiplier));
}
