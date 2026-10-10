import { describe, expect, it } from 'vitest';
import { applyBattleToParty, buildFighters, retreatDestination } from '../src/combat/setup';
import type { CombatDef, EnemyRecord } from '../src/combat/combatData';
import { CONDITION_NAMES, SKILL_NAMES, type Character, type SkillName } from '../src/formats/gam';
import { ItemType, Race, type ItemDef } from '../src/formats/objinfo';

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
const character = (
  index: number,
  name: string,
  items: Character['inventory']['items'] = [],
  over: Partial<Record<SkillName, number>> = {},
): Character => ({
  index,
  name,
  unknownHeader: new Uint8Array(2),
  spellBytes: new Uint8Array(6),
  spells: [],
  skills: skills(over),
  combatCharIndex: 0,
  unknownTrailer: new Uint8Array(6),
  conditions: Object.fromEntries(CONDITION_NAMES.map((c) => [c, 0])) as Character['conditions'],
  affectors: [],
  inventory: { capacity: 24, items },
});
const item = (itemIndex: number, equipped: boolean, cond = 80) => ({
  itemIndex,
  conditionOrQuantity: cond,
  status: 0,
  modifiers: 0,
  activated: false,
  used: false,
  broken: false,
  repairable: false,
  equipped,
  poisoned: false,
});
const def = (type: ItemType, over: Partial<ItemDef> = {}): ItemDef => ({
  index: 0,
  name: 'x',
  unknown1: 0,
  flags: 0,
  unknown2: 0,
  level: 0,
  value: 0,
  strengthSwing: 10,
  strengthThrust: 6,
  accuracySwing: 8,
  accuracyThrust: 12,
  imageIndex: 0,
  imageSize: 0,
  useSound: 0,
  soundPlayTimes: 0,
  stackSize: 1,
  defaultStackSize: 1,
  race: Race.Human,
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
  ...over,
});
const items: ItemDef[] = [def(ItemType.Sword), def(ItemType.Armor, { accuracySwing: 20 }), def(ItemType.Potion)];

const combatDef: CombatDef = {
  combatIndex: 1,
  entryDialog: 0,
  scoutDialog: 0,
  ambush: false,
  retreat: {
    north: { x: 0, y: 0, heading: 0 },
    west: { x: 0, y: 0, heading: 0 },
    south: { x: 0, y: 0, heading: 0 },
    east: { x: 0, y: 0, heading: 0 },
  },
  combatants: [
    { monster: 3, movementType: 0, position: { x: 0, y: 0, heading: 0 } },
    { monster: 3, movementType: 0, position: { x: 0, y: 0, heading: 0 } },
  ],
};
const enemy = (combatant: number, monster: number, gridX: number, gridY: number, dead = false): EnemyRecord => ({
  combatant,
  monster,
  gridX,
  gridY,
  dead,
  retreatFactor: 0,
  skills: Object.fromEntries(
    SKILL_NAMES.map((n) => [n, { max: 10, trueSkill: 10, modifier: 0 }]),
  ) as EnemyRecord['skills'],
});
const names = ['INVALID MONSTER', 'a', 'b', 'Brigand'];

