import { describe, expect, it } from 'vitest';
import { BARD_ALREADY_DONE, BARD_DIALOG, bardReward, bestBard, classifyBard, performBard } from '../src/game/bard';
import { CONDITION_NAMES, SKILL_NAMES, type Character, type SkillName } from '../src/formats/gam';
import type { ShopStats } from '../src/formats/gdsContainers';
import type { PartyState } from '../src/game/party';

const skills = (over: Partial<Record<SkillName, number>> = {}) =>
  Object.fromEntries(
    SKILL_NAMES.map((n) => [
      n,
      {
        max: over[n] ?? 20,
        trueSkill: over[n] ?? 20,
        current: 0,
        experience: 0,
        modifier: 0,
        selected: false,
        unseenImprovement: false,
      },
    ]),
  ) as Character['skills'];
const character = (index: number, barding: number): Character => ({
  index,
  name: `c${index}`,
  unknownHeader: new Uint8Array(2),
  spellBytes: new Uint8Array(6),
  spells: [],
  skills: skills({ barding }),
  combatCharIndex: 0,
  unknownTrailer: new Uint8Array(6),
  conditions: Object.fromEntries(CONDITION_NAMES.map((c) => [c, 0])) as Character['conditions'],
  affectors: [],
  inventory: { capacity: 24, items: [] },
});
const party = (...bards: number[]): PartyState => ({
  gold: 100,
  characters: bards.map((b, i) => character(i, b)),
  activeCharacters: bards.map((_, i) => i),
  partyKeys: { capacity: 4, items: [] },
});
const inn = (over: Partial<ShopStats> = {}): ShopStats =>
  ({ bardingSkill: 40, bardingReward: 5, bardingMaxReward: 4, ...over }) as ShopStats;

describe('barding', () => {
  it('grades a performance against the inn', () => {
    expect(classifyBard(29, 40)).toBe('failed');
    expect(classifyBard(30, 40)).toBe('poor');
    expect(classifyBard(40, 40)).toBe('good');
    expect(classifyBard(69, 40)).toBe('good');
    expect(classifyBard(70, 40)).toBe('best');
  });

  it('pays a share of the purse, 5% more per chapter', () => {
    expect(bardReward('best', 4, 1)).toBe(40);
    expect(bardReward('good', 4, 1)).toBe(20);
    expect(bardReward('poor', 4, 1)).toBe(10);
    expect(bardReward('failed', 4, 1)).toBe(0);
    expect(bardReward('best', 4, 3)).toBe(44);
  });

  it('lets the best bard play, pays the party, practises everyone and empties the purse', () => {
    const p = party(10, 75);
    expect(bestBard(p)?.character.index).toBe(1);
    const r = performBard(p, inn(), 1);
    expect(r.status).toBe('best');
    expect(r.reward).toBe(40);
    expect(r.party.gold).toBe(140);
    expect(r.dialog).toBe(BARD_DIALOG.best);
    expect(r.stats.bardingReward).toBe(0);
    for (const c of r.party.characters) expect(c.skills.barding.experience).toBeGreaterThan(0);
  });

  it('says the inn has paid already, and keeps the purse after a failure', () => {
    const paid = performBard(party(75), inn({ bardingReward: 0 }), 1);
    expect(paid).toMatchObject({ reward: 0, dialog: BARD_ALREADY_DONE });
    expect(paid.status).toBeUndefined();
    const failed = performBard(party(5), inn(), 1);
    expect(failed).toMatchObject({ status: 'failed', reward: 0, dialog: BARD_DIALOG.failed });
    expect(failed.stats.bardingReward).toBe(5);
  });
});
