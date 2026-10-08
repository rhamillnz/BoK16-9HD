import { describe, expect, it } from 'vitest';
import { SKILL_NAMES, type Character, type InventoryItem, type Skill } from '../formats/gam';
import { ItemType, type ItemDef } from '../formats/objinfo';
import type { SpellDef } from '../formats/spells';
import { giveToCharacter, repairItem, toggleEquip, useItem } from './itemUse';
import type { PartyState } from './party';

const skill = (max: number, trueSkill: number, current = 0): Skill => ({
  max,
  trueSkill,
  current,
  experience: 0,
  modifier: 0,
  selected: false,
  unseenImprovement: false,
});
const item = (itemIndex: number, o: Partial<InventoryItem> = {}): InventoryItem => ({
  itemIndex,
  conditionOrQuantity: 100,
  status: 0,
  modifiers: 0,
  activated: false,
  used: false,
  broken: false,
  repairable: false,
  equipped: false,
  poisoned: false,
  ...o,
});

function character(index: number, items: InventoryItem[], capacity = 4): Character {
  const skills = Object.fromEntries(SKILL_NAMES.map((n) => [n, skill(0, 0)])) as Character['skills'];
  skills.health = skill(60, 30);
  skills.weaponcraft = skill(100, 100, 100);
  skills.armorcraft = skill(100, 100, 100);
  skills.melee = skill(50, 10);
  return {
    index,
    name: `C${index}`,
    unknownHeader: new Uint8Array(2),
    spellBytes: new Uint8Array(6),
    spells: [],
    skills,
    combatCharIndex: 0,
    unknownTrailer: new Uint8Array(6),
    conditions: { sick: 10, plagued: 0, poisoned: 40, drunk: 0, healing: 0, starving: 50, nearDeath: 0 },
    affectors: [],
    inventory: { capacity, items },
  };
}
const party = (a: InventoryItem[], b: InventoryItem[] = [], capacity = 4): PartyState => ({
  gold: 0,
  characters: [character(0, a, capacity), character(1, b, capacity)],
  activeCharacters: [0, 1],
  partyKeys: { capacity: 8, items: [] },
});

const D = (i: number, type: ItemType, o: Partial<ItemDef> = {}): ItemDef =>
  ({
    index: i,
    name: `Item${i}`,
    type,
    stackSize: 1,
    defaultStackSize: 1,
    potionPowerOrBookChance: 0,
    ...o,
  }) as ItemDef;
const DEFS = [
  D(0, ItemType.Sword),
  D(1, ItemType.Staff),
  D(2, ItemType.Armor),
  D(3, ItemType.Ration, { stackSize: 5 }),
  D(4, ItemType.Potion, { potionPowerOrBookChance: 15 }),
  D(5, ItemType.Restoratives, { potionPowerOrBookChance: 40 }),
  D(6, ItemType.Tool),
  D(7, ItemType.Scroll),
  D(8, ItemType.Crossbow),
  D(9, ItemType.Book, { effectMask: 1 << 6, effect: 3, potionPowerOrBookChance: 50, alternativeEffect: 2 }),
];
const SPELL_DEFS = [0, 1, 2, 3, 4, 5].map((i) => ({
  index: i,
  name: i === 5 ? 'Flamecast' : `Spell${i}`,
})) as SpellDef[];
const c0 = (p: PartyState) => p.characters[0]!;

describe('toggleEquip', () => {
  it('equips one melee weapon at a time and leaves armour alone', () => {
    const p = party([item(0, { equipped: true }), item(1), item(2, { equipped: true })]);
    const r = toggleEquip(p, 0, 1, DEFS);
    expect(r.ok).toBe(true);
    expect(c0(r.party).inventory.items.map((i) => i.equipped)).toEqual([false, true, true]);
  });
  it('unequips an equipped item, refuses broken and non-equipment', () => {
    const p = party([item(0, { equipped: true }), item(1, { broken: true }), item(3)]);
    expect(c0(toggleEquip(p, 0, 0, DEFS).party).inventory.items[0]!.equipped).toBe(false);
    expect(toggleEquip(p, 0, 1, DEFS).ok).toBe(false);
    expect(toggleEquip(p, 0, 2, DEFS).message).toMatch(/cannot be equipped/);
  });
});

