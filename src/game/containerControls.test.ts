import { describe, expect, it } from 'vitest';
import { SKILL_NAMES, type Character, type Skill } from '../formats/gam';
import { ItemType, type ItemDef } from '../formats/objinfo';
import type { ContainerView, WordLockView } from '../ui/containerScreen';
import { ContainerStore, type WorldContainer } from './containers';
import { containerSource, containerTitle, interact, type ContainerHost } from './containerControls';
import type { PartyState } from './party';
import { getFlag, type WorldState } from './state';
import { ITEM_PICKLOCK } from './locks';
import { writeContainer } from '../formats/containers';
import { SAVE_ZONE_CONTAINERS } from '../formats/containers';

const skill = (max: number, trueSkill: number): Skill => ({
  max,
  trueSkill,
  current: 0,
  experience: 0,
  modifier: 0,
  selected: false,
  unseenImprovement: false,
});
function character(lockpick: number): Character {
  const skills = Object.fromEntries(SKILL_NAMES.map((n) => [n, skill(0, 0)])) as Character['skills'];
  skills.health = skill(50, 30);
  skills.stamina = skill(40, 10);
  skills.lockpick = skill(100, lockpick);
  return {
    index: 0,
    name: 'Owyn',
    unknownHeader: new Uint8Array(2),
    spellBytes: new Uint8Array(6),
    spells: [],
    skills,
    combatCharIndex: 0,
    unknownTrailer: new Uint8Array(6),
    conditions: { sick: 0, plagued: 0, poisoned: 0, drunk: 0, healing: 0, starving: 0, nearDeath: 0 },
    affectors: [],
    inventory: { capacity: 6, items: [] },
  };
}
const key = (itemIndex: number) => ({
  itemIndex,
  conditionOrQuantity: 1,
  status: 0,
  modifiers: 0,
  activated: false,
  used: false,
  broken: false,
  repairable: false,
  equipped: false,
  poisoned: false,
});
const def = (name: string, type: number): ItemDef =>
  ({ name, type, stackSize: 1, defaultStackSize: 1 }) as unknown as ItemDef;
const defs: ItemDef[] = [];
defs[10] = def('Sword', ItemType.Sword);
defs[61] = def('Peasant key', ItemType.Key);
defs[ITEM_PICKLOCK] = def('Lockpick', ItemType.Key);
const item = (itemIndex: number) => ({ itemIndex, conditionOrQuantity: 100, status: 0, modifiers: 0 });
const chest = (over: Partial<WorldContainer> = {}): WorldContainer => ({
  id: '1:0',
  zone: 1,
  x: 1000,
  y: 1000,
  model: 3,
  fromChapter: 1,
  toChapter: 9,
  capacity: 3,
  items: [item(10)],
  unlocked: false,
  trapSpent: false,
  ...over,
});

interface Rig {
  host: ContainerHost;
  menus: string[];
  party: () => PartyState;
  world: () => WorldState;
  store: ContainerStore;
  shown: { view?: ContainerView };
}

/** `picks` answers each menu in turn; -1 once they run out. `use` runs while the container screen is open. */
function rig(
  c: WorldContainer,
  picks: number[],
  opts: {
    lockpick?: number;
    keys?: number[];
    roll?: number[];
    riddle?: string;
    solve?: boolean;
    use?: (v: ContainerView) => void;
    at?: { x: number; y: number };
  } = {},
): Rig {
  let party: PartyState = {
    gold: 0,
    characters: [character(opts.lockpick ?? 0)],
    activeCharacters: [0],
    partyKeys: { capacity: 8, items: (opts.keys ?? []).map(key) },
  };
  let world: WorldState = {
    chapter: 1,
    ticks: 0,
    ticksLastSlept: 0,
    bytes: new Uint8Array(0x4000),
    expiringEvents: [],
  };
  const store = new ContainerStore(() => [c]);
  const menus: string[] = [];
  const rolls = [...(opts.roll ?? [])];
  const shown: Rig['shown'] = {};
  const host: ContainerHost = {
    items: defs,
    store,
    chapter: 1,
    zone: () => 1,
    position: () => opts.at ?? { x: 1000, y: 1000 },
    getParty: () => party,
    setParty: (p) => (party = p),
    getWorld: () => world,
    setWorld: (w) => (world = w),
    menu: async (text) => {
      menus.push(text);
      return picks.length ? picks.shift()! : -1;
    },
    showContainer: async (v) => {
      shown.view = v;
      opts.use?.(v);
      v.onClose();
    },
    showWordLock: async (v: WordLockView, isSolved) => {
      if (opts.solve)
        for (let i = 0; i < 6 && !isSolved(); i++)
          for (let t = 0; t < v.state().position.length; t++) {
            if (v.state().puzzle.answer[t] !== v.state().puzzle.options[v.state().position[t]!]![t]) v.onTurn(t);
          }
      return isSolved();
    },
    riddleText: () => opts.riddle,
    roll: () => rolls.shift() ?? 99,
  };
  return { host, menus, party: () => party, world: () => world, store, shown };
}

