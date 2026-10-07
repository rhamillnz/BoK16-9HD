import { describe, expect, it } from 'vitest';
import { SKILL_NAMES, type Character, type Skill } from '../formats/gam';
import type { ShopStats } from '../formats/gdsContainers';
import { ItemType, type ItemDef } from '../formats/objinfo';
import type { PartyState } from './party';
import type { WorldState } from './state';
import {
  CHAPEL_OF_ISHAP,
  TEMPLE_OF_SUNG,
  TEMPLE_SEEN_FLAG,
  applyBlessing,
  applyCure,
  blessPrice,
  blessedModifiers,
  canBless,
  cureCharacter,
  cureCost,
  cureQuotes,
  isBlessed,
  markTempleSeen,
  seenTemples,
  teleportBlocked,
  teleportCost,
  canTeleportAnywhere,
} from './temple';

const skill = (max: number, trueSkill: number): Skill => ({
  max,
  trueSkill,
  current: 0,
  experience: 0,
  modifier: 0,
  selected: false,
  unseenImprovement: false,
});

function character(
  index: number,
  over: Partial<Character['conditions']> = {},
  items: Character['inventory']['items'] = [],
): Character {
  const skills = Object.fromEntries(SKILL_NAMES.map((n) => [n, skill(0, 0)])) as Character['skills'];
  skills.health = skill(50, 10);
  skills.stamina = skill(40, 5);
  return {
    index,
    name: `C${index}`,
    unknownHeader: new Uint8Array(2),
    spellBytes: new Uint8Array(6),
    spells: [],
    skills,
    combatCharIndex: 0,
    unknownTrailer: new Uint8Array(6),
    conditions: { sick: 0, plagued: 0, poisoned: 0, drunk: 0, healing: 0, starving: 0, nearDeath: 0, ...over },
    affectors: [],
    inventory: { capacity: 8, items },
  };
}

const item = (itemIndex: number, modifiers = 0) => ({
  itemIndex,
  conditionOrQuantity: 100,
  status: 0,
  modifiers,
  activated: false,
  used: false,
  broken: false,
  repairable: false,
  equipped: false,
  poisoned: false,
});

const party = (gold = 1000): PartyState => ({
  gold,
  characters: [character(0, { sick: 20, nearDeath: 30 }, [item(1), item(2, 0x20), item(3)]), character(1)],
  activeCharacters: [0, 1],
  partyKeys: { capacity: 4, items: [] },
});

const world = (chapter = 1): WorldState => ({
  chapter,
  ticks: 0,
  ticksLastSlept: 0,
  bytes: new Uint8Array(0x4000),
  expiringEvents: [],
});

const ITEMS = [] as ItemDef[];
ITEMS[1] = { index: 1, name: 'Sword', type: ItemType.Sword, value: 100 } as ItemDef;
ITEMS[2] = { index: 2, name: 'Mail', type: ItemType.Armor, value: 200 } as ItemDef;
ITEMS[3] = { index: 3, name: 'Ration', type: ItemType.Ration, value: 1 } as ItemDef;

const shop = (over: Partial<ShopStats> = {}): ShopStats => ({
  templeNumber: 1,
  sellFactor: 3,
  maxDiscount: 20,
  buyFactor: 3,
  haggleDifficulty: 65,
  haggleAnnoyance: 2,
  bardingSkill: 0,
  bardingReward: 0,
  bardingMaxReward: 0,
  unknown: 0,
  innSleepUntilHour: 0,
  innCost: 0,
  repairTypes: 0,
  repairFactor: 0,
  categories: 5,
  ...over,
});