describe('useItem', () => {
  it('eating takes one from a stack and clears starvation', () => {
    const r = useItem(party([item(3, { conditionOrQuantity: 3 })]), 0, 0, DEFS);
    expect(c0(r.party).inventory.items[0]!.conditionOrQuantity).toBe(2);
    expect(c0(r.party).conditions.starving).toBe(0);
  });
  it('the last ration leaves the slot', () => {
    const r = useItem(party([item(3, { conditionOrQuantity: 1 })]), 0, 0, DEFS);
    expect(c0(r.party).inventory.items).toHaveLength(0);
  });
  it('potions heal up to the maximum; restoratives also cure poison and sickness', () => {
    expect(c0(useItem(party([item(4)]), 0, 0, DEFS).party).skills.health.trueSkill).toBe(45);
    const r = useItem(party([item(5)]), 0, 0, DEFS);
    expect(c0(r.party).skills.health.trueSkill).toBe(60);
    expect(c0(r.party).conditions.poisoned).toBe(0);
    expect(c0(r.party).conditions.sick).toBe(0);
  });
  it('refuses weapons without consuming them', () => {
    const p = party([item(0)]);
    expect(useItem(p, 0, 0, DEFS)).toMatchObject({ ok: false, party: p });
  });
  it('a scroll teaches its spell to a magic-user and is used up', () => {
    const p = party([item(7, { conditionOrQuantity: 5 })]);
    expect(useItem(p, 0, 0, DEFS, { spells: SPELL_DEFS })).toMatchObject({
      ok: false,
      message: expect.stringMatching(/cannot read magic/),
    });
    const caster = {
      ...p,
      characters: [{ ...c0(p), skills: { ...c0(p).skills, casting: skill(40, 40) } }, ...p.characters.slice(1)],
    };
    const r = useItem(caster, 0, 0, DEFS, { spells: SPELL_DEFS });
    expect(r.ok).toBe(true);
    expect(c0(r.party).spells).toEqual([5]);
    expect(c0(r.party).inventory.items).toHaveLength(0);
    expect(r.message).toMatch(/learns Flamecast/);
    const again = useItem(
      {
        ...r.party,
        characters: [
          { ...c0(r.party), inventory: { capacity: 4, items: [item(7, { conditionOrQuantity: 5 })] } },
          ...r.party.characters.slice(1),
        ],
      },
      0,
      0,
      DEFS,
      { spells: SPELL_DEFS },
    );
    expect(again).toMatchObject({ ok: false, message: expect.stringMatching(/already knows/) });
  });
  it('a book raises its skill on the first reading and loses a charge', () => {
    const p = party([item(9, { conditionOrQuantity: 2 })]);
    const read = new Set<string>();
    const ctx = {
      hasRead: (c: number, i: number) => read.has(`${c}:${i}`),
      markRead: (c: number, i: number) => {
        read.add(`${c}:${i}`);
      },
    };
    const r = useItem(p, 0, 0, DEFS, ctx);
    expect(c0(r.party).skills.melee.trueSkill).toBe(13);
    expect(c0(r.party).inventory.items[0]!.conditionOrQuantity).toBe(1);
    const second = useItem(r.party, 0, 0, DEFS, { ...ctx, random: () => 99 });
    expect(c0(second.party).skills.melee.trueSkill).toBe(15);
    expect(useItem(party([item(9, { conditionOrQuantity: 0 })]), 0, 0, DEFS).ok).toBe(false);
  });
  it('does not mutate its input', () => {
    const p = party([item(4)]);
    useItem(p, 0, 0, DEFS);
    expect(c0(p).inventory.items).toHaveLength(1);
    expect(c0(p).skills.health.trueSkill).toBe(30);
  });
});

describe('giveToCharacter', () => {
  it('moves a condition item and drops its equipped mark', () => {
    const r = giveToCharacter(party([item(0, { conditionOrQuantity: 42, equipped: true })]), 0, 0, 1, DEFS);
    expect(r.party.characters[0]!.inventory.items).toHaveLength(0);
    expect(r.party.characters[1]!.inventory.items[0]).toMatchObject({
      itemIndex: 0,
      conditionOrQuantity: 42,
      equipped: false,
    });
  });
  it('merges stacks and respects the slot limit', () => {
    const r = giveToCharacter(
      party([item(3, { conditionOrQuantity: 3 })], [item(3, { conditionOrQuantity: 4 })]),
      0,
      0,
      1,
      DEFS,
    );
    expect(r.party.characters[1]!.inventory.items.map((i) => i.conditionOrQuantity)).toEqual([5, 2]);
    const full = party([item(0)], [item(1), item(1), item(1), item(1)]);
    expect(giveToCharacter(full, 0, 0, 1, DEFS)).toMatchObject({ ok: false, party: full });
  });
});

describe('repairItem', () => {
  const dmg = (o: Partial<InventoryItem> = {}) => item(0, { conditionOrQuantity: 40, ...o });
  it('needs a tool, which may belong to another character', () => {
    expect(repairItem(party([dmg()]), 0, 0, DEFS, () => 0).message).toMatch(/need a tool/);
    const r = repairItem(party([dmg()], [item(6)]), 0, 0, DEFS, () => 0);
    expect(r.ok).toBe(true);
    expect(c0(r.party).inventory.items[0]!.conditionOrQuantity).toBe(65);
    expect(r.party.characters[1]!.inventory.items[0]!.conditionOrQuantity).toBe(90);
  });
  it('a failed roll wears the tool and leaves the item', () => {
    const r = repairItem(party([dmg()], [item(6, { conditionOrQuantity: 10 })]), 0, 0, DEFS, () => 99);
    expect(r.ok).toBe(false);
    expect(c0(r.party).inventory.items[0]!.conditionOrQuantity).toBe(40);
    expect(r.party.characters[1]!.inventory.items).toHaveLength(0);
  });
  it('repairs broken repairable items, not unrepairable or pristine ones', () => {
    const tool = [item(6)];
    const fixed = repairItem(party([dmg({ broken: true, repairable: true })], tool), 0, 0, DEFS, () => 0);
    expect(c0(fixed.party).inventory.items[0]!.broken).toBe(false);
    expect(repairItem(party([dmg({ broken: true })], tool), 0, 0, DEFS, () => 0).message).toMatch(/beyond repair/);
    expect(repairItem(party([item(0)], tool), 0, 0, DEFS, () => 0).message).toMatch(/perfect/);
    expect(repairItem(party([item(3)], tool), 0, 0, DEFS, () => 0).message).toMatch(/cannot be repaired/);
  });
});
