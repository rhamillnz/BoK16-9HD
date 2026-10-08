import { describe, expect, it } from 'vitest';
import { SKILL_NAMES, type Character, type Skill } from '../formats/gam';
import { runCamp, type CampHost } from './campControls';
import type { PartyState } from './party';
import type { WorldState } from './state';

const skill = (max: number, trueSkill: number): Skill => ({
  max,
  trueSkill,
  current: 0,
  experience: 0,
  modifier: 0,
  selected: false,
  unseenImprovement: false,
});
function character(): Character {
  const skills = Object.fromEntries(SKILL_NAMES.map((n) => [n, skill(0, 0)])) as Character['skills'];
  skills.health = skill(50, 10);
  skills.stamina = skill(40, 5);
  return {
    index: 0,
    name: 'Owyn',
    unknownHeader: new Uint8Array(2),
    spellBytes: new Uint8Array(6),
    spells: [],
    skills,
    combatCharIndex: 0,
    unknownTrailer: new Uint8Array(6),
    conditions: { sick: 0, plagued: 0, poisoned: 0, drunk: 0, healing: 0, starving: 0, nearDeath: 0 },
    affectors: [],
    inventory: { capacity: 4, items: [] },
  };
}

function host(pick: number) {
  let party: PartyState = {
    gold: 0,
    characters: [character()],
    activeCharacters: [0],
    partyKeys: { capacity: 4, items: [] },
  };
  let world: WorldState = {
    chapter: 1,
    ticks: 0,
    ticksLastSlept: 0,
    bytes: new Uint8Array(0x4000),
    expiringEvents: [],
  };
  const shown: string[] = [];
  let timeEvents = 0;
  const h: CampHost = {
    items: [],
    getParty: () => party,
    setParty: (p) => (party = p),
    getWorld: () => world,
    setWorld: (w) => (world = w),
    canCamp: () => true,
    onTimePassed: () => timeEvents++,
    menu: async (text, choices) => {
      shown.push(text);
      return choices.length ? pick : -1;
    },
  };
  return { h, shown, state: () => ({ party, world, timeEvents }) };
}

describe('runCamp', () => {
  it('rests, applies the result and shows a report', async () => {
    const t = host(0);
    const r = await runCamp(t.h);
    expect(r?.hoursRested).toBe(1);
    expect(t.state().world.ticks).toBe(0x708);
    expect(t.state().party.characters[0]!.skills.health.trueSkill).toBe(16);
    expect(t.state().timeEvents).toBe(1);
    expect(t.shown[1]).toContain('rested 1 hour');
  });

  it('does nothing when the camp is broken', async () => {
    const t = host(4);
    expect(await runCamp(t.h)).toBeUndefined();
    expect(t.state().world.ticks).toBe(0);
  });
});