describe('cure', () => {
  it('charges per ailment, scaled by the temple factor', () => {
    // sick 20 -> 20*4+10 = 90, near death 30 -> 30*30+10 = 910; 1000 * 65% = 650
    expect(cureCost(party().characters[0]!, 65, 1)).toBe(650);
    expect(cureCost(party().characters[1]!, 65, 1)).toBe(0);
  });

  it('ignores Healing and adds missing health and stamina at the Temple of Sung', () => {
    const c = character(0, { healing: 80 });
    expect(cureCost(c, 100, 1)).toBe(0);
    expect(cureCost(c, 100, TEMPLE_OF_SUNG)).toBe(50 + 40 - (10 + 5));
  });

  it('clears conditions and raises Healing by 20; Sung also restores in full', () => {
    const plain = cureCharacter(party().characters[0]!, 1);
    expect(plain.conditions).toMatchObject({ sick: 0, nearDeath: 0, healing: 20 });
    expect(plain.skills.health.trueSkill).toBe(10);
    const sung = cureCharacter(party().characters[0]!, TEMPLE_OF_SUNG);
    expect(sung.skills.health.trueSkill).toBe(50);
    expect(sung.skills.stamina.trueSkill).toBe(40);
    expect(sung.conditions.healing).toBe(100);
  });

  it('lists the active party with prices and applies a paid cure', () => {
    expect(cureQuotes(party(), 65, 1).map((q) => q.cost)).toEqual([650, 0]);
    const r = applyCure(party(1000), 0, 65, 1);
    expect(r).toMatchObject({ ok: true, cost: 650 });
    if (r.ok) {
      expect(r.party.gold).toBe(350);
      expect(r.party.characters[0]!.conditions.sick).toBe(0);
    }
  });

  it('refuses when the party is too poor or nobody needs a cure', () => {
    expect(applyCure(party(100), 0, 65, 1)).toEqual({ ok: false, reason: 'cannotAfford' });
    expect(applyCure(party(), 1, 65, 1)).toEqual({ ok: false, reason: 'nothingToCure' });
  });
});

describe('blessing', () => {
  it('only swords and armour can be blessed', () => {
    expect(canBless(ITEMS[1]!)).toBe(true);
    expect(canBless(ITEMS[2]!)).toBe(true);
    expect(canBless(ITEMS[3]!)).toBe(false);
  });

  it('prices at ten times the fixed cost plus a percentage of the value', () => {
    expect(blessPrice(ITEMS[1]!, shop())).toBe(3 * 10 + 20);
    expect(blessPrice({ value: 0 }, shop({ sellFactor: 0 }))).toBe(1);
  });

  it("replaces an earlier blessing with the temple's level", () => {
    expect(isBlessed({ modifiers: 0x21 })).toBe(true);
    expect(blessedModifiers(0x21, shop({ buyFactor: 3 }))).toBe(0x81);
    expect(blessedModifiers(0, shop({ buyFactor: 1 }))).toBe(0x20);
    expect(blessedModifiers(0, shop({ buyFactor: 2 }))).toBe(0x40);
  });

  it('charges and marks the item', () => {
    const r = applyBlessing(party(), 0, 0, ITEMS, shop());
    expect(r).toMatchObject({ ok: true, cost: 50 });
    if (r.ok) {
      expect(r.party.gold).toBe(950);
      expect(r.party.characters[0]!.inventory.items[0]!.modifiers).toBe(0x80);
    }
    const again = applyBlessing(party(), 0, 1, ITEMS, shop());
    expect(again.ok && again.party.characters[0]!.inventory.items[1]!.modifiers).toBe(0x80);
  });

  it('refuses rations, empty slots and empty purses', () => {
    expect(applyBlessing(party(), 0, 2, ITEMS, shop())).toEqual({ ok: false, reason: 'cannotBless' });
    expect(applyBlessing(party(), 0, 9, ITEMS, shop())).toEqual({ ok: false, reason: 'noSuchItem' });
    expect(applyBlessing(party(10), 0, 0, ITEMS, shop())).toEqual({ ok: false, reason: 'cannotAfford' });
  });
});

describe('teleport network', () => {
  it('costs the long axis plus 3/8 of the short one, scaled', () => {
    // 80 + 15 = 95; (95 * 2 + 5) * 10 = 1950; (1950 + 5) / 10 = 195
    expect(teleportCost({ x: 0, y: 0 }, { x: 80, y: 40 }, 2, 5)).toBe(195);
    expect(teleportCost({ x: 80, y: 40 }, { x: 0, y: 0 }, 2, 5)).toBe(195);
  });

  it('tracks seen temples in event flags', () => {
    let w = world();
    expect(canTeleportAnywhere(w)).toBe(false);
    w = markTempleSeen(w, 3);
    expect(canTeleportAnywhere(w)).toBe(false);
    w = markTempleSeen(markTempleSeen(w, 7), 7);
    expect(seenTemples(w)).toEqual([3, 7]);
    expect(canTeleportAnywhere(w)).toBe(true);
    expect(TEMPLE_SEEN_FLAG + 3).toBe(0x1953);
  });

  it('closes the Chapel of Ishap in chapter 6 until the Pantathians event', () => {
    expect(teleportBlocked(world(6), CHAPEL_OF_ISHAP)).toBe(true);
    expect(teleportBlocked(world(5), CHAPEL_OF_ISHAP)).toBe(false);
    expect(teleportBlocked(world(6), 3)).toBe(false);
  });
});
