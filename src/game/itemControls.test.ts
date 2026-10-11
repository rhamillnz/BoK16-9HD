import { describe, expect, it, vi } from 'vitest';
import { SKILL_NAMES, type Character, type InventoryItem, type Skill } from '../formats/gam';
import { ItemType, type ItemDef } from '../formats/objinfo';
import type { ItemHandler } from '../ui/hudRegistry';
import { installItemControls } from './itemControls';
import type { PartyState } from './party';

vi.mock('../audio/sfxBus', () => ({ playSfx: vi.fn() }));

const skill = (max: number, trueSkill: number): Skill => ({
  max,
  trueSkill,
  current: 0,
  experience: 0,
  modifier: 0,
  selected: false,
  unseenImprovement: false,
});
const item = (itemIndex: number): InventoryItem => ({
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
});
function character(index: number, items: InventoryItem[]): Character {
  const skills = Object.fromEntries(SKILL_NAMES.map((n) => [n, skill(0, 0)])) as Character['skills'];
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
    inventory: { capacity: 4, items },
  };
}
const dagger = { index: 0, name: 'Dagger', type: ItemType.Sword, stackSize: 1, defaultStackSize: 1 } as ItemDef;

function setup() {
  let party = {
    gold: 0,
    characters: [character(0, [item(0)]), character(1, []), character(2, [])],
    activeCharacters: [0, 1, 2],
    partyKeys: { capacity: 8, items: [] },
  } as unknown as PartyState;
  let handler: ItemHandler | undefined;
  installItemControls({
    items: [dagger],
    getParty: () => party,
    setParty: (p) => {
      party = p;
    },
    setItemHandler: (h) => {
      handler = h;
    },
  });
  return { handler: () => handler!, party: () => party };
}

describe('give', () => {
  it('needs an explicit recipient and changes nothing without one', () => {
    const s = setup();
    const before = s.party();
    expect(s.handler().act('give', 0, 0)).toMatch(/who should receive/i);
    expect(s.party()).toBe(before);
  });
  it('hands the item to exactly the chosen member', () => {
    const s = setup();
    expect(s.handler().act('give', 0, 0, 2)).toBe('Dagger given to C2.');
    const by = (i: number) => s.party().characters.find((c) => c.index === i)!;
    expect(by(0).inventory.items).toHaveLength(0);
    expect(by(1).inventory.items).toHaveLength(0);
    expect(by(2).inventory.items.map((x) => x.itemIndex)).toEqual([0]);
  });
});
