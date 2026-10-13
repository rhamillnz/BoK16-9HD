import { describe, expect, it } from 'vitest';
import type { ContainerRecord } from '../src/formats/containers';
import type { InventoryItem } from '../src/formats/gam';
import {
  ContainerStore,
  TOWN_CONTAINERS,
  toContainerItem,
  toInventoryItem,
  townContainerId,
  townContainersFromRecords,
  townStashSource,
} from '../src/game/containers';

const gds = (gds: number, letter: string, extra: Partial<ContainerRecord> = {}): ContainerRecord => ({
  address: 0,
  location: { kind: 'gds', gds, letter },
  locationType: 6,
  capacity: 4,
  flags: 0,
  items: [{ itemIndex: 5, conditionOrQuantity: 1, status: 0, modifiers: 0 }],
  ...extra,
});

describe('town containers', () => {
  it('keeps plain scene containers and leaves shops and empty records out', () => {
    const list = townContainersFromRecords([
      gds(2, 'B'),
      gds(2, 'C', { shop: new Uint8Array(16) }),
      gds(70, 'A', { capacity: 0, items: [] }),
    ]);
    expect(list.map((c) => c.id)).toEqual([townContainerId(2, 'B')]);
    expect(list[0]).toMatchObject({ zone: TOWN_CONTAINERS, capacity: 4, items: [{ itemIndex: 5 }] });
  });

  it('feeds the chapter rules: plain containers from the store, shops from the shop stock, references by position', () => {
    const store = new ContainerStore((zone) =>
      zone === TOWN_CONTAINERS ? townContainersFromRecords([gds(2, 'B')]) : [],
    );
    const stock = new Map<string, InventoryItem[]>([['60C', []]]);
    const shops = {
      stock: (r: { number: number; letter: string }) => {
        const items = stock.get(`${r.number}${r.letter}`);
        return items && { capacity: 5, items };
      },
      setStock: (r: { number: number; letter: string }, items: readonly InventoryItem[]) =>
        void stock.set(`${r.number}${r.letter}`, [...items]),
    };
    const reference: ContainerRecord = {
      ...gds(0, ''),
      location: { kind: 'world', zone: 0, fromChapter: 1, toChapter: 9, model: 0, unknown: 0, x: 20, y: 1 },
      items: [{ itemIndex: 9, conditionOrQuantity: 3, status: 0, modifiers: 0 }],
    };
    const src = townStashSource(store, shops, (zone) => (zone === 0 ? [reference] : []));

    expect(src.get({ number: 2, letter: 'B' })?.items.map((i) => i.itemIndex)).toEqual([5]);
    src.set({ number: 2, letter: 'B' }, { capacity: 4, items: [toInventoryItem({ ...reference.items[0]! })] });
    expect(store.zone(TOWN_CONTAINERS)[0]!.items.map((i) => i.itemIndex)).toEqual([9]);

    const fill = src.world({ zone: 0, x: 20, y: 1 })!;
    src.set({ number: 60, letter: 'C' }, { capacity: 5, items: fill });
    expect(stock.get('60C')!.map((i) => i.itemIndex)).toEqual([9]);
    expect(src.world({ zone: 0, x: 30, y: 1 })).toBeUndefined();
  });

  it('stores the item flags in the status byte', () => {
    const item = {
      ...toInventoryItem({ itemIndex: 1, conditionOrQuantity: 1, status: 0, modifiers: 0 }),
      equipped: true,
    };
    expect(toInventoryItem(toContainerItem(item)).equipped).toBe(true);
  });
});
