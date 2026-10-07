import { describe, expect, it } from 'vitest';
import {
  ALL_SLOTS, IndexedDbSaveStore, LocalStorageSaveStore, MemorySaveStore, QUICK_SLOT, SAVE_VERSION, SaveFormatError, SaveGames,
  createSaveStore, deserializeSave, serializeSave, slotName, summarize, type SaveGameData,
} from '../src/game/saveGame';
import { setFlag } from '../src/game/state';
import { SKILL_NAMES, type Character, type Skill } from '../src/formats/gam';

const skill = (max: number, trueSkill: number): Skill => ({ max, trueSkill, current: 0, experience: 3, modifier: -2, selected: true, unseenImprovement: false });

function character(index: number, name: string): Character {
  const skills = Object.fromEntries(SKILL_NAMES.map((n) => [n, skill(50, 20)])) as Character['skills'];
  return {
    index, name, unknownHeader: new Uint8Array([1, 2]), spellBytes: new Uint8Array([0x81, 0, 0, 0, 0, 0xff]), spells: [0, 7, 40, 41],
    skills, combatCharIndex: 3, unknownTrailer: new Uint8Array([9, 8, 7, 6, 5, 4]),
    conditions: { sick: 0, plagued: 0, poisoned: 12, drunk: 0, healing: 0, starving: 0, nearDeath: 0 },
    affectors: [{ type: 1, skill: 2, skillMask: 4, adjustment: -5, startTime: 10, endTime: 99 }],
    inventory: {
      capacity: 16,
      items: [{ itemIndex: 7, conditionOrQuantity: 5, status: 0x42, modifiers: 1, activated: false, used: true, broken: false, repairable: true, equipped: true, poisoned: false }],
    },
  };
}

function game(): SaveGameData {
  const bytes = new Uint8Array(0x4000);
  bytes[100] = 0xab;
  const world = setFlag({ chapter: 2, ticks: 0xa8c0 * 3 + 500, ticksLastSlept: 77, bytes, expiringEvents: [{ type: 3, flags: 0, data: 0x1234, duration: 600 }] }, 0x2710, true);
  return {
    savedAt: Date.UTC(2026, 9, 7, 12, 30),
    zone: 2, x: 123456.5, y: 654321, heading: 200.25,
    world,
    party: {
      gold: 321,
      characters: [character(0, 'Owyn'), character(1, 'Locklear')],
      activeCharacters: [1, 0],
      partyKeys: { capacity: 8, items: [{ itemIndex: 9, conditionOrQuantity: 100, status: 0, modifiers: 0, activated: false, used: false, broken: false, repairable: false, equipped: false, poisoned: false }] },
    },
  };
}

