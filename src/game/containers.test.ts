import { describe, expect, it } from 'vitest';
import { SKILL_NAMES, type Character, type Skill } from '../formats/gam';
import { ItemType, type ItemDef } from '../formats/objinfo';
import type { ContainerRecord } from '../formats/containers';
import {
  ContainerStore,
  bestLockpicker,
  disarmChance,
  isArmed,
  needsKey,
  needsWordLock,
  nearestContainer,
  putItem,
  springTrap,
  takeAll,
  takeItem,
  worldContainersFromRecords,
  type WorldContainer,
} from './containers';
import type { PartyState } from './party';
import { setFlag, type WorldState } from './state';

const skill = (max: number, trueSkill: number): Skill => ({
  max,
  trueSkill,
  current: 0,
  experience: 0,
  modifier: 0,
  selected: false,
  unseenImprovement: false,
});
function character(index: number, capacity = 4, lockpick = 0): Character {
  const skills = Object.fromEntries(SKILL_NAMES.map((n) => [n, skill(0, 0)])) as Character['skills'];
  skills.health = skill(50, 30);
  skills.stamina = skill(40, 10);
  skills.lockpick = skill(100, lockpick);
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
    inventory: { capacity, items: [] },
  };
}
const party = (...chars: Character[]): PartyState => ({
  gold: 0,
  characters: chars,
  activeCharacters: chars.map((c) => c.index),
  partyKeys: { capacity: 8, items: [] },
});
const world = (): WorldState => ({
  chapter: 1,
  ticks: 0,
  ticksLastSlept: 0,
  bytes: new Uint8Array(0x4000),
  expiringEvents: [],
});
const def = (name: string, type: number, stackSize = 1): ItemDef =>
  ({ name, type, stackSize, defaultStackSize: stackSize }) as unknown as ItemDef;
const defs: ItemDef[] = [];
defs[10] = def('Sword', ItemType.Sword);
defs[20] = def('Arrow', ItemType.Other, 10);
defs[61] = def('Peasant key', ItemType.Key);
defs[54] = def('Royals', ItemType.Other, 255);
const item = (itemIndex: number, conditionOrQuantity = 100, status = 0) => ({
  itemIndex,
  conditionOrQuantity,
  status,
  modifiers: 0,
});
const chest = (over: Partial<WorldContainer> = {}): WorldContainer => ({
  id: '1:0',
  zone: 1,
  x: 1000,
  y: 1000,
  model: 3,
  fromChapter: 1,
  toChapter: 9,
  capacity: 3,
  items: [],
  unlocked: false,
  trapSpent: false,
  ...over,
});

describe('container discovery', () => {
  it('builds world containers and skips doors, shops and empty placeholders', () => {
    const loc = { kind: 'world' as const, zone: 1, fromChapter: 1, toChapter: 9, model: 2, unknown: 0, x: 5, y: 6 };
    const base: ContainerRecord = {
      address: 0,
      location: loc,
      locationType: 0,
      capacity: 4,
      flags: 0,
      items: [item(10)],
    };
    const list = worldContainersFromRecords(1, [
      base,
      { ...base, capacity: 0 },
      { ...base, door: 3 },
      { ...base, shop: new Uint8Array(16) },
      {
        ...base,
        lock: { flag: 0, rating: 50, fairyChestIndex: 0, trapDamage: 0 },
        dialog: { contextVar: 0, dialogOrder: 0, key: 77 },
        encounter: { requireEventFlag: 0x20, setEventFlag: 0x21 },
      },
    ]);
    expect(list.map((c) => c.id)).toEqual(['1:0', '1:4']);
    expect(list[1]).toMatchObject({ dialogKey: 77, requireFlag: 0x20, setFlag: 0x21, lock: { rating: 50 } });
  });

  it('finds the nearest visible container in reach', () => {
    const near = chest({ id: 'a', x: 1000, y: 1000 });
    const far = chest({ id: 'b', x: 1100, y: 1000 });
    expect(nearestContainer([far, near], 1000, 900, 1, world())?.id).toBe('a');
    expect(nearestContainer([near], 5000, 5000, 1, world())).toBeUndefined();
    expect(nearestContainer([chest({ fromChapter: 3 })], 1000, 1000, 1, world())).toBeUndefined();
    const hidden = chest({ requireFlag: 0x44 });
    expect(nearestContainer([hidden], 1000, 1000, 1, world())).toBeUndefined();
    expect(nearestContainer([hidden], 1000, 1000, 1, setFlag(world(), 0x44, true))).toBe(hidden);
  });

  it('tells how a container is shut', () => {
    expect(needsWordLock(chest({ lock: { flag: 0, rating: 0, fairyChestIndex: 2, trapDamage: 0 } }))).toBe(true);
    expect(
      needsWordLock(chest({ unlocked: true, lock: { flag: 0, rating: 0, fairyChestIndex: 2, trapDamage: 0 } })),
    ).toBe(false);
    expect(needsKey(chest({ lock: { flag: 0, rating: 40, fairyChestIndex: 0, trapDamage: 0 } }))).toBe(true);
    expect(needsKey(chest({ lock: { flag: 0, rating: 0, fairyChestIndex: 0, trapDamage: 0 } }))).toBe(false);
    expect(needsKey(chest({ lock: { flag: 1, rating: 40, fairyChestIndex: 0, trapDamage: 5 } }))).toBe(false);
    const trapped = chest({ lock: { flag: 4, rating: 0, fairyChestIndex: 0, trapDamage: 5 } });
    expect(isArmed(trapped)).toBe(true);
    expect(isArmed({ ...trapped, trapSpent: true })).toBe(false);
  });
});

