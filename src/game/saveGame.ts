import type { PartyState } from './party';
import type { ShopSave } from './shopControls';
import { formatTime, type WorldState } from './state';

/**
 * Save games: the whole mutable game state (world clock and event flags, party and inventories,
 * position, heading and zone) as a versioned JSON document, plus slot storage in the browser
 * (IndexedDB, falling back to localStorage). The format and the storage are pure of the game
 * loop, so round-trips are tested without a browser.
 */

export const SAVE_FORMAT = 'bok-save';
/** Bump when the layout changes and add a step to `MIGRATIONS`. */
export const SAVE_VERSION = 1;

export interface SaveGameData {
  /** Wall-clock time of the save, ms since the epoch. */
  savedAt: number;
  zone: number;
  /** BaK units. */
  x: number;
  y: number;
  /** Float heading in [0, 256). */
  heading: number;
  world: WorldState;
  party: PartyState;
  /** Shop stock changes (sold items); absent in saves from before shops. */
  shops?: ShopSave;
}

/** One-line description shown in the slot list. */
export interface SaveSummary {
  savedAt: number;
  zone: number;
  gameTime: string;
  gold: number;
  members: string[];
}

export function summarize(d: SaveGameData): SaveSummary {
  const members = d.party.activeCharacters.flatMap((i) => d.party.characters.filter((c) => c.index === i).map((c) => c.name));
  return { savedAt: d.savedAt, zone: d.zone, gameTime: formatTime(d.world.ticks), gold: d.party.gold, members };
}

// ---- Serialisation ---------------------------------------------------------

const toHex = (b: Uint8Array): string => Array.from(b, (v) => v.toString(16).padStart(2, '0')).join('');

function fromHex(s: string): Uint8Array {
  if (s.length % 2 !== 0 || /[^0-9a-f]/i.test(s)) throw new Error('corrupt save: bad byte string');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** JSON has no byte arrays: they are written as `{"$u8": "<hex>"}` and revived on load. */
function replacer(_key: string, value: unknown): unknown {
  return value instanceof Uint8Array ? { $u8: toHex(value) } : value;
}

function reviver(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && '$u8' in value && typeof (value as { $u8: unknown }).$u8 === 'string') {
    return fromHex((value as { $u8: string }).$u8);
  }
  return value;
}

export function serializeSave(d: SaveGameData): string {
  return JSON.stringify({ format: SAVE_FORMAT, version: SAVE_VERSION, data: d }, replacer);
}

/** Upgrades a document from `version` to `version + 1`. None exist yet. */
const MIGRATIONS: Record<number, (data: unknown) => unknown> = {};

export class SaveFormatError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function validate(d: unknown): SaveGameData {
  if (!isObj(d)) throw new SaveFormatError('save has no data');
  const { world, party } = d;
  if (typeof d.zone !== 'number' || typeof d.x !== 'number' || typeof d.y !== 'number' || typeof d.heading !== 'number') {
    throw new SaveFormatError('save is missing its position');
  }
  if (!isObj(world) || !(world.bytes instanceof Uint8Array) || typeof world.ticks !== 'number' || !Array.isArray(world.expiringEvents)) {
    throw new SaveFormatError('save is missing the world state');
  }
  if (!isObj(party) || typeof party.gold !== 'number' || !Array.isArray(party.characters) || !Array.isArray(party.activeCharacters) || !isObj(party.partyKeys)) {
    throw new SaveFormatError('save is missing the party');
  }
  return d as unknown as SaveGameData;
}

export function deserializeSave(text: string): SaveGameData {
  let doc: unknown;
  try {
    doc = JSON.parse(text, reviver);
  } catch (e) {
    throw new SaveFormatError(`save is not readable: ${(e as Error).message}`);
  }
  if (!isObj(doc) || doc.format !== SAVE_FORMAT || typeof doc.version !== 'number') throw new SaveFormatError('not a save file');
  let version = doc.version;
  if (version > SAVE_VERSION) throw new SaveFormatError(`save is from a newer version (${version})`);
  let data = doc.data;
  while (version < SAVE_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) throw new SaveFormatError(`no migration from save version ${version}`);
    data = step(data);
    version++;
  }
  return validate(data);
}

// ---- Storage ---------------------------------------------------------------

/** Quick-save slot plus numbered slots shown on the save screen. */
export const QUICK_SLOT = 'quick';
export const NUMBERED_SLOTS = 8;
export const slotName = (n: number): string => `slot${n}`;
export const ALL_SLOTS: readonly string[] = [QUICK_SLOT, ...Array.from({ length: NUMBERED_SLOTS }, (_, i) => slotName(i + 1))];

