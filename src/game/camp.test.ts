import { describe, expect, it } from 'vitest';
import { SKILL_NAMES, type Character, type Skill } from '../formats/gam';
import type { ItemDef } from '../formats/objinfo';
import {
  AMBUSH_CHANCE_PER_HOUR,
  MORNING_HOUR,
  camp,
  campSummary,
  countRations,
  plannedHours,
  ITEM_TYPE_RATION,
} from './camp';
import type { PartyState } from './party';
import { TICKS_PER_DAY, TICKS_PER_HOUR, hourOfDay, type WorldState } from './state';

const skill = (max: number, trueSkill: number): Skill => ({
  max,
  trueSkill,
  current: 0,
  experience: 0,
  modifier: 0,
  selected: false,
  unseenImprovement: false,
});

function character(index: number, health = 10, rations = 0): Character {
  const skills = Object.fromEntries(SKILL_NAMES.map((n) => [n, skill(0, 0)])) as Character['skills'];
  skills.health = skill(50, health);
  skills.stamina = skill(40, 5);
  const items =
    rations > 0
      ? [
          {
            itemIndex: 1,
            conditionOrQuantity: rations,
            status: 0,
            modifiers: 0,
            activated: false,
            used: false,
            broken: false,
            repairable: false,
            equipped: false,
            poisoned: false,
          },
        ]
      : [];
  return {
    index,
    name: `C${index}`,
    unknownHeader: new Uint8Array(2),
    spellBytes: new Uint8Array(6),
    spells: [],
    skills,
    combatCharIndex: 0,
    unknownTrailer: new Uint8Array(6),
    conditions: { sick: 0, plagued: 0, poisoned: 0, drunk: 0, healing: 0, starving: 0, nearDeath: 30 },
    affectors: [],
    inventory: { capacity: 8, items },
  };
}

const party = (rations = 0): PartyState => ({
  gold: 0,
  characters: [character(0, 10, rations), character(1, 10, rations)],
  activeCharacters: [0, 1],
  partyKeys: { capacity: 4, items: [] },
});
const world = (ticks = 20 * TICKS_PER_HOUR): WorldState => ({
  chapter: 1,
  ticks,
  ticksLastSlept: 0,
  bytes: new Uint8Array(0x4000),
  expiringEvents: [],
});
const ITEMS = [] as ItemDef[];
ITEMS[1] = { index: 1, stackSize: 10, defaultStackSize: 1, type: ITEM_TYPE_RATION } as ItemDef;
const opts = { items: ITEMS, ambushChance: 0 };

