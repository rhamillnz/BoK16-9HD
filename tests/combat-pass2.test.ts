import { describe, expect, it } from 'vitest';
import { enemyTurn } from '../src/combat/ai';
import { attack, currentFighter, rest, shoot, shootTargets, startBattle, type Fighter } from '../src/combat/battle';
import { Direction } from '../src/combat/grid';
import { applyRewards, applyWear, battleRewards, tallyBattle } from '../src/combat/rewards';
import { RANGED_RANGE, RaceKind, rangedDamage, rangedHitScore, type WeaponStats } from '../src/combat/rules';
import { ItemType, type ItemDef } from '../src/formats/objinfo';
import type { PartyState } from '../src/game/party';

const bolt = (over: Partial<WeaponStats> = {}): WeaponStats => ({
  strengthSwing: 0,
  strengthThrust: 10,
  accuracySwing: 0,
  accuracyThrust: 10,
  condition: 100,
  race: RaceKind.None,
  ...over,
});
const fighter = (id: string, side: 'party' | 'enemy', x: number, y: number, over: Partial<Fighter> = {}): Fighter => ({
  id,
  side,
  name: id,
  monster: 0,
  pos: { x, y },
  facing: Direction.North,
  health: 20,
  maxHealth: 20,
  stamina: 10,
  maxStamina: 10,
  speed: 5,
  strength: 8,
  defense: 0,
  melee: 90,
  race: RaceKind.None,
  ...over,
});
const low = (lo: number) => lo;
const high = (_: number, hi: number) => hi;

describe('ranged rules', () => {
  it('loses accuracy with distance and scales damage by condition', () => {
    const w = { crossbow: 50, weapon: bolt() };
    const d = fighter('d', 'enemy', 0, 0);
    expect(rangedHitScore(w, d, 1)).toBe(60);
    expect(rangedHitScore(w, d, 5)).toBe(48);
    expect(rangedDamage({ ...w, weapon: bolt({ condition: 50 }) })).toBe(5);
  });
});

describe('shoot', () => {
  const shooter = () => fighter('a', 'party', 3, 1, { ranged: { crossbow: 80, weapon: bolt() } });

  it('hits at range without moving, ignoring Strength, and ends the turn', () => {
    const s = startBattle([shooter(), fighter('x', 'enemy', 3, 7, { speed: 1 })]);
    const next = shoot(s, { x: 3, y: 7 }, low)!;
    expect(next.fighters[0]!.pos).toEqual({ x: 3, y: 1 });
    expect(next.events[0]).toMatchObject({ type: 'shoot', hit: true, damage: 10, distance: 6 });
    expect(next.fighters[1]!.stamina).toBe(0);
    expect(currentFighter(next).id).toBe('x');
    expect(next.history).toHaveLength(next.events.length);
  });

  it('can miss, and refuses without a crossbow, out of range or at friends', () => {
    const s = startBattle([shooter(), fighter('x', 'enemy', 3, 7, { speed: 1 })]);
    expect(shoot(s, { x: 3, y: 7 }, high)!.events[0]).toMatchObject({ hit: false, damage: 0 });
    const unarmed = startBattle([fighter('a', 'party', 3, 1), fighter('x', 'enemy', 3, 7, { speed: 1 })]);
    expect(shoot(unarmed, { x: 3, y: 7 }, low)).toBeUndefined();
    const far = startBattle([shooter(), fighter('x', 'enemy', 3, 1 + RANGED_RANGE + 1, { speed: 1 })]);
    expect(shootTargets(far)).toHaveLength(0);
    expect(shoot(far, { x: 3, y: 10 }, low)).toBeUndefined();
    const broken = startBattle([
      { ...shooter(), ranged: { crossbow: 80, weapon: bolt({ condition: 0 }) } },
      fighter('x', 'enemy', 3, 7, { speed: 1 }),
    ]);
    expect(shootTargets(broken)).toHaveLength(0);
  });
});

describe('enemy AI', () => {
  it('shoots when it can shoot and nobody is next to it', () => {
    const s = startBattle([
      fighter('a', 'party', 3, 1, { speed: 1 }),
      fighter('x', 'enemy', 3, 8, { speed: 9, ranged: { crossbow: 90, weapon: bolt() } }),
    ]);
    expect(enemyTurn(rest(s)!, low).events[0]).toMatchObject({ type: 'shoot', attacker: 'x' });
  });

  it('strikes the weakest reachable foe rather than the nearest', () => {
    const s = startBattle([
      fighter('a', 'party', 3, 2, { speed: 1 }),
      fighter('b', 'party', 5, 3, { speed: 1, health: 5, stamina: 0 }),
      fighter('x', 'enemy', 3, 3, { speed: 9 }),
    ]);
    const e = enemyTurn(rest(s)!, low).events.find((ev) => ev.type === 'attack');
    expect(e).toMatchObject({ target: 'b' });
  });

  it('defends when badly hurt with a foe adjacent', () => {
    const s = startBattle([
      fighter('a', 'party', 3, 2, { speed: 1 }),
      fighter('x', 'enemy', 3, 3, { speed: 9, health: 4 }),
    ]);
    expect(enemyTurn(rest(s)!, low).events[0]).toMatchObject({ type: 'defend', id: 'x' });
  });

  it('slashes when adjacent with stamina to spare, otherwise thrusts', () => {
    const adj = startBattle([
      fighter('a', 'party', 3, 2, { speed: 1 }),
      fighter('x', 'enemy', 3, 3, { speed: 9, stamina: 10 }),
    ]);
    expect(enemyTurn(rest(adj)!, low).events.find((e) => e.type === 'attack')).toMatchObject({ kind: 'slash' });
    const tired = startBattle([
      fighter('a', 'party', 3, 2, { speed: 1 }),
      fighter('x', 'enemy', 3, 3, { speed: 9, stamina: 2 }),
    ]);
    expect(enemyTurn(rest(tired)!, low).events.find((e) => e.type === 'attack')).toMatchObject({ kind: 'thrust' });
  });
});

