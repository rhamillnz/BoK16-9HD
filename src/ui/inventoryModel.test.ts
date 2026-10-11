import { describe, expect, it } from 'vitest';
import { SKILL_NAMES, type Character, type InventoryItem, type Skill } from '../formats/gam';
import { ItemType, type ItemDef } from '../formats/objinfo';
import { ITEM_PICKLOCK, KEY_ITEM_BASE } from '../game/locks';
import {
  KEY_HELP,
  LOCKPICK_HELP,
  actionsFor,
  buildRows,
  categoryOf,
  compareWithEquipped,
  defaultAction,
  describeRow,
  formatMoney,
  keepSelection,
  moveSelection,
  sortRows,
  visibleRows,
} from './inventoryModel';
import { actionForKey } from './inventoryView';

const skill = (max: number, trueSkill: number): Skill => ({
  max,
  trueSkill,
  current: 0,
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
function character(index: number, items: InventoryItem[], capacity = 8): Character {
  const skills = Object.fromEntries(SKILL_NAMES.map((n) => [n, skill(0, 0)])) as Character['skills'];
  skills.health = skill(60, 30);
  return {
    index,
    name: `C${index}`,
    unknownHeader: new Uint8Array(2),
    spellBytes: new Uint8Array(6),
    spells: [],
    skills,
    combatCharIndex: 0,
    unknownTrailer: new Uint8Array(6),
    conditions: {} as Character['conditions'],
    affectors: [],
    inventory: { capacity, items },
  };
}

// Indices into `defs`: 0 sword, 1 sword (other), 2 armour, 3 ration (stack), 4 potion, 5 tool, 6 note, 7 ring, 8 misc,
// then the lockpick and a key at their real OBJINFO positions.
function def(index: number, name: string, type: number, o: Partial<ItemDef> = {}): ItemDef {
  return {
    index,
    name,
    unknown1: 0,
    flags: 0,
    unknown2: 0,
    level: 0,
    value: 10,
    strengthSwing: 0,
    strengthThrust: 0,
    accuracySwing: 0,
    accuracyThrust: 0,
    imageIndex: index,
    imageSize: 0,
    useSound: 0,
    soundPlayTimes: 0,
    stackSize: 1,
    defaultStackSize: 1,
    race: 0,
    categories: 0,
    type,
    effectMask: 0,
    effect: 0,
    potionPowerOrBookChance: 0,
    alternativeEffect: 0,
    modifierMask: 0,
    modifier: 0,
    dullChance: 0,
    maxDullAmount: 0,
    minCondition: 0,
    ...o,
  };
}
const defs: ItemDef[] = [];
const put = (d: ItemDef) => {
  defs[d.index] = d;
};
put(def(0, 'Broadsword', ItemType.Sword, { value: 120, strengthSwing: 7, strengthThrust: 5, accuracySwing: 2 }));
put(def(1, 'Dagger', ItemType.Sword, { value: 30, strengthSwing: 3, strengthThrust: 6, accuracySwing: 4 }));
put(def(2, 'Mail', ItemType.Armor, { value: 450, strengthSwing: 5, strengthThrust: 4 }));
put(def(3, 'Rations', ItemType.Ration, { value: 5, stackSize: 10 }));
put(def(4, 'Potion', ItemType.Potion, { value: 40 }));
put(def(5, 'Smith Tools', ItemType.Tool, { value: 60 }));
put(def(6, 'Letter', ItemType.Note));
put(def(8, 'Pebble', ItemType.Other, { value: 0 }));
put(def(ITEM_PICKLOCK, 'Lockpick', ItemType.Key, { value: 15 }));
put(def(KEY_ITEM_BASE + 1, 'Peasant Key', ItemType.Key, { value: 10 }));

const a = character(0, [
  item(0, { equipped: true, conditionOrQuantity: 90 }),
  item(1),
  item(2, { equipped: true }),
  item(3, { conditionOrQuantity: 6 }),
  item(4),
  item(6),
  item(8),
]);
const b = character(1, [item(5)]);
const full = character(2, [item(3, { conditionOrQuantity: 2 })], 1);
const ring = [item(ITEM_PICKLOCK), item(KEY_ITEM_BASE + 1)];
const party = [a, b, full];

const rows = () => buildRows(a, ring, defs);
const rowOf = (name: string) => rows().find((r) => r.name === name)!;
const ctx = { party, owner: a, defs };

describe('rows, categories and amounts', () => {
  it('lists the pack then the key ring', () => {
    const r = rows();
    expect(r.length).toBe(9);
    expect(r.slice(-2).every((x) => x.source === 'ring' && x.category === 'key')).toBe(true);
    expect(r[0]).toMatchObject({ id: 'pack:0', name: 'Broadsword', amount: '90%', equipped: true, category: 'weapon' });
    expect(rowOf('Rations').amount).toBe('x6');
  });
  it('puts lockpicks and keys in Keys & tools even in a pack', () => {
    expect(categoryOf(defs[ITEM_PICKLOCK], ITEM_PICKLOCK)).toBe('key');
    expect(categoryOf(defs[KEY_ITEM_BASE + 1], KEY_ITEM_BASE + 1)).toBe('key');
    expect(categoryOf(defs[5], 5)).toBe('key');
    expect(categoryOf(defs[8], 8)).toBe('other');
  });
});

describe('filter and sort', () => {
  it('filters by tab', () => {
    const names = (f: Parameters<typeof visibleRows>[1]) => visibleRows(rows(), f, 'name').map((r) => r.name);
    expect(names('weapons')).toEqual(['Broadsword', 'Dagger']);
    expect(names('armour')).toEqual(['Mail']);
    expect(names('usable')).toEqual(['Letter', 'Potion', 'Rations']);
    expect(names('keys')).toEqual(['Lockpick', 'Peasant Key']);
    expect(names('all').length).toBe(9);
  });
  it('sorts by name, type group and value (high first)', () => {
    expect(sortRows(rows(), 'name').map((r) => r.name)[0]).toBe('Broadsword');
    expect(
      sortRows(rows(), 'value')
        .map((r) => r.name)
        .slice(0, 3),
    ).toEqual(['Mail', 'Broadsword', 'Potion']);
    const type = sortRows(rows(), 'type').map((r) => r.category);
    expect(type.indexOf('armour')).toBeGreaterThan(type.lastIndexOf('weapon'));
    expect(type.indexOf('key')).toBeGreaterThan(type.lastIndexOf('usable'));
  });
  it('does not change the order of the source rows', () => {
    const r = rows();
    const before = r.map((x) => x.id).join();
    sortRows(r, 'value');
    expect(r.map((x) => x.id).join()).toBe(before);
  });
});

describe('selection', () => {
  it('moves within the list and clamps', () => {
    const r = sortRows(rows(), 'name');
    expect(moveSelection(r, undefined, 1)).toBe(r[0]!.id);
    expect(moveSelection(r, r[0]!.id, -1)).toBe(r[0]!.id);
    expect(moveSelection(r, r[0]!.id, 2)).toBe(r[2]!.id);
    expect(moveSelection(r, r[r.length - 1]!.id, 5)).toBe(r[r.length - 1]!.id);
    expect(moveSelection([], 'x', 1)).toBeUndefined();
  });
  it('keeps a valid selection and falls back to the nearest place', () => {
    const r = sortRows(rows(), 'name');
    expect(keepSelection(r, r[1]!.id)).toBe(r[1]!.id);
    expect(keepSelection(r, 'pack:99', 2)).toBe(r[2]!.id);
    expect(keepSelection(r, 'pack:99', 99)).toBe(r[r.length - 1]!.id);
  });
});

describe('comparison with the equipped item', () => {
  it('shows differences against the equipped weapon of the same group', () => {
    const c = compareWithEquipped(rowOf('Dagger'), rows(), defs);
    expect(c.against?.name).toBe('Broadsword');
    const swing = c.stats.find((s) => s.label === 'Damage (swing)')!;
    expect(swing).toMatchObject({ value: 3, other: 7, delta: -4 });
    expect(c.stats.find((s) => s.label === 'Damage (thrust)')!.delta).toBe(1);
  });
  it('has nothing to compare for the equipped item itself, consumables and ring items', () => {
    expect(compareWithEquipped(rowOf('Broadsword'), rows(), defs).against).toBeUndefined();
    expect(compareWithEquipped(rowOf('Broadsword'), rows(), defs).stats.length).toBeGreaterThan(0);
    expect(compareWithEquipped(rowOf('Rations'), rows(), defs).stats).toEqual([]);
    expect(compareWithEquipped(rowOf('Lockpick'), rows(), defs).stats).toEqual([]);
  });
  it('uses defence labels for armour', () => {
    const c = compareWithEquipped(rowOf('Mail'), rows(), defs);
    expect(c.stats.map((s) => s.label)).toEqual(['Defence (swing)', 'Defence (thrust)']);
  });
});

describe('actions', () => {
  const by = (name: string) => actionsFor(rowOf(name), ctx);
  const get = (name: string, id: string, target?: number) =>
    by(name).find((x) => x.id === id && (target === undefined || x.target === target));

  it('offers use for consumables and equip for equipment', () => {
    expect(get('Rations', 'use')).toMatchObject({ enabled: true });
    expect(get('Rations', 'equip')).toMatchObject({ enabled: false });
    expect(get('Dagger', 'equip')).toMatchObject({ enabled: true, label: 'Equip' });
    expect(get('Broadsword', 'equip')).toMatchObject({ enabled: true, label: 'Unequip' });
    expect(get('Dagger', 'use')).toMatchObject({ enabled: false });
    expect(get('Dagger', 'use')!.reason).toMatch(/Equip/);
  });
  it('disables equip for a broken item and says why', () => {
    const broken = character(0, [item(1, { broken: true, repairable: true })]);
    const r = buildRows(broken, [], defs)[0]!;
    const act = actionsFor(r, { party: [broken, b], owner: broken, defs });
    expect(act.find((x) => x.id === 'equip')).toMatchObject({ enabled: false });
    expect(act.find((x) => x.id === 'equip')!.reason).toMatch(/broken/);
    // someone carries a tool (b), so repairing is possible
    expect(act.find((x) => x.id === 'repair')).toMatchObject({ enabled: true });
  });
  it('shows repair only for equipment and disables it when perfect or without a tool', () => {
    expect(get('Rations', 'repair')).toBeUndefined();
    expect(get('Dagger', 'repair')).toMatchObject({ enabled: false });
    expect(get('Dagger', 'repair')!.reason).toMatch(/perfect/);
    const worn = character(0, [item(1, { conditionOrQuantity: 40 })]);
    const row = buildRows(worn, [], defs)[0]!;
    const noTool = actionsFor(row, { party: [worn], owner: worn, defs }).find((x) => x.id === 'repair')!;
    expect(noTool).toMatchObject({ enabled: false });
    expect(noTool.reason).toMatch(/tool/);
  });
  it('has one Give button per other member, with explicit targets, never to the owner', () => {
    const give = by('Dagger').filter((x) => x.id === 'give');
    expect(give.map((x) => x.target)).toEqual([1, 2]);
    expect(give.map((x) => x.label)).toEqual(['Give to C1', 'Give to C2']);
  });
  it('disables give for a full pack, except when a stack can merge', () => {
    const full2 = character(2, [item(4)], 1);
    const ctx2 = { party: [a, b, full2], owner: a, defs };
    const dagger = actionsFor(rowOf('Dagger'), ctx2).find((x) => x.target === 2)!;
    expect(dagger).toMatchObject({ enabled: false, reason: 'C2 cannot carry any more.' });
    // `full` already holds rations (stack), so they merge
    expect(actionsFor(rowOf('Rations'), ctx).find((x) => x.target === 2)).toMatchObject({ enabled: true });
  });
  it('explains lockpicks and keys and offers no action on ring items', () => {
    const pick = actionsFor(rowOf('Lockpick'), ctx);
    expect(pick).toHaveLength(1);
    expect(pick[0]).toMatchObject({ id: 'use', enabled: false, reason: LOCKPICK_HELP });
    expect(actionsFor(rowOf('Peasant Key'), ctx)[0]!.reason).toBe(KEY_HELP);
    expect(describeRow(rowOf('Lockpick'))).toEqual([LOCKPICK_HELP]);
    expect(describeRow(rowOf('Peasant Key'))).toEqual([KEY_HELP]);
  });
  it('explains a lockpick or key carried in a pack the same way', () => {
    const c = character(0, [item(ITEM_PICKLOCK), item(KEY_ITEM_BASE + 1)]);
    const r = buildRows(c, [], defs);
    expect(actionsFor(r[0]!, { party: [c], owner: c, defs })[0]!.reason).toBe(LOCKPICK_HELP);
    expect(actionsFor(r[1]!, { party: [c], owner: c, defs })[0]!.reason).toBe(KEY_HELP);
  });
  it('refuses notes (cannot be read yet) and keeps use disabled for a spent book', () => {
    expect(get('Letter', 'use')).toMatchObject({ enabled: false });
    expect(get('Letter', 'use')!.reason).toMatch(/cannot be read/);
  });
  it('double-click picks equip for equipment and use for consumables', () => {
    expect(defaultAction(by('Dagger'))?.id).toBe('equip');
    expect(defaultAction(by('Rations'))?.id).toBe('use');
    expect(defaultAction(by('Lockpick'))).toBeUndefined();
    expect(defaultAction(by('Pebble'))).toBeUndefined();
  });
});

describe('formatting and keys', () => {
  it('writes money in sovereigns and royals', () => {
    expect(formatMoney(0)).toBe('0 royals');
    expect(formatMoney(1)).toBe('1 royal');
    expect(formatMoney(10)).toBe('1 sovereign');
    expect(formatMoney(25)).toBe('2 sovereigns, 5 royals');
  });
  it('maps shortcut keys to actions', () => {
    expect(actionForKey('Enter')).toBe('use');
    expect(actionForKey('x')).toBe('equip');
    expect(actionForKey('X')).toBe('equip');
    expect(actionForKey('g')).toBe('give');
    expect(actionForKey('r')).toBe('repair');
    expect(actionForKey('z')).toBeUndefined();
  });
});