describe('interact', () => {
  it('does nothing when no container is in reach', async () => {
    const r = rig(chest(), [], { at: { x: 90000, y: 0 } });
    expect(await interact(r.host)).toBe(false);
    expect(r.shown.view).toBeUndefined();
  });

  it('opens a plain container, lets the party take things and sets its flag', async () => {
    const r = rig(chest({ setFlag: 0x50 }), [], { use: (v) => v.onTake(0) });
    expect(await interact(r.host)).toBe(true);
    expect(r.shown.view?.title).toBe('Container');
    expect(r.party().characters[0]!.inventory.items.map((i) => i.itemIndex)).toEqual([10]);
    expect(r.store.snapshot()['1:0']!.items).toEqual([]);
    expect(getFlag(r.world(), 0x50)).toBe(true);
  });

  it('takes an item and puts it back, restoring the original contents', async () => {
    const msgs: string[] = [];
    const r = rig(chest({ capacity: 1 }), [], {
      use: (v) => {
        v.onTake(0);
        v.onPut(0, 0);
        msgs.push(v.message());
        v.onPut(0, 5); // no such slot: nothing happens
        msgs.push(v.message());
      },
    });
    await interact(r.host);
    expect(msgs).toEqual(['', '']);
    expect(r.party().characters[0]!.inventory.items).toEqual([]);
    expect(r.store.snapshot()['1:0']).toBeUndefined();
  });

  it('plays the closing dialogue when the container has one', async () => {
    const played: number[] = [];
    const r = rig(chest({ dialogKey: 321 }), []);
    r.host.playDialog = async (k) => void played.push(k);
    await interact(r.host);
    expect(played).toEqual([321]);
  });

  it('opens a locked chest with the matching key and keeps the key', async () => {
    const c = chest({ lock: { flag: 0, rating: 0x32, fairyChestIndex: 0, trapDamage: 0 } });
    const r = rig(c, [0], { keys: [61] });
    await interact(r.host);
    expect(r.menus[0]).toContain('easy lock');
    expect(r.menus[0]).toContain('key that may fit');
    expect(r.menus[1]).toContain('key turns');
    expect(r.shown.view?.title).toBe('Chest');
    expect(r.store.snapshot()['1:0']!.unlocked).toBe(true);
    expect(r.party().partyKeys.items).toHaveLength(1);
  });

  it('a snapped lockpick leaves the chest shut and leaving a lock ends the visit', async () => {
    const c = chest({ lock: { flag: 0, rating: 60, fairyChestIndex: 0, trapDamage: 0 } });
    const r = rig(c, [0, 1], { keys: [ITEM_PICKLOCK], lockpick: 10, roll: [99, 0] });
    await interact(r.host);
    expect(r.menus[1]).toContain('snaps');
    expect(r.party().partyKeys.items).toHaveLength(0);
    expect(r.shown.view).toBeUndefined();
    expect(r.store.snapshot()).toEqual({});
  });

  it('a skilled pick opens the lock', async () => {
    const c = chest({ lock: { flag: 0, rating: 40, fairyChestIndex: 0, trapDamage: 0 } });
    const r = rig(c, [0], { keys: [ITEM_PICKLOCK], lockpick: 80 });
    await interact(r.host);
    expect(r.menus[1]).toContain('pick');
    expect(r.shown.view).toBeDefined();
  });

  it('a trap goes off on a failed disarm and is spent afterwards', async () => {
    const c = chest({ lock: { flag: 1, rating: 0, fairyChestIndex: 0, trapDamage: 12 } });
    const r = rig(c, [0], { lockpick: 30, roll: [90] });
    await interact(r.host);
    expect(r.menus[1]).toContain('goes off');
    expect(r.party().characters[0]!.skills.stamina.trueSkill).toBe(0);
    expect(r.party().characters[0]!.skills.health.trueSkill).toBe(28);
    expect(r.store.snapshot()['1:0']!.trapSpent).toBe(true);
    expect(r.shown.view).toBeDefined();
  });

  it('a good disarm spares the party', async () => {
    const c = chest({ lock: { flag: 1, rating: 0, fairyChestIndex: 0, trapDamage: 12 } });
    const r = rig(c, [0], { lockpick: 80, roll: [10] });
    await interact(r.host);
    expect(r.menus[1]).toContain('disarmed');
    expect(r.party().characters[0]!.skills.stamina.trueSkill).toBe(10);
  });

  it('leaving a trapped chest leaves the trap armed', async () => {
    const c = chest({ lock: { flag: 4, rating: 0, fairyChestIndex: 0, trapDamage: 12 } });
    const r = rig(c, [2]);
    await interact(r.host);
    expect(r.shown.view).toBeUndefined();
    expect(r.store.snapshot()).toEqual({});
  });

  it('solving a riddle chest opens it', async () => {
    const c = chest({ lock: { flag: 0, rating: 0, fairyChestIndex: 3, trapDamage: 0 } });
    const r = rig(c, [0], { riddle: 'OAK\n#\nASH\nELM\nOAK\n#hint', solve: true });
    await interact(r.host);
    expect(r.menus[1]).toContain('springs open');
    expect(r.shown.view).toBeDefined();
    expect(r.store.snapshot()['1:0']!.unlocked).toBe(true);
  });

  it('giving up on the riddle keeps the chest shut', async () => {
    const c = chest({ lock: { flag: 0, rating: 0, fairyChestIndex: 3, trapDamage: 0 } });
    const r = rig(c, [0], { riddle: 'OAK\n#\nASH\nELM\nOAK\n#hint', solve: false });
    await interact(r.host);
    expect(r.shown.view).toBeUndefined();
  });

  it('opens a riddle chest whose text cannot be read instead of locking the player out', async () => {
    const c = chest({ lock: { flag: 0, rating: 0, fairyChestIndex: 3, trapDamage: 0 } });
    const r = rig(c, []);
    await interact(r.host);
    expect(r.shown.view).toBeDefined();
  });
});

