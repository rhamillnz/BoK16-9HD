import { describe, expect, it } from 'vitest';
import { ActionType, parseDDX } from '../formats/ddx';
import { GAM_OFFSETS, SKILL_NAMES, type Character, type Skill } from '../formats/gam';
import { applyDialogEffects } from './dialogEffects';
import { makeDialogEnv, partyHasItem } from './dialogEnv';
import { DialogSession, DialogStore, evaluateChoice } from './encounterRunner';
import type { PartyState } from './party';
import type { WorldState } from './state';

// ---- synthetic fixtures ----------------------------------------------------

interface Spec {
  key?: number;
  text?: string;
  choices?: { state: number; min?: number; max?: number; target: number }[];
  actions?: { type: number; words: number[] }[];
}

/** One DDX; a choice target is the 1-based index of a snippet in `specs` (0 = end). */
function ddx(specs: Spec[]): DialogStore {
  const keyed = specs.flatMap((s, i) => (s.key === undefined ? [] : [[s.key, i] as const]));
  const sizes = specs.map(
    (s) => 9 + (s.choices?.length ?? 0) * 10 + (s.actions?.length ?? 0) * 10 + (s.text?.length ?? 0),
  );
  const offsets: number[] = [];
  let at = 2 + 8 * keyed.length;
  for (const size of sizes) {
    offsets.push(at);
    at += size;
  }
  const out = new Uint8Array(at);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, keyed.length, true);
  keyed.forEach(([key, i], n) => {
    dv.setUint32(2 + n * 8, key, true);
    dv.setUint32(6 + n * 8, offsets[i]!, true);
  });
  specs.forEach((s, i) => {
    const choices = s.choices ?? [];
    const actions = s.actions ?? [];
    const text = s.text ?? '';
    let p = offsets[i]!;
    dv.setUint16(p + 1, 0xff, true);
    dv.setUint8(p + 5, choices.length);
    dv.setUint8(p + 6, actions.length);
    dv.setUint16(p + 7, text.length, true);
    p += 9;
    for (const c of choices) {
      dv.setUint16(p, c.state, true);
      dv.setUint16(p + 2, c.min ?? 0, true);
      dv.setUint16(p + 4, c.max ?? 0xffff, true);
      dv.setUint32(p + 6, c.target === 0 ? 0 : offsets[c.target - 1]!, true);
      p += 10;
    }
    for (const a of actions) {
      dv.setUint16(p, a.type, true);
      a.words.forEach((v, k) => dv.setUint16(p + 2 + k * 2, v, true));
      p += 10;
    }
    for (let k = 0; k < text.length; k++) out[p + k] = text.charCodeAt(k);
  });
  return new DialogStore(new Map([[0, parseDDX(out)]]));
}

const skill = (max: number, trueSkill: number): Skill => ({
  max,
  trueSkill,
  current: 0,
  experience: 0,
  modifier: 0,
  selected: false,
  unseenImprovement: false,
});