describe('camp', () => {
  it('rests one hour per step, heals and stamps the sleep time', () => {
    const r = camp(world(), party(), { kind: 'hours', hours: 3 }, opts);
    expect(r.hoursRested).toBe(3);
    expect(r.world.ticks).toBe(world().ticks + 3 * TICKS_PER_HOUR);
    expect(r.world.ticksLastSlept).toBe(r.world.ticks);
    // One pool point per hour, shared with inns: health fills first and stamina holds the rest.
    expect(r.party.characters[0]!.skills.health.trueSkill).toBe(18);
  });

  it('never heals past the 80% camp ceiling', () => {
    const p = party();
    p.characters[0]!.skills.health.trueSkill = 50;
    p.characters[0]!.skills.stamina.trueSkill = 20;
    p.characters[0]!.conditions.nearDeath = 0;
    const r = camp(world(6 * TICKS_PER_HOUR), p, { kind: 'hours', hours: 5 }, opts);
    const c = r.party.characters[0]!;
    // 80 percent of the 90 point pool is 72; a pool already at 70 only climbs to there.
    expect(c.skills.health.trueSkill + c.skills.stamina.trueSkill).toBe(72);
  });

  it('doubles healing under the Healing condition', () => {
    const p = party();
    p.characters[0]!.conditions.healing = 50;
    const pool = (r: ReturnType<typeof camp>) =>
      r.party.characters[0]!.skills.health.trueSkill + r.party.characters[0]!.skills.stamina.trueSkill;
    const healing = pool(camp(world(), p, { kind: 'hours', hours: 1 }, opts));
    const plain = pool(camp(world(), party(), { kind: 'hours', hours: 1 }, opts));
    expect(healing - plain).toBeGreaterThanOrEqual(1);
  });

  it('rests until morning', () => {
    const w = world(22 * TICKS_PER_HOUR);
    expect(plannedHours({ kind: 'morning' }, w, party())).toBe(8);
    const r = camp(w, party(), { kind: 'morning' }, opts);
    expect(hourOfDay(r.world.ticks)).toBe(MORNING_HOUR);
  });

  it('rests until healed and stops early', () => {
    const pool = (c: Character) => c.skills.health.trueSkill + c.skills.stamina.trueSkill;
    const r = camp(world(6 * TICKS_PER_HOUR), party(), { kind: 'healed' }, opts);
    expect(r.hoursRested).toBeGreaterThan(1);
    expect(pool(r.party.characters[1]!)).toBeLessThanOrEqual(72);
    const near = party();
    near.characters.forEach((c) => (c.skills.health.trueSkill = 67));
    const n = camp(world(6 * TICKS_PER_HOUR), near, { kind: 'healed' }, opts);
    expect(n.hoursRested).toBeLessThan(24);
    expect(n.party.characters.every((c) => !(pool(c) < 72))).toBe(true);
  });

  it('eats a ration per character at the day boundary and starves those without', () => {
    const w = world(TICKS_PER_DAY - TICKS_PER_HOUR);
    const fed = camp(w, party(2), { kind: 'hours', hours: 2 }, opts);
    expect(countRations(fed.party, ITEMS)).toBe(2);
    expect(fed.party.characters[0]!.conditions.starving).toBe(0);
    const hungry = camp(w, party(0), { kind: 'hours', hours: 2 }, opts);
    expect(hungry.party.characters[0]!.conditions.starving).toBe(5);
    expect(hungry.messages.some((m) => m.includes('no ration'))).toBe(true);
  });

  it('shares rations: a character without any eats from a companion', () => {
    const p = party(0);
    p.characters[0]!.inventory.items = party(2).characters[0]!.inventory.items;
    const r = camp(world(TICKS_PER_DAY - TICKS_PER_HOUR), p, { kind: 'hours', hours: 2 }, opts);
    expect(r.party.characters[1]!.conditions.starving).toBe(0);
    expect(countRations(r.party, ITEMS)).toBe(0);
  });

  it('recovers near death each day and cures sick after a long rest', () => {
    const r = camp(world(TICKS_PER_DAY - TICKS_PER_HOUR), party(2), { kind: 'hours', hours: 14 }, opts);
    // The shared rule: a tenth of the distance from 100, less one (30 -> 22).
    expect(r.party.characters[0]!.conditions.nearDeath).toBe(22);
    const sick = party(2);
    sick.characters[0]!.conditions.sick = 60;
    expect(
      camp(world(TICKS_PER_DAY - TICKS_PER_HOUR), sick, { kind: 'hours', hours: 14 }, opts).party.characters[0]!
        .conditions.sick,
    ).toBe(0);
    expect(camp(world(), sick, { kind: 'hours', hours: 4 }, opts).party.characters[0]!.conditions.sick).toBeGreaterThan(
      0,
    );
  });

  it('can be interrupted by an ambush', () => {
    const r = camp(
      world(),
      party(),
      { kind: 'hours', hours: 8 },
      { items: ITEMS, ambushChance: AMBUSH_CHANCE_PER_HOUR, random: () => 0 },
    );
    expect(r.interrupted).toBe(true);
    expect(r.hoursRested).toBe(1);
    expect(campSummary(r, party(), r.party)[0]).toContain('disturbed');
  });

  it('leaves its inputs untouched', () => {
    const p = party(1);
    const w = world();
    camp(w, p, { kind: 'hours', hours: 2 }, opts);
    expect(p.characters[0]!.skills.health.trueSkill).toBe(10);
    expect(w.ticks).toBe(20 * TICKS_PER_HOUR);
  });
});