describe('taking and putting', () => {
  it('moves exact items into a free slot and keeps condition and flags', () => {
    const p = party(character(0, 1), character(1, 4));
    const c = chest({ items: [item(10, 63, 0x10)] });
    const r = takeItem(p, c, 0, defs, 0);
    expect(r.moved).toBe(true);
    expect(r.container.items).toEqual([]);
    expect(r.party.characters[0]!.inventory.items).toHaveLength(1);
    expect(r.party.characters[0]!.inventory.items[0]).toMatchObject({
      itemIndex: 10,
      conditionOrQuantity: 63,
      broken: true,
    });
  });

  it('falls through to the next character and then refuses when everyone is full', () => {
    let p = party(character(0, 1), character(1, 1));
    const c = chest({ items: [item(10), item(10), item(10)] });
    const all = takeAll(p, c, defs);
    expect(all.container.items).toHaveLength(1);
    expect(all.left).toBe(1);
    p = all.party;
    expect(takeItem(p, all.container, 0, defs).moved).toBe(false);
    expect(takeItem(p, all.container, 5, defs).moved).toBe(false);
  });

  it('sends money to the purse and stacks into stacks', () => {
    let p = party(character(0, 2));
    p = takeItem(p, chest({ items: [item(54, 30)] }), 0, defs).party;
    expect(p.gold).toBe(30);
    p = takeItem(p, chest({ items: [item(20, 6)] }), 0, defs).party;
    p = takeItem(p, chest({ items: [item(20, 7)] }), 0, defs).party;
    expect(p.characters[0]!.inventory.items.map((i) => i.conditionOrQuantity)).toEqual([10, 3]);
  });

  it('puts items in, merging stacks, and refuses equipped or when full', () => {
    const ch = character(0, 4);
    ch.inventory.items = [
      { ...item(10), activated: false, used: false, broken: false, repairable: false, equipped: true, poisoned: false },
      {
        ...item(20, 8),
        activated: false,
        used: false,
        broken: false,
        repairable: false,
        equipped: false,
        poisoned: false,
      },
      {
        ...item(10, 50),
        activated: false,
        used: false,
        broken: false,
        repairable: false,
        equipped: false,
        poisoned: false,
      },
    ];
    const p = party(ch);
    const c = chest({ capacity: 2, items: [item(20, 5)] });
    expect(putItem(p, 0, 0, c, defs)).toEqual({ ok: false, reason: 'equipped' });
    expect(putItem(p, 0, 7, c, defs)).toEqual({ ok: false, reason: 'missing' });
    const merged = putItem(p, 0, 1, c, defs);
    expect(merged.ok && merged.container.items).toEqual([item(20, 10), item(20, 3)]);
    const sword = putItem(p, 0, 2, c, defs);
    expect(sword.ok && sword.container.items.map((i) => i.itemIndex)).toEqual([20, 10]);
    if (sword.ok) {
      expect(sword.party.characters[0]!.inventory.items).toHaveLength(2);
      expect(putItem(sword.party, 0, 1, sword.container, defs)).toEqual({ ok: false, reason: 'full' }); // 3 arrows would need a third slot
    }
    const full = chest({ capacity: 1, items: [item(10)] });
    expect(putItem(p, 0, 2, full, defs)).toEqual({ ok: false, reason: 'full' });
  });
});

describe('traps and lockpicking', () => {
  it('picks the best lockpicker, first on ties', () => {
    const p = party(character(0, 4, 30), character(1, 4, 60), character(2, 4, 60));
    expect(bestLockpicker(p)).toMatchObject({ skill: 60, character: { index: 1 } });
    expect(bestLockpicker(party())).toBeUndefined();
  });

  it('bounds the disarm chance', () => {
    expect([0, 40, 200].map(disarmChance)).toEqual([5, 40, 95]);
  });

  it('a trap drains stamina first and then health, for everyone', () => {
    const p = springTrap(party(character(0), character(1)), 25);
    for (const c of p.characters) expect([c.skills.stamina.trueSkill, c.skills.health.trueSkill]).toEqual([0, 15]);
    expect(springTrap(p, 100).characters[0]!.skills.health.trueSkill).toBe(0);
  });
});

describe('ContainerStore', () => {
  const make = () =>
    new ContainerStore((zone) => [
      chest({ id: `${zone}:0`, zone, items: [item(10)] }),
      chest({ id: `${zone}:1`, zone }),
    ]);

  it('loads a zone once and reports only changed containers', () => {
    const s = make();
    expect(s.zone(1)).toBe(s.zone(1));
    expect(s.snapshot()).toEqual({});
    s.replace({ ...s.zone(1)[0]!, items: [], unlocked: true });
    expect(s.snapshot()).toEqual({ '1:0': { items: [], unlocked: true, trapSpent: false } });
    s.replace({ ...s.zone(1)[0]!, items: [item(10)], unlocked: false });
    expect(s.snapshot()).toEqual({});
  });

  it('restores a snapshot on a fresh load and resets to the data without one', () => {
    const s = make();
    s.replace({ ...s.zone(2)[0]!, items: [], unlocked: true });
    const snap = JSON.parse(JSON.stringify(s.snapshot()));
    const t = make();
    t.restore(snap);
    expect(t.zone(2)[0]).toMatchObject({ items: [], unlocked: true });
    expect(t.zone(2)[1]!.items).toEqual([]);
    expect(t.snapshot()).toEqual(snap);
    s.restore(undefined);
    expect(s.zone(2)[0]).toMatchObject({ items: [item(10)], unlocked: false });
  });

  it('keeps a snapshot of zones not visited again', () => {
    const s = make();
    s.restore({ '5:0': { items: [], unlocked: true, trapSpent: false } });
    expect(s.snapshot()).toEqual({ '5:0': { items: [], unlocked: true, trapSpent: false } });
  });
});