function character(index: number, haggling: number): Character {
  const skills = Object.fromEntries(SKILL_NAMES.map((n) => [n, skill(100, 0)])) as Character['skills'];
  skills.health = skill(60, 60);
  skills.haggling = skill(100, haggling);
  return {
    index,
    name: `C${index}`,
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

const party = (gold = 100): PartyState => ({
  gold,
  characters: [character(0, 20), character(1, 70)],
  activeCharacters: [0, 1],
  partyKeys: { capacity: 8, items: [] },
});

const world = (): WorldState => ({
  chapter: 1,
  ticks: 0,
  ticksLastSlept: 0,
  bytes: new Uint8Array(GAM_OFFSETS.complexEventFlags + 0x800),
  expiringEvents: [],
});

const SKILL_CHECK = 0x753d;
const HAGGLING = SKILL_NAMES.indexOf('haggling');

describe('choice conditions from the party', () => {
  const env = makeDialogEnv({ getParty: () => party(30), zone: 7, chapter: 1, extras: () => ({ itemValue: 50 }) });

  it('reads money, affordability, item value and zone', () => {
    const s = ddx([
      {
        key: 1,
        choices: [
          { state: 0x7531, min: 30, max: 30, target: 0 },
          { state: 0x7533, min: 1, target: 0 },
          { state: 0x753e, min: 50, max: 50, target: 0 },
          { state: 0x7543, min: 7, max: 7, target: 0 },
        ],
      },
    ]);
    const c = s.byKey(1)!.snippet.choices;
    expect(c.map((x) => evaluateChoice(x, world(), env))).toEqual([true, true, true, true]);
  });

  it('can afford when the purse covers the item value', () => {
    const rich = makeDialogEnv({ getParty: () => party(80), zone: 1, chapter: 1, extras: () => ({ itemValue: 50 }) });
    const s = ddx([{ key: 1, choices: [{ state: 0x7533, min: 1, target: 0 }] }]);
    expect(evaluateChoice(s.byKey(1)!.snippet.choices[0]!, world(), rich)).toBe(false);
  });

  it('finds items carried by active characters and money items in the purse', () => {
    const p = party(25);
    p.characters[1]!.inventory.items.push({
      itemIndex: 9,
      conditionOrQuantity: 100,
      status: 0,
      modifiers: 0,
      activated: false,
      used: false,
      broken: false,
      repairable: false,
      equipped: false,
      poisoned: false,
    });
    expect(partyHasItem(p, 9)).toBe(true);
    expect(partyHasItem(p, 10)).toBe(false);
    expect(partyHasItem(p, 53)).toBe(true);
    expect(partyHasItem(party(5), 53)).toBe(false);
  });

  it('tests notes, spells and scripted state through the env hooks', () => {
    const e = makeDialogEnv({
      getParty: () => party(),
      zone: 1,
      chapter: 1,
      haveNote: (n) => n === 3,
      castSpell: (n) => n === 2,
      customState: (id) => (id === 5 ? 1 : 0),
    });
    const note = {
      state: (3 - 0x38c8) & 0xffff,
      category: 'haveNote' as const,
      min: 1,
      max: 0xffff,
      target: { kind: 'none' as const },
    };
    const spell = {
      state: 0xcb21 + 2,
      category: 'castSpell' as const,
      min: 1,
      max: 0xffff,
      target: { kind: 'none' as const },
    };
    expect(evaluateChoice(note, world(), e)).toBe(true);
    expect(evaluateChoice(spell, world(), e)).toBe(true);
    expect(evaluateChoice({ ...spell, state: 0xcb21 + 1 }, world(), e)).toBe(false);
  });
});

describe('skill checks', () => {
  const store = ddx([
    {
      key: 1,
      actions: [{ type: ActionType.LoadSkillValue, words: [0, HAGGLING] }],
      choices: [
        { state: SKILL_CHECK, min: 50, target: 2 },
        { state: 0, target: 3 },
      ],
    },
    { text: 'good' },
    { text: 'bad' },
  ]);

  it('branches on the best character and remembers who it was', () => {
    const env = makeDialogEnv({ getParty: () => party(), zone: 1, chapter: 1 });
    const session = new DialogSession(store, world(), [], env);
    session.start(1);
    expect(session.view?.snippet.text).toBe('good');
    expect(session.skillCheck).toBe(70);
    expect(session.textVars?.values.get(0)).toBeDefined();
  });

  it('takes the fallback branch when nobody is good enough', () => {
    const weak = party();
    weak.characters[1]!.skills.haggling.trueSkill = 30;
    const env = makeDialogEnv({ getParty: () => weak, zone: 1, chapter: 1 });
    const session = new DialogSession(store, world(), [], env);
    session.start(1);
    expect(session.view?.snippet.text).toBe('bad');
  });

  it('leaves the action pending when the env cannot read skills', () => {
    const session = new DialogSession(store, world());
    session.start(1);
    expect(session.pendingActions.map((a) => a.type)).toEqual([ActionType.LoadSkillValue]);
  });
});

describe('GainSkill', () => {
  const gain = (words: number[]) => {
    const s = ddx([{ key: 1, actions: [{ type: ActionType.GainSkill, words }] }]);
    return s.byKey(1)!.snippet.actions;
  };

  it('raises the skill of the whole party and reports it', () => {
    const r = applyDialogEffects({ world: world(), party: party() }, gain([0, HAGGLING, 5, 5]));
    expect(r.party.characters.map((c) => c.skills.haggling.trueSkill)).toEqual([25, 75]);
    expect(r.improvedSkills).toEqual([HAGGLING]);
  });

  it('never passes the skill maximum, and skips characters without the skill', () => {
    const p = party();
    p.characters[0]!.skills.haggling.max = 0;
    const r = applyDialogEffects({ world: world(), party: p }, gain([0, HAGGLING, 50, 50]));
    expect(r.party.characters.map((c) => c.skills.haggling.trueSkill)).toEqual([20, 100]);
  });

  it('lowers a skill for a negative amount but not below zero', () => {
    const r = applyDialogEffects({ world: world(), party: party() }, gain([0, HAGGLING, 0xffff - 99, 0xffff - 99]));
    expect(r.party.characters.map((c) => c.skills.haggling.trueSkill)).toEqual([0, 0]);
    expect(r.improvedSkills).toEqual([]);
  });
});
