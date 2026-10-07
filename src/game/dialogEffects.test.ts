import { describe, expect, it } from 'vitest';
import { ActionType, parseDDX, type DialogAction } from '../formats/ddx';
import { SKILL_NAMES, type Character, type Skill } from '../formats/gam';
import { ItemType, type ItemDef } from '../formats/objinfo';
import { applyDialogEffects, GAME_STATE_ITEM_VALUE } from './dialogEffects';
import { ITEM_ROYALS, ITEM_SOVEREIGNS, type PartyState } from './party';
import { getFlag, TICKS_PER_HOUR, type WorldState } from './state';

// ---- synthetic fixtures ----------------------------------------------------

/** Decode actions the way the game does: through a one-snippet DDX. */
function actions(...specs: { type: number; words?: number[]; bytes?: number[] }[]): DialogAction[] {
  const size = 9 + specs.length * 10;
  const out = new Uint8Array(2 + 8 + size);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, 1, true);
  dv.setUint32(2, 1, true);
  dv.setUint32(6, 10, true);
  dv.setUint8(10 + 6, specs.length);
  dv.setUint16(10 + 7, 0, true);
  specs.forEach((s, i) => {
    const p = 10 + 9 + i * 10;
    dv.setUint16(p, s.type, true);
    (s.words ?? []).forEach((w, k) => dv.setUint16(p + 2 + k * 2, w, true));
    (s.bytes ?? []).forEach((b, k) => dv.setUint8(p + 2 + k, b));
  });
  return parseDDX(out).snippets[0]!.actions;
}

function skill(max: number, trueSkill: number): Skill {
  return { max, trueSkill, current: 0, experience: 0, modifier: 0, selected: false, unseenImprovement: false };
}

function character(index: number, capacity = 4): Character {
  const skills = Object.fromEntries(SKILL_NAMES.map((n) => [n, skill(0, 0)])) as Character['skills'];
  skills.health = skill(60, 30);
  return {
    index, name: `C${index}`, unknownHeader: new Uint8Array(2), spellBytes: new Uint8Array(6), spells: [], skills,
    combatCharIndex: 0, unknownTrailer: new Uint8Array(6),
    conditions: { sick: 10, plagued: 0, poisoned: 40, drunk: 0, healing: 0, starving: 0, nearDeath: 0 },
    affectors: [], inventory: { capacity, items: [] },
  };
}

function party(capacity = 4): PartyState {
  return {
    gold: 100,
    characters: [character(0, capacity), character(1, capacity), character(2, capacity)],
    activeCharacters: [0, 1],
    partyKeys: { capacity: 8, items: [] },
  };
}

function world(): WorldState {
  return { chapter: 1, ticks: 1000, ticksLastSlept: 0, bytes: new Uint8Array(0x4000), expiringEvents: [] };
}

const ITEMS = [] as ItemDef[];
ITEMS[7] = { index: 7, stackSize: 10, defaultStackSize: 1, type: ItemType.Potion } as ItemDef;
ITEMS[9] = { index: 9, stackSize: 1, defaultStackSize: 1, type: ItemType.Key } as ItemDef;
ITEMS[3] = { index: 3, stackSize: 1, defaultStackSize: 1, type: ItemType.Sword } as ItemDef;

const apply = (a: DialogAction[], p = party(), extra: object = {}) =>
  applyDialogEffects({ world: world(), party: p, items: ITEMS, ...extra }, a);

// ---- items and money -------------------------------------------------------

describe('GiveItem', () => {
  it('puts a plain item on the first active character', () => {
    const r = apply(actions({ type: ActionType.GiveItem, bytes: [3, 0, 1, 0] }));
    expect(r.party.characters[0]!.inventory.items.map((i) => i.itemIndex)).toEqual([3]);
    expect(r.party.characters[1]!.inventory.items).toHaveLength(0);
  });

  it('stacks quantity items and spills into the next slot at the stack size', () => {
    const p = apply(actions({ type: ActionType.GiveItem, bytes: [7, 0, 8, 0] })).party;
    const r = apply(actions({ type: ActionType.GiveItem, bytes: [7, 0, 5, 0] }), p);
    expect(r.party.characters[0]!.inventory.items.map((i) => i.conditionOrQuantity)).toEqual([10, 3]);
  });

  it('moves on to the next character when the first is full, and drops the item when all are', () => {
    const full = apply(actions({ type: ActionType.GiveItem, bytes: [3, 0, 1, 0] }), party(1)).party;
    const second = apply(actions({ type: ActionType.GiveItem, bytes: [3, 0, 1, 0] }), full).party;
    expect(second.characters[1]!.inventory.items).toHaveLength(1);
    const dropped = apply(actions({ type: ActionType.GiveItem, bytes: [3, 0, 1, 0] }), second);
    expect(dropped.lostItems).toEqual([{ itemIndex: 3, quantity: 1 }]);
  });

  it('turns sovereigns and royals into gold', () => {
    const r = apply(actions(
      { type: ActionType.GiveItem, bytes: [ITEM_SOVEREIGNS, 0, 3, 0] },
      { type: ActionType.GiveItem, bytes: [ITEM_ROYALS, 0, 5, 0] },
    ));
    expect(r.party.gold).toBe(100 + 30 + 5);
  });

  it('sends keys to the key ring', () => {
    const r = apply(actions({ type: ActionType.GiveItem, bytes: [9, 0, 1, 0] }));
    expect(r.party.partyKeys.items.map((i) => i.itemIndex)).toEqual([9]);
  });
});