describe('containerSource', () => {
  const rec = (zone: number, x: number) =>
    writeContainer({
      address: 0,
      location: { kind: 'world', zone, fromChapter: 1, toChapter: 9, model: 1, unknown: 0, x, y: 0 },
      locationType: 0,
      capacity: 2,
      flags: 0,
      items: [],
    });

  it('prefers the save image and falls back to OBJFIXED.DAT for zones the image lacks', () => {
    const [offset, count] = SAVE_ZONE_CONTAINERS[1]!;
    const image = new Uint8Array(offset + count * 24);
    for (let i = 0; i < count; i++) image.set(rec(1, 100 + i), offset + i * 24);
    const fixed = Uint8Array.from([0, 0, 2, 0, ...rec(2, 7), ...rec(5, 8)]);
    const source = containerSource(image, fixed);
    expect(source(1)).toHaveLength(count);
    expect(source(1)[0]!.x).toBe(100);
    expect(source(2).map((c) => [c.id, c.x])).toEqual([['2:0', 7]]);
    expect(source(5).map((c) => c.x)).toEqual([8]);
    expect(source(9)).toEqual([]);
    expect(containerSource(undefined, undefined)(1)).toEqual([]);
  });
});

describe('containerTitle', () => {
  const plain = { lock: undefined } as WorldContainer;
  it('names bodies, gravestones and bushes from the model', () => {
    for (const m of ['dbody1', 'dbody2', 'rogebody', 'morhbody', 'wyvrnbdy', 'giantbdy'])
      expect(containerTitle(plain, m)).toBe('Body');
    expect(containerTitle(plain, 'tstone3')).toBe('Gravestone');
    expect(containerTitle(plain, 'tmbstone')).toBe('Gravestone');
    expect(containerTitle(plain, 'bush2')).toBe('Bush');
  });
  it('falls back to chest or container', () => {
    expect(containerTitle(plain, 'chest_nl')).toBe('Chest');
    expect(
      containerTitle({ lock: { flag: 0, rating: 20, fairyChestIndex: 0, trapDamage: 0 } } as WorldContainer, 'house'),
    ).toBe('Chest');
    expect(containerTitle(plain, 'rftshack')).toBe('Container');
    expect(containerTitle(plain)).toBe('Container');
  });
});
