import { describe, expect, it } from 'vitest';
import {
  ContainerFlag, SAVE_ZONE_CONTAINERS, isTrapped, isWordLock, parseFixedObjects, parseSaveZoneContainers, presentInChapter,
  readContainer, writeContainer, type ContainerRecord,
} from '../src/formats/containers';
import { Reader } from '../src/formats/reader';

const world = (over: Partial<ContainerRecord> = {}, loc: Partial<Extract<ContainerRecord['location'], { kind: 'world' }>> = {}): ContainerRecord => ({
  address: 0,
  location: { kind: 'world', zone: 3, fromChapter: 1, toChapter: 9, model: 7, unknown: 0, x: 1308000, y: 1002400, ...loc },
  locationType: 4, capacity: 5, flags: 0, items: [], ...over,
});

describe('container records', () => {
  it('round-trips a plain bag with free slots', () => {
    const rec = world({ items: [{ itemIndex: 30, conditionOrQuantity: 99, status: 0x40, modifiers: 1 }, { itemIndex: 54, conditionOrQuantity: 12, status: 0, modifiers: 0 }] });
    const bytes = writeContainer(rec);
    expect(bytes.length).toBe(16 + 5 * 4);
    const r = new Reader(bytes);
    expect(readContainer(r, 'world')).toEqual(rec);
    expect(r.atEnd()).toBe(true);
  });

  it('reads every optional section in the order lock, door, dialog, shop, encounter, time', () => {
    const flags = ContainerFlag.Lock | ContainerFlag.Door | ContainerFlag.Dialog | ContainerFlag.Shop | ContainerFlag.Encounter | ContainerFlag.Time;
    const shop = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
    const rec = world({
      flags,
      items: [{ itemIndex: 1, conditionOrQuantity: 2, status: 3, modifiers: 4 }],
      lock: { flag: 4, rating: 0x5a, fairyChestIndex: 0, trapDamage: 9 },
      door: 0x1234,
      dialog: { contextVar: 3, dialogOrder: 1, key: 0x19f0a1 },
      shop,
      encounter: { requireEventFlag: 0x10, setEventFlag: 0x20, hotspot: { gds: 12, letter: 'C' }, encounterCell: { x: 3, y: 4 } },
      lastAccessed: 0xdeadbeef,
    });
    const r = new Reader(writeContainer(rec));
    const back = readContainer(r, 'world');
    expect(back).toEqual(rec);
    expect(r.atEnd()).toBe(true);
  });

  it('reads shop and combat headers', () => {
    const gds: ContainerRecord = { address: 0, location: { kind: 'gds', gds: 60, letter: 'C' }, locationType: 0, capacity: 2, flags: 0, items: [] };
    expect(readContainer(new Reader(writeContainer(gds)), 'gds')).toEqual(gds);
    const combat: ContainerRecord = { address: 0, location: { kind: 'combat', combat: 11, combatant: 2 }, locationType: 7, capacity: 3, flags: 0, items: [] };
    expect(readContainer(new Reader(writeContainer(combat)), 'combat')).toEqual(combat);
  });

  it('rejects a record with more items than capacity', () => {
    const bytes = writeContainer(world({ capacity: 2, items: [{ itemIndex: 1, conditionOrQuantity: 1, status: 0, modifiers: 0 }] }));
    bytes[13] = 3; // item count
    expect(() => readContainer(new Reader(bytes), 'world')).toThrow(/capacity/);
  });

  it('classifies locks', () => {
    expect(isTrapped({ flag: 1 })).toBe(true);
    expect(isTrapped({ flag: 4 })).toBe(true);
    expect(isTrapped({ flag: 2 })).toBe(false);
    expect(isWordLock({ fairyChestIndex: 3 })).toBe(true);
    expect(isWordLock({ fairyChestIndex: 0 })).toBe(false);
  });

  it('checks the chapter range', () => {
    const c = world({}, { fromChapter: 2, toChapter: 4 });
    expect([1, 2, 4, 5].map((n) => presentInChapter(c, n))).toEqual([false, true, true, false]);
    expect(presentInChapter({ ...c, location: { kind: 'gds', gds: 1, letter: 'A' } }, 9)).toBe(true);
  });
});

describe('container files', () => {
  it('parses OBJFIXED: a skipped header, then a count and records per zone', () => {
    const a = writeContainer(world({}, { zone: 1 }));
    const b = writeContainer(world({ capacity: 1 }, { zone: 2, x: 5 }));
    const c = writeContainer(world({}, { zone: 2, x: 6 }));
    const file = Uint8Array.from([0xaa, 0xbb, 1, 0, ...a, 2, 0, ...b, ...c]);
    const list = parseFixedObjects(file);
    expect(list.map((r) => (r.location.kind === 'world' ? [r.location.zone, r.location.x] : []))).toEqual([[1, 1308000], [2, 5], [2, 6]]);
  });

  it('parses a zone block of a save image at its fixed offset', () => {
    const [offset, count] = SAVE_ZONE_CONTAINERS[1]!;
    const image = new Uint8Array(offset + count * 16 + 64);
    let pos = offset;
    for (let i = 0; i < count; i++) {
      const bytes = writeContainer(world({ capacity: 0 }, { zone: 1, x: i }));
      image.set(bytes, pos);
      pos += bytes.length;
    }
    const list = parseSaveZoneContainers(image, 1);
    expect(list).toHaveLength(count);
    expect(list[35]!.location).toMatchObject({ x: 35 });
    expect(list[0]!.address).toBe(offset);
    expect(parseSaveZoneContainers(new Uint8Array(100), 1)).toEqual([]);
    expect(parseSaveZoneContainers(image, 99)).toEqual([]);
  });
});
