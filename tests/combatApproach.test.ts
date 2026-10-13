import { describe, expect, it } from 'vitest';
import { CONDITION_NAMES, SKILL_NAMES, type Character, type SkillName } from '../src/formats/gam';
import {
  APPROACH_CONTEXT,
  SCOUTED_WINDOW,
  approachCombat,
  avoidanceStealth,
  type ApproachInput,
} from '../src/game/combatApproach';
import type { PartyState } from '../src/game/party';

const character = (index: number, over: Partial<Record<SkillName, number>>): Character => ({
  index,
  name: `c${index}`,
  unknownHeader: new Uint8Array(2),
  spellBytes: new Uint8Array(6),
  spells: [],
  skills: Object.fromEntries(
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
  ) as Character['skills'],
  combatCharIndex: 0,
  unknownTrailer: new Uint8Array(6),
  conditions: Object.fromEntries(CONDITION_NAMES.map((c) => [c, 0])) as Character['conditions'],
  affectors: [],
  inventory: { capacity: 24, items: [] },
});
const party = (...chars: Character[]): PartyState => ({
  gold: 0,
  characters: chars,
  activeCharacters: chars.map((c) => c.index),
  partyKeys: { capacity: 4, items: [] },
});
const scouts = party(character(0, { scouting: 60, stealth: 40 }), character(1, { scouting: 10, stealth: 10 }));
const input = (over: Partial<ApproachInput> = {}): ApproachInput => ({
  party: scouts,
  def: { combatIndex: 5, ambush: true, scoutDialog: 0x1234 },
  scoutTried: false,
  now: 1000,
  roll: () => 99,
  ...over,
});

describe('approaching a combat', () => {
  it('scouts an ambush on the best Scouting, once', () => {
    const a = approachCombat(input({ roll: () => 60 }));
    expect(a).toMatchObject({ kind: 'scouted', dialog: 0x1234 });
    expect(a.party.characters[0]!.skills.scouting.experience).toBeGreaterThan(0);
    expect(approachCombat(input({ roll: () => 61 })).kind).toBe('fight');
    expect(approachCombat(input({ roll: () => 0, scoutTried: true })).kind).not.toBe('scouted');
  });

  it('slips past on the worst Stealth plus 30%, never for story fights', () => {
    expect(avoidanceStealth(scouts, false)).toBe(13);
    expect(avoidanceStealth(party(character(0, { stealth: 80 })), false)).toBe(90);
    const notAmbush = { combatIndex: 5, ambush: false, scoutDialog: 0 };
    expect(approachCombat(input({ def: notAmbush, roll: () => 13 })).kind).toBe('avoided');
    expect(approachCombat(input({ def: notAmbush, roll: () => 14 })).kind).toBe('fight');
    expect(approachCombat(input({ def: { ...notAmbush, combatIndex: 151 }, roll: () => 0 })).kind).toBe('fight');
  });

  it('tells the entry dialogue how a scouted approach went', () => {
    const def = { combatIndex: 5, ambush: false, scoutDialog: 0 };
    const rolls =
      (...r: number[]) =>
      () =>
        r.shift() ?? 99;
    expect(approachCombat(input({ def, roll: rolls(99) }))).toMatchObject({ context: APPROACH_CONTEXT.unscouted });
    expect(approachCombat(input({ def, scoutedAt: 900, roll: rolls(99, 5) }))).toMatchObject({
      context: APPROACH_CONTEXT.snuck,
    });
    expect(approachCombat(input({ def, scoutedAt: 900, roll: rolls(99, 50) }))).toMatchObject({
      context: APPROACH_CONTEXT.spotted,
    });
    expect(approachCombat(input({ def, scoutedAt: 1000 - SCOUTED_WINDOW, roll: rolls(99) }))).toMatchObject({
      context: APPROACH_CONTEXT.unscouted,
    });
  });
});