/** Raw key-value storage for serialised saves. */
export interface SaveStore {
  readonly kind: string;
  get(slot: string): Promise<string | undefined>;
  put(slot: string, text: string): Promise<void>;
  remove(slot: string): Promise<void>;
  slots(): Promise<string[]>;
}

export class MemorySaveStore implements SaveStore {
  readonly kind = 'memory';
  private readonly map = new Map<string, string>();
  async get(slot: string) { return this.map.get(slot); }
  async put(slot: string, text: string) { this.map.set(slot, text); }
  async remove(slot: string) { this.map.delete(slot); }
  async slots() { return [...this.map.keys()]; }
}

const LS_PREFIX = 'bok.save.';

export class LocalStorageSaveStore implements SaveStore {
  readonly kind = 'localStorage';
  constructor(private readonly storage: Storage) {}
  async get(slot: string) { return this.storage.getItem(LS_PREFIX + slot) ?? undefined; }
  async put(slot: string, text: string) { this.storage.setItem(LS_PREFIX + slot, text); }
  async remove(slot: string) { this.storage.removeItem(LS_PREFIX + slot); }
  async slots() {
    const out: string[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const k = this.storage.key(i);
      if (k?.startsWith(LS_PREFIX)) out.push(k.slice(LS_PREFIX.length));
    }
    return out;
  }
}

const IDB_NAME = 'bok-saves';
const IDB_STORE = 'saves';

const request = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });

export class IndexedDbSaveStore implements SaveStore {
  readonly kind = 'indexedDB';
  private constructor(private readonly db: IDBDatabase) {}

  static open(factory: IDBFactory): Promise<IndexedDbSaveStore> {
    return new Promise((resolve, reject) => {
      const req = factory.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(new IndexedDbSaveStore(req.result));
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB open blocked'));
    });
  }

  private store(mode: IDBTransactionMode): IDBObjectStore {
    return this.db.transaction(IDB_STORE, mode).objectStore(IDB_STORE);
  }
  async get(slot: string) {
    const v = await request(this.store('readonly').get(slot));
    return typeof v === 'string' ? v : undefined;
  }
  async put(slot: string, text: string) { await request(this.store('readwrite').put(text, slot)); }
  async remove(slot: string) { await request(this.store('readwrite').delete(slot)); }
  async slots() { return (await request(this.store('readonly').getAllKeys())).map(String); }
}

/** IndexedDB when it opens, else localStorage, else memory (saves then last until the page closes). */
export async function createSaveStore(env: { indexedDB?: IDBFactory; localStorage?: Storage } = globalThis): Promise<SaveStore> {
  try {
    if (env.indexedDB) return await IndexedDbSaveStore.open(env.indexedDB);
  } catch (err) {
    console.warn('IndexedDB unavailable, falling back to localStorage:', err);
  }
  try {
    if (env.localStorage) {
      const probe = `${LS_PREFIX}probe`;
      env.localStorage.setItem(probe, '1');
      env.localStorage.removeItem(probe);
      return new LocalStorageSaveStore(env.localStorage);
    }
  } catch (err) {
    console.warn('localStorage unavailable, saves will not persist:', err);
  }
  return new MemorySaveStore();
}

// ---- Slots -----------------------------------------------------------------

export interface SlotInfo {
  slot: string;
  /** Undefined when the slot is empty. */
  summary?: SaveSummary;
  /** The slot holds something that could not be read. */
  corrupt?: boolean;
}

/** Saves and loads whole games by slot name. */
export class SaveGames {
  constructor(readonly store: SaveStore) {}

  async save(slot: string, data: SaveGameData): Promise<void> {
    await this.store.put(slot, serializeSave(data));
  }

  /** Undefined for an empty slot; throws `SaveFormatError` for an unreadable one. */
  async load(slot: string): Promise<SaveGameData | undefined> {
    const text = await this.store.get(slot);
    return text === undefined ? undefined : deserializeSave(text);
  }

  delete(slot: string): Promise<void> {
    return this.store.remove(slot);
  }

  /** The quick slot followed by the numbered ones, each with its summary. */
  async list(): Promise<SlotInfo[]> {
    return Promise.all(ALL_SLOTS.map(async (slot): Promise<SlotInfo> => {
      try {
        const d = await this.load(slot);
        return d ? { slot, summary: summarize(d) } : { slot };
      } catch {
        return { slot, corrupt: true };
      }
    }));
  }
}