describe('LoseItem', () => {
  it('removes from stacks across the party and never makes gold negative', () => {
    let p = apply(actions({ type: ActionType.GiveItem, bytes: [7, 0, 8, 0] })).party;
    p = apply(actions({ type: ActionType.LoseItem, words: [7, 3] }), p).party;
    expect(p.characters[0]!.inventory.items[0]!.conditionOrQuantity).toBe(5);
    p = apply(actions({ type: ActionType.LoseNOfItem, words: [7, 5] }), p).party;
    expect(p.characters[0]!.inventory.items).toHaveLength(0);
    p = apply(actions({ type: ActionType.LoseItem, words: [ITEM_SOVEREIGNS, 50] }), p).party;
    expect(p.gold).toBe(0);
  });
});

describe('SpecialAction money', () => {
  it('moves the scripted item value', () => {
    const gameState = (id: number) => (id === GAME_STATE_ITEM_VALUE ? 40 : 0);
    const less = apply(actions({ type: ActionType.SpecialAction, words: [0, 0, 0, 0] }), party(), { gameState });
    const more = apply(actions({ type: ActionType.SpecialAction, words: [1, 0, 0, 0] }), party(), { gameState });
    expect([less.party.gold, more.party.gold]).toEqual([60, 140]);
  });
});

// ---- characters ------------------------------------------------------------

describe('HealCharacters', () => {
  it('fully heals the active party, clears conditions and counts as a rest', () => {
    const r = apply(actions({ type: ActionType.HealCharacters, words: [0, 100] }));
    expect(r.party.characters[0]!.skills.health.trueSkill).toBe(60);
    expect(r.party.characters[1]!.conditions.poisoned).toBe(0);
    expect(r.party.characters[2]!.skills.health.trueSkill).toBe(30); // not in the party
    expect(r.world.ticksLastSlept).toBe(1000);
  });

  it('a heal below 100 takes 20% off the current health, as the original does', () => {
    const r = apply(actions({ type: ActionType.HealCharacters, words: [0, 50] }));
    expect(r.party.characters[0]!.skills.health.trueSkill).toBe(24);
  });

  it('targets one character through the dialogue character list', () => {
    const r = apply(actions({ type: ActionType.HealCharacters, words: [2, 100] }), party(), { dialogCharacters: [1] });
    expect(r.party.characters[0]!.skills.health.trueSkill).toBe(30);
    expect(r.party.characters[1]!.skills.health.trueSkill).toBe(60);
  });
});

describe('GainCondition, LearnSpell, UpdateCharacters', () => {
  it('adds a random amount within the range, capped at 100', () => {
    const a = actions({ type: ActionType.GainCondition, words: [0, 3, 10, 30] });
    const r = apply(a, party(), { random: () => 5 });
    expect(r.party.characters[0]!.conditions.drunk).toBe(15);
    const big = apply(actions({ type: ActionType.GainCondition, words: [0, 2, 200, 200] }));
    expect(big.party.characters[0]!.conditions.poisoned).toBe(100);
  });

  it('learns a spell by setting its bit', () => {
    const r = apply(actions({ type: ActionType.LearnSpell, words: [0, 10] }));
    expect(r.party.characters[0]!.spells).toEqual([10]);
    expect(r.party.characters[0]!.spellBytes[1]).toBe(1 << 2);
  });

  it('replaces the active party with known characters', () => {
    const r = apply(actions({ type: ActionType.UpdateCharacters, words: [2, 2, 0] }));
    expect(r.party.activeCharacters).toEqual([2, 0]);
  });
});

// ---- world state -----------------------------------------------------------

describe('world actions', () => {
  it('ElapseTime advances the clock and reports the ticks', () => {
    const r = apply(actions({ type: ActionType.ElapseTime, words: [TICKS_PER_HOUR & 0xffff, TICKS_PER_HOUR >> 16] }));
    expect(r.world.ticks).toBe(1000 + TICKS_PER_HOUR);
    expect(r.ticksElapsed).toBe(TICKS_PER_HOUR);
  });

  it('SetAddResetState sets the flag now and queues the reset', () => {
    const r = apply(actions({ type: ActionType.SetAddResetState, words: [0x500, 0, 100, 0] }));
    expect(getFlag(r.world, 0x500)).toBe(true);
    expect(r.world.expiringEvents).toEqual([{ type: 4, flags: 0x40, data: 0x500, duration: 100 }]);
  });

  it('SetTimeExpiringState queues the event as given', () => {
    const r = apply(actions({ type: ActionType.SetTimeExpiringState, bytes: [3, 5, 0x34, 0x02, 60, 0, 0, 0] }));
    expect(r.world.expiringEvents).toEqual([{ type: 3, flags: 5, data: 0x234, duration: 60 }]);
  });

  it('leaves actions it has no effect for in `unhandled`', () => {
    const r = apply(actions({ type: ActionType.PlaySound, words: [1, 0] }, { type: ActionType.GainSkill, words: [0, 1, 1, 2] }));
    expect(r.unhandled.map((a) => a.name)).toEqual(['PlaySound', 'GainSkill']);
  });
});
