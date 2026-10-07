import { describe, expect, it } from 'vitest';
import type { Character, InventoryItem } from '../formats/gam';
import type { ItemDef } from '../formats/objinfo';
import {
  CHAR_GORATH,
  CHAR_LOCKLEAR,
  CHAR_OWYN,
  GORATH_CHEST,
  ITEM_TORCH,
  LOCKLEAR_CH5_STASH,
  OWYN_CHEST,
  TORCH_COUNT,
  applyChapterHandover,
  chapterMoneyOffset,
  readChapterMoney,
  writeChapterMoney,
  type StashSource,
} from './chapterHandover';
import type { WorldContainer } from './containers';
import type { PartyState } from './party';
import type { WorldState } from './state';

const item = (itemIndex: number, extra: Partial<InventoryItem> = {}): InventoryItem => ({
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
  ...extra,
});
const def = (index: number, type: number, stackSize = 1): ItemDef =>
  ({ index, type, stackSize, defaultStackSize: stackSize }) as unknown as ItemDef;
// 1 sword, 2 armour, 3 crossbow, 4 bread, 84 torch (stack of 8)
const defs: ItemDef[] = [];
defs[1] = def(1, 0x01);
defs[2] = def(2, 0x04);
defs[3] = def(3, 0x02);
defs[4] = def(4, 0x0b);
defs[ITEM_TORCH] = def(ITEM_TORCH, 0x0c, 8);

const char = (index: number, items: InventoryItem[] = []): Character =>
  ({ index, name: `c${index}`, inventory: { capacity: 12, items } }) as unknown as Character;
const party = (gold: number, chars: Character[]): PartyState => ({
  gold,
  characters: chars,
  activeCharacters: chars.map((c) => c.index),
  partyKeys: { capacity: 4, items: [] },
});
const world = (): WorldState => ({
  chapter: 3,
  ticks: 0,
  ticksLastSlept: 0,
  bytes: new Uint8Array(0x2000),
  expiringEvents: [],
});
const chest = (
  id: string,
  at: { zone: number; x: number; y: number },
  items: WorldContainer['items'] = [],
): WorldContainer => ({
  id,
  zone: at.zone,
  x: at.x,
  y: at.y,
  model: 0,
  fromChapter: 1,
  toChapter: 9,
  capacity: 20,
  items,
  unlocked: false,
  trapSpent: false,
});
function stashes(list: WorldContainer[]): StashSource & { list: WorldContainer[] } {
  return {
    list,
    zone: (z) => list.filter((c) => c.zone === z),
    replace: (c) => {
      const i = list.findIndex((x) => x.id === c.id);
      if (i >= 0) list[i] = c;
    },
  };
}

describe('chapter money', () => {
  it('round-trips through the save bytes', () => {
    const w = writeChapterMoney(world(), 4, 123456);
    expect(readChapterMoney(w.bytes, 4)).toBe(123456);
    expect(readChapterMoney(w.bytes, 5)).toBe(0);
    expect(chapterMoneyOffset(2) - chapterMoneyOffset(1)).toBe(4);
  });
});

describe('applyChapterHandover', () => {
  it('records the purse for chapters after the first and leaves it alone in chapter 2', () => {
    const r = applyChapterHandover({ world: world(), party: party(70, [char(0)]), chapter: 2, items: defs });
    expect(readChapterMoney(r.world.bytes, 2)).toBe(70);
    expect(r.party.gold).toBe(70);
    const first = applyChapterHandover({ world: world(), party: party(70, [char(0)]), chapter: 1, items: defs });
    expect(readChapterMoney(first.world.bytes, 1)).toBe(0);
  });

  it('chapter 4 stashes Owyn and Gorath kit, hands out torches and empties the purse', () => {
    const store = stashes([chest('a', OWYN_CHEST), chest('b', GORATH_CHEST)]);
    const p = party(500, [
      char(CHAR_LOCKLEAR, [item(4)]),
      char(CHAR_GORATH, [item(1)]),
      char(CHAR_OWYN, [item(2), item(3)]),
    ]);
    const r = applyChapterHandover({ world: world(), party: p, chapter: 4, items: defs, containers: store });
    expect(store.list[0]!.items.map((i) => i.itemIndex)).toEqual([2, 3]);
    expect(store.list[1]!.items.map((i) => i.itemIndex)).toEqual([1]);
    const owyn = r.party.characters.find((c) => c.index === CHAR_OWYN)!;
    const gorath = r.party.characters.find((c) => c.index === CHAR_GORATH)!;
    expect(owyn.inventory.items).toHaveLength(1);
    expect(owyn.inventory.items[0]).toMatchObject({
      itemIndex: ITEM_TORCH,
      conditionOrQuantity: TORCH_COUNT,
      activated: false,
    });
    expect(gorath.inventory.items[0]).toMatchObject({ itemIndex: ITEM_TORCH, activated: true });
    expect(r.party.characters.find((c) => c.index === CHAR_LOCKLEAR)!.inventory.items).toHaveLength(1);
    expect(r.party.gold).toBe(0);
    expect(readChapterMoney(r.world.bytes, 4)).toBe(500);
  });

  it('chapter 5 gives Locklear the stash kit equipped and the chapter 4 purse back', () => {
    const store = stashes([
      chest('k', LOCKLEAR_CH5_STASH, [
        { itemIndex: 4, conditionOrQuantity: 3, status: 0, modifiers: 0 },
        { itemIndex: 1, conditionOrQuantity: 90, status: 0, modifiers: 0 },
        { itemIndex: 2, conditionOrQuantity: 80, status: 0, modifiers: 0 },
        { itemIndex: 3, conditionOrQuantity: 70, status: 0, modifiers: 0 },
      ]),
    ]);
    const w = writeChapterMoney(world(), 4, 250);
    const r = applyChapterHandover({
      world: w,
      party: party(5, [char(CHAR_LOCKLEAR, [item(4)])]),
      chapter: 5,
      items: defs,
      containers: store,
    });
    const locky = r.party.characters[0]!;
    expect(locky.inventory.items.map((i) => [i.itemIndex, i.equipped])).toEqual([
      [4, false],
      [1, true],
      [2, true],
      [3, true],
    ]);
    expect(r.party.gold).toBe(250);
  });

  it('chapters 6 to 8 restore the previous chapter slot', () => {
    let w = world();
    w = writeChapterMoney(w, 5, 111);
    w = writeChapterMoney(w, 6, 222);
    w = writeChapterMoney(w, 7, 333);
    for (const [ch, want] of [
      [6, 111],
      [7, 222],
      [8, 333],
    ] as const) {
      expect(applyChapterHandover({ world: w, party: party(9, [char(0)]), chapter: ch, items: defs }).party.gold).toBe(
        want,
      );
    }
    expect(applyChapterHandover({ world: w, party: party(9, [char(0)]), chapter: 9, items: defs }).party.gold).toBe(9);
  });

  it('skips the inventory swaps when no container store is given', () => {
    const p = party(40, [char(CHAR_OWYN, [item(2)])]);
    const r = applyChapterHandover({ world: world(), party: p, chapter: 4, items: defs });
    expect(r.party.characters[0]!.inventory.items.map((i) => i.itemIndex)).toEqual([2]);
    expect(r.party.gold).toBe(0);
  });
});