describe('buildFighters', () => {
  const party = [
    character(0, 'Owyn', [item(0, true), item(1, true, 50), item(2, true)]),
    character(1, 'Locklear'),
    character(2, 'Gorath', [], { health: 0 }),
  ];
  const grid = [
    { monster: 5, gridX: 3, gridY: 1 },
    { monster: 6, gridX: 3, gridY: 1 },
    { monster: 7, gridX: 4, gridY: 1 },
  ];

  it('uses the equipped sword and armour of each party member and skips the fallen', () => {
    const f = buildFighters({
      def: combatDef,
      enemies: [enemy(9, 3, 2, 10)],
      party,
      partyGrid: grid,
      monsterNames: names,
      items,
    });
    const owyn = f.find((x) => x.name === 'Owyn')!;
    expect(owyn.weapon).toMatchObject({ strengthSwing: 10, accuracyThrust: 12, condition: 80 });
    expect(owyn.armor).toMatchObject({ rating: 20, condition: 50 });
    expect(f.some((x) => x.name === 'Gorath')).toBe(false);
  });

  it('keeps everyone on distinct cells, nudging a clash to a free neighbour', () => {
    const f = buildFighters({
      def: combatDef,
      enemies: [enemy(9, 3, 3, 1)],
      party,
      partyGrid: grid,
      monsterNames: names,
      items,
    });
    const cells = f.map((x) => `${x.pos.x},${x.pos.y}`);
    expect(new Set(cells).size).toBe(cells.length);
    expect(f.find((x) => x.name === 'Owyn')!.pos).toEqual({ x: 3, y: 1 });
  });

  it('never places a fighter on a disabled cell', () => {
    const disabled = [
      { x: 3, y: 1 },
      { x: 2, y: 10 },
    ];
    const f = buildFighters({
      def: combatDef,
      enemies: [enemy(9, 3, 2, 10)],
      party,
      partyGrid: grid,
      monsterNames: names,
      items,
      disabled,
    });
    for (const x of f) expect(disabled).not.toContainEqual(x.pos);
    expect(f.find((x) => x.name === 'Owyn')!.pos).not.toEqual({ x: 3, y: 1 });
  });

  it('names enemies from the table and numbers repeats; dead ones stay out', () => {
    const f = buildFighters({
      def: combatDef,
      enemies: [enemy(9, 3, 2, 10), enemy(10, 3, 4, 10), enemy(11, 3, 5, 10, true)],
      party,
      partyGrid: grid,
      monsterNames: names,
      items,
    });
    expect(f.filter((x) => x.side === 'enemy').map((x) => x.name)).toEqual(['Brigand', 'Brigand 2']);
  });

  it('makes stand-in enemies from the combat table when the save has none', () => {
    const f = buildFighters({ def: combatDef, enemies: [], party, partyGrid: grid, monsterNames: names, items });
    expect(f.filter((x) => x.side === 'enemy')).toHaveLength(2);
  });
});

describe('applyBattleToParty', () => {
  it('writes health and stamina back and marks the fallen as near death', () => {
    const party = {
      gold: 0,
      characters: [character(0, 'Owyn'), character(1, 'Locklear')],
      activeCharacters: [0, 1],
      partyKeys: { capacity: 0, items: [] },
    };
    const fighters = buildFighters({
      def: combatDef,
      enemies: [enemy(9, 3, 2, 10)],
      party: party.characters,
      partyGrid: [],
      monsterNames: names,
      items,
    });
    fighters[0]!.health = 7;
    fighters[0]!.stamina = 2;
    fighters[1]!.health = 0;
    const after = applyBattleToParty(party, fighters);
    expect(after.characters[0]!.skills.health.trueSkill).toBe(7);
    expect(after.characters[0]!.skills.stamina.trueSkill).toBe(2);
    expect(after.characters[1]!.conditions.nearDeath).toBe(100);
    expect(after.characters[0]!.conditions.nearDeath).toBe(0);
  });
});

describe('retreatDestination', () => {
  it('adds the tile origin to the retreat point on the side the party came from', () => {
    const d: CombatDef = {
      ...combatDef,
      retreat: {
        north: { x: 100, y: 200, heading: 0 },
        west: { x: 1, y: 2, heading: 192 },
        south: { x: 300, y: 400, heading: 128 },
        east: { x: 5, y: 6, heading: 64 },
      },
    };
    const centre = { x: 64000 * 3 + 800, y: 64000 * 2 + 800 };
    expect(retreatDestination(d, { x: 3, y: 2 }, { x: centre.x, y: centre.y - 1200 }, centre)).toEqual({
      x: 3 * 64000 + 300,
      y: 2 * 64000 + 400,
      heading: 128,
    });
    expect(retreatDestination(d, { x: 3, y: 2 }, { x: centre.x + 1200, y: centre.y }, centre)).toEqual({
      x: 3 * 64000 + 5,
      y: 2 * 64000 + 6,
      heading: 64,
    });
  });
});
