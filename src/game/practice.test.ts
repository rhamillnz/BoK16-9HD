import { describe, expect, it } from 'vitest';
import { SKILL_NAMES, type Character, type Skill } from '../formats/gam';
import { experienceGain, practiceCharacter, practiceSkill, selectedSkillPool } from './practice';

const skill = (max: number, trueSkill: number, o: Partial<Skill> = {}): Skill => ({
  max,
  trueSkill,
  current: 0,
  experience: 0,
  modifier: 0,
  selected: false,
  unseenImprovement: false,
  ...o,
});

function character(over: Partial<Record<string, Skill>> = {}): Character {
  const skills = Object.fromEntries(SKILL_NAMES.map((n) => [n, over[n] ?? skill(0, 0)]));
  return { index: 1, name: 'T', skills } as unknown as Character;
}

describe('practice', () => {
  it('exercised experience scales with skill (haggling 2/0x20)', () => {
    expect(experienceGain('haggling', skill(50, 0), 'exercised', 1, 0)).toBe(0x20);
    expect(experienceGain('haggling', skill(50, 50), 'exercised', 1, 0)).toBe(Math.trunc((-30 * 50) / 100) + 0x20);
  });
  it('carries experience into levels and flags the improvement', () => {
    const c = practiceSkill(character({ melee: skill(40, 40, { experience: 250 }) }), 'melee', 'direct', 10);
    expect(c.skills.melee).toMatchObject({ trueSkill: 41, experience: 4, max: 41, unseenImprovement: true });
  });
  it('selected skills get a pool bonus, split between selected skills', () => {
    const c = character({ melee: skill(40, 40, { selected: true }), stealth: skill(40, 40, { selected: true }) });
    expect(selectedSkillPool(c)).toBe(13);
    expect(experienceGain('melee', c.skills.melee, 'direct', 100, 13)).toBe(125);
  });
  it('skills the character lacks never improve, and caps hold', () => {
    const c = character({ lockpick: skill(0, 0), melee: skill(100, 100) });
    expect(practiceSkill(c, 'lockpick', 'direct', 1000)).toBe(c);
    expect(practiceSkill(c, 'melee', 'direct', 1000).skills.melee.trueSkill).toBe(100);
  });
  it('updates a party member by index', () => {
    const p = {
      gold: 0,
      characters: [character({ haggling: skill(50, 50) })],
      activeCharacters: [1],
      partyKeys: { items: [], capacity: 0 },
    } as never;
    const next = practiceCharacter(p, 1, 'haggling', 'direct', 256) as { characters: Character[] };
    expect(next.characters[0]!.skills.haggling.trueSkill).toBe(51);
  });
});