describe('save format', () => {
  it('round-trips the whole game state, byte arrays included', () => {
    const d = game();
    const back = deserializeSave(serializeSave(d));
    expect(back).toEqual(d);
    expect(back.world.bytes).toBeInstanceOf(Uint8Array);
    expect(back.party.characters[0]!.spellBytes).toBeInstanceOf(Uint8Array);
    expect(back.world.bytes[100]).toBe(0xab);
  });

  it('writes a version and a format tag', () => {
    const doc = JSON.parse(serializeSave(game()));
    expect(doc.format).toBe('bok-save');
    expect(doc.version).toBe(SAVE_VERSION);
  });

  it('rejects garbage, foreign documents, newer versions and incomplete saves', () => {
    expect(() => deserializeSave('{nope')).toThrow(SaveFormatError);
    expect(() => deserializeSave('{"format":"other","version":1}')).toThrow(SaveFormatError);
    const newer = JSON.stringify({ ...JSON.parse(serializeSave(game())), version: SAVE_VERSION + 1 });
    expect(() => deserializeSave(newer)).toThrow(/newer/);
    expect(() => deserializeSave(JSON.stringify({ format: 'bok-save', version: 1, data: { zone: 1 } }))).toThrow(SaveFormatError);
    const badHex = serializeSave(game()).replace(/"\$u8":"[0-9a-f]{2}/, '"$u8":"zz');
    expect(() => deserializeSave(badHex)).toThrow(SaveFormatError);
  });

  it('summarises the slot in the order of the active party', () => {
    expect(summarize(game())).toEqual({ savedAt: game().savedAt, zone: 2, gameTime: 'day 3 00:16', gold: 321, members: ['Locklear', 'Owyn'] });
  });
});

describe('save storage', () => {
  it('keeps slots independent and lists them', async () => {
    const games = new SaveGames(new MemorySaveStore());
    expect(await games.load(QUICK_SLOT)).toBeUndefined();
    await games.save(QUICK_SLOT, game());
    await games.save(slotName(3), { ...game(), zone: 5 });
    expect((await games.load(QUICK_SLOT))!.zone).toBe(2);
    expect((await games.load(slotName(3)))!.zone).toBe(5);
    const list = await games.list();
    expect(list.map((s) => s.slot)).toEqual([...ALL_SLOTS]);
    expect(list.filter((s) => s.summary).map((s) => s.slot)).toEqual([QUICK_SLOT, 'slot3']);
    await games.delete(QUICK_SLOT);
    expect(await games.load(QUICK_SLOT)).toBeUndefined();
  });

  it('flags unreadable slots without failing the listing', async () => {
    const store = new MemorySaveStore();
    await store.put('slot2', 'garbage');
    const list = await new SaveGames(store).list();
    expect(list.find((s) => s.slot === 'slot2')).toEqual({ slot: 'slot2', corrupt: true });
  });

  it('round-trips through localStorage', async () => {
    const data = new Map<string, string>();
    const storage = {
      get length() { return data.size; },
      key: (i: number) => [...data.keys()][i] ?? null,
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    } as unknown as Storage;
    data.set('unrelated', 'x');
    const games = new SaveGames(new LocalStorageSaveStore(storage));
    await games.save('slot1', game());
    expect(await games.load('slot1')).toEqual(game());
    expect(await games.store.slots()).toEqual(['slot1']);
  });

  it('falls back from IndexedDB to localStorage to memory', async () => {
    const brokenIdb = { open: () => { throw new Error('denied'); } } as unknown as IDBFactory;
    const data = new Map<string, string>();
    const ls = { setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), length: 0, key: () => null, getItem: () => null } as unknown as Storage;
    expect((await createSaveStore({ indexedDB: brokenIdb, localStorage: ls })).kind).toBe('localStorage');
    const throwingLs = { setItem: () => { throw new Error('quota'); } } as unknown as Storage;
    expect((await createSaveStore({ indexedDB: brokenIdb, localStorage: throwingLs })).kind).toBe('memory');
    expect((await createSaveStore({})).kind).toBe('memory');
  });

  it('uses IndexedDB when it opens', async () => {
    // Minimal in-memory IDBFactory covering just what IndexedDbSaveStore calls.
    const rows = new Map<string, unknown>();
    const req = <T>(v: T) => {
      const r: { result: T; onsuccess?: () => void } = { result: v };
      queueMicrotask(() => r.onsuccess?.());
      return r;
    };
    const objectStore = {
      get: (k: string) => req(rows.get(k)),
      put: (v: unknown, k: string) => { rows.set(k, v); return req(k); },
      delete: (k: string) => { rows.delete(k); return req(undefined); },
      getAllKeys: () => req([...rows.keys()]),
    };
    const db = { transaction: () => ({ objectStore: () => objectStore }), createObjectStore: () => objectStore };
    const factory = {
      open: () => {
        const r: { result: typeof db; onsuccess?: () => void; onupgradeneeded?: () => void } = { result: db };
        queueMicrotask(() => { r.onupgradeneeded?.(); r.onsuccess?.(); });
        return r;
      },
    } as unknown as IDBFactory;
    const store = await createSaveStore({ indexedDB: factory });
    expect(store).toBeInstanceOf(IndexedDbSaveStore);
    const games = new SaveGames(store);
    await games.save(QUICK_SLOT, game());
    expect(await games.load(QUICK_SLOT)).toEqual(game());
    expect(await store.slots()).toEqual([QUICK_SLOT]);
  });
});