describe('rewards', () => {
  const won = () => {
    let s = startBattle([
      fighter('party0', 'party', 3, 1, { speed: 9, ranged: { crossbow: 90, weapon: bolt() } }),
      fighter('enemy1', 'enemy', 3, 2, { speed: 1, maxHealth: 20, health: 8, stamina: 0 }),
    ]);
    s = shoot(s, { x: 3, y: 2 }, low)!;
    return s;
  };

  it('tallies hits, hits taken and kills', () => {
    const s = won();
    expect(tallyBattle(s.history).get('party0')).toMatchObject({ rangedHits: 1, slain: ['enemy1'] });
    expect(tallyBattle(s.history).get('enemy1')).toMatchObject({ hitsTaken: 1 });
  });

  it('awards crossbow experience per shot landed and a purse for the kill', () => {
    const s = won();
    const r = battleRewards(s.fighters, s.history, high);
    expect(r.experience.get('party0')).toEqual({ crossbow: 2 });
    expect(r.royals).toBe(5);
    expect(r.lines.join(' ')).toContain('5 royals');
  });

  it('adds experience and royals to the party', () => {
    const skill = {
      max: 50,
      trueSkill: 50,
      current: 50,
      experience: 3,
      modifier: 0,
      selected: false,
      unseenImprovement: false,
    };
    const party = {
      gold: 7,
      characters: [{ index: 0, skills: { crossbow: skill } }],
      activeCharacters: [0],
    } as unknown as PartyState;
    const next = applyRewards(party, { experience: new Map([['party0', { crossbow: 6 }]]), royals: 5, lines: [] });
    expect(next.gold).toBe(12);
    expect(next.characters[0]!.skills.crossbow.experience).toBe(9);
  });
});

describe('wear', () => {
  const def = (type: number, over: Partial<ItemDef> = {}) =>
    ({ type, dullChance: 100, maxDullAmount: 4, ...over }) as ItemDef;
  const item = (itemIndex: number, over = {}) => ({
    itemIndex,
    conditionOrQuantity: 90,
    status: 0,
    modifiers: 0,
    activated: false,
    used: false,
    broken: false,
    repairable: false,
    equipped: true,
    poisoned: false,
    ...over,
  });
  const party = {
    gold: 0,
    activeCharacters: [0],
    characters: [
      { index: 0, inventory: { capacity: 8, items: [item(0), item(1), item(2, { conditionOrQuantity: 5 })] } },
    ],
  } as unknown as PartyState;
  const defs = [def(ItemType.Sword), def(ItemType.Armor), def(ItemType.Crossbow)];

  it('dulls the sword by half per thrust landed and the armour in full per hit taken', () => {
    const history = [
      { type: 'attack', attacker: 'party0', target: 'e', kind: 'thrust', hit: true, damage: 1, killed: false },
      { type: 'attack', attacker: 'party0', target: 'e', kind: 'thrust', hit: true, damage: 1, killed: false },
      { type: 'attack', attacker: 'e', target: 'party0', kind: 'thrust', hit: true, damage: 1, killed: false },
      { type: 'attack', attacker: 'e', target: 'party0', kind: 'thrust', hit: true, damage: 1, killed: false },
    ] as const;
    const next = applyWear(party, history, defs, high);
    const items = next.characters[0]!.inventory.items;
    // High rolls: dull amount 3 (maxDullAmount 4 - 1); a thrust halves it (1), a hit on armour is full (3).
    expect(items[0]!.conditionOrQuantity).toBe(88);
    expect(items[1]!.conditionOrQuantity).toBe(84);
    expect(items[2]!.conditionOrQuantity).toBe(5);
  });

  it('breaks a weapon dulled to nothing', () => {
    const history = Array.from({ length: 3 }, () => ({
      type: 'shoot',
      attacker: 'party0',
      target: 'e',
      hit: true,
      damage: 1,
      killed: false,
      distance: 1,
    })) as never[];
    const next = applyWear(party, history, defs, high);
    expect(next.characters[0]!.inventory.items[2]).toMatchObject({ conditionOrQuantity: 0, broken: true });
  });
});

describe('melee still works with history', () => {
  it('records attack events in history', () => {
    const s = startBattle([fighter('a', 'party', 3, 1), fighter('x', 'enemy', 3, 5, { speed: 1 })]);
    expect(attack(s, { x: 3, y: 5 }, low)!.history.some((e) => e.type === 'attack')).toBe(true);
  });
});
