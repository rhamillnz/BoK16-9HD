import { describe, expect, it } from 'vitest';
import { SKILL_NAMES, type Character, type Skill } from '../src/formats/gam';
import { SHOPS_OFFSET, parseShopContainers } from '../src/formats/gdsContainers';
import { HotspotAction, type Hotspot } from '../src/formats/gds';
import { ScriptedState, scriptedState } from '../src/game/dialogState';
import { createInnHost, innCostRoyals, INN_DIALOG_KEY, sleepAtInn } from '../src/game/inn';
import type { PartyState } from '../src/game/party';
import {
  ITEM_RATIONS,
  applyTimeReport,
  canHeal,
  healthPool,
  hourlyEffects,
  improveNearDeath,
  rationCount,
  rest,
} from '../src/game/rest';
import { QUERY_NO, QUERY_YES } from '../src/game/encounterRunner';
import { TICKS_PER_DAY, TICKS_PER_HOUR, setFlag, type WorldState } from '../src/game/state';
import { TownController, type DialogEnd, type TownHooks } from '../src/game/townController';

// ---- synthetic fixtures ----------------------------------------------------

const skill = (max: number, trueSkill: number): Skill => ({
  max,
  trueSkill,
  current: 0,
  experience: 0,
  modifier: 0,
  selected: false,
  unseenImprovement: false,
});

function character(index: number, health = [40, 10], stamina = [30, 5]): Character {
  const skills = Object.fromEntries(SKILL_NAMES.map((n) => [n, skill(0, 0)])) as Character['skills'];
  skills.health = skill(health[0]!, health[1]!);
  skills.stamina = skill(stamina[0]!, stamina[1]!);
  return {
    index,
    name: `C${index}`,
    unknownHeader: new Uint8Array(2),
    spellBytes: new Uint8Array(6),
    spells: [],
    skills,
    combatCharIndex: 0,
    unknownTrailer: new Uint8Array(6),
    conditions: { sick: 0, plagued: 0, poisoned: 0, drunk: 0, healing: 0, starving: 0, nearDeath: 0 },
    affectors: [],
    inventory: { capacity: 8, items: [] },
  };
}

const party = (gold = 1000): PartyState => ({
  gold,
  characters: [character(0), character(1)],
  activeCharacters: [0, 1],
  partyKeys: { capacity: 4, items: [] },
});

const world = (hour = 20): WorldState => ({
  chapter: 1,
  ticks: hour * TICKS_PER_HOUR,
  ticksLastSlept: 0,
  bytes: new Uint8Array(0x4000),
  expiringEvents: [],
});

/** One container record in the save layout; shop stats only when given. */
function containerBytes(o: {
  number: number;
  letterIndex: number;
  capacity?: number;
  flags?: number;
  shop?: number[];
}): number[] {
  const capacity = o.capacity ?? 2;
  const flags = o.flags ?? (o.shop ? 0x04 : 0);
  const out = [0, 0, 0, 0, o.number, 0, 0, 0, o.letterIndex, 0, 0, 0, 0, 0, capacity, flags];
  out.push(...new Array(capacity * 4).fill(0));
  if (flags & 0x01) out.push(1, 2, 3, 4);
  if (flags & 0x02) out.push(...new Array(6).fill(0));
  if (o.shop) out.push(...o.shop);
  if (flags & 0x08) out.push(...new Array(9).fill(0));
  if (flags & 0x10) out.push(1, 2, 3, 4);
  return out;
}

/** temple, sell, discount, buy, haggle1, haggle2, bardSkill, bardReward, bardMax, ?, sleepTil, innCost, repairTypes, repairFactor, categories(2) */
const innShop = (sleepTil: number, cost: number) => [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, sleepTil, cost, 0, 0, 0x10, 0];

function saveWith(records: number[][]): Uint8Array {
  const flat = records.flat();
  const bytes = new Uint8Array(SHOPS_OFFSET + flat.length + 4);
  bytes.set(flat, SHOPS_OFFSET);
  return bytes;
}

// ---- rest maths ------------------------------------------------------------

describe('rest maths', () => {
  it('health fills first, stamina holds the rest of the pool', () => {
    const c = hourlyEffects(character(0, [40, 39], [30, 0]), 0x85, 0x64);
    expect(c.skills.health.trueSkill).toBe(40);
    expect(c.skills.stamina.trueSkill).toBe(0);
    const d = hourlyEffects(character(0, [40, 40], [30, 0]), 0x85, 0x64);
    expect(d.skills.stamina.trueSkill).toBe(1);
  });

  it('camping stops healing at 80 percent, an inn goes to the top', () => {
    const near = character(0, [40, 40], [30, 26]); // pool 66 of 70, 80% = 56
    expect(hourlyEffects(near, 0x64, 0x50)).toEqual(near);
    expect(healthPool(hourlyEffects(near, 0x85, 0x64))).toBe(67);
    expect(canHeal(near, false)).toBe(false);
    expect(canHeal(near, true)).toBe(true);
  });

  it('doubles the heal under Healing and cures 3 Sick per resting hour', () => {
    const c = { ...character(0), conditions: { ...character(0).conditions, healing: 50, sick: 10 } };
    const next = hourlyEffects(c, 0x85, 0x64);
    // Healing fades by 3 (and heals), Sick -3 then worsens by 1 but is slowed by Healing (-3 net)
    expect(next.conditions.healing).toBe(47);
    expect(next.conditions.sick).toBe(7 + 1 - 3);
    expect(healthPool(next)).toBe(15 + 2 + 1 - 1);
  });

  it('lets poison hurt and near death inhibit healing', () => {
    const poisoned = { ...character(0), conditions: { ...character(0).conditions, poisoned: 20 } };
    expect(healthPool(hourlyEffects(poisoned, 0, 0))).toBe(15 - 3);
    const dying = { ...character(0), conditions: { ...character(0).conditions, nearDeath: 100 } };
    expect(healthPool(hourlyEffects(dying, 0x85, 0x64))).toBe(15); // ceiling is 1, pool is already above it
    expect(
      improveNearDeath({ ...character(0), conditions: { ...character(0).conditions, nearDeath: 100 } }).conditions
        .nearDeath,
    ).toBe(99);
  });

  it('eats a ration a day, or starves', () => {
    const fed = party();
    fed.characters[0] = {
      ...fed.characters[0]!,
      inventory: {
        capacity: 8,
        items: [
          {
            itemIndex: ITEM_RATIONS,
            conditionOrQuantity: 2,
            status: 0,
            modifiers: 0,
            activated: false,
            used: false,
            broken: false,
            repairable: false,
            equipped: false,
            poisoned: false,
          },
        ],
      },
    };
    const report = { consumeRations: true } as Parameters<typeof applyTimeReport>[1];
    const rule = (i: number) => (i === ITEM_RATIONS ? { stackSize: 10, defaultStackSize: 1, isKey: false } : undefined);
    const next = applyTimeReport(fed, report, rule);
    expect(rationCount(next.characters[0]!)).toBe(1);
    expect(next.characters[0]!.conditions.starving).toBe(0);
    expect(next.characters[1]!.conditions.starving).toBe(5);
  });

  it('rests in whole hours until the target hour and stamps the last sleep', () => {
    const r = rest(world(1), party(), { inInn: true, untilHour: 8 });
    expect(r.hours).toBe(7);
    expect(r.world.ticks).toBe(8 * TICKS_PER_HOUR);
    expect(r.world.ticksLastSlept).toBe(r.world.ticks);
    expect(healthPool(r.party.characters[0]!)).toBe(15 + 7);
  });

  it('sleeps a full day when it is already the target hour, and eats on crossing midnight', () => {
    const r = rest(world(8), party(), { inInn: true, untilHour: 8 });
    expect(r.hours).toBe(24);
    expect(r.world.ticks).toBe(8 * TICKS_PER_HOUR + TICKS_PER_DAY);
    expect(r.party.characters[0]!.conditions.starving).toBe(5);
  });

  it('camps until nobody can heal further', () => {
    const p = party();
    p.characters[0] = character(0, [40, 38], [30, 28]); // pool 66 of 70: above 80%
    p.characters[1] = character(1, [40, 40], [30, 5]); // pool 45: below 56
    const r = rest(world(1), p, { inInn: false, untilHealed: true });
    expect(r.hours).toBe(11);
  });

  it('cures Sick after a night longer than 13 hours', () => {
    const p = party();
    p.characters[0] = { ...p.characters[0]!, conditions: { ...p.characters[0]!.conditions, sick: 90 } };
    expect(rest(world(10), p, { inInn: true, untilHour: 10 }).party.characters[0]!.conditions.sick).toBe(0);
  });
});

// ---- inn flow ----------------------------------------------------------------

describe('inn', () => {
  it('charges sovereigns as royals, with the chapter 5 price by event flag', () => {
    expect(innCostRoyals({ innCost: 3 }, 2, world())).toBe(30);
    expect(innCostRoyals({ innCost: 3 }, 5, world())).toBe(0x48 * 10);
    expect(innCostRoyals({ innCost: 3 }, 5, setFlag(world(), 0xdb1c, true))).toBe(0xa * 10);
  });

  it('pays after the night and offers another while someone can heal', () => {
    const night = sleepAtInn(world(20), party(500), { innSleepUntilHour: 8 }, 30);
    expect(night.hours).toBe(12);
    expect(night.party.gold).toBe(470);
    expect(night.anotherNight).toBe(true);
  });

  function host(opts: { gold?: number; answers: DialogEnd[] }) {
    let w = world(20);
    let p = party(opts.gold ?? 500);
    const calls: { key: number; context: number; value: number }[] = [];
    const notes: string[] = [];
    const answers = [...opts.answers];
    const inn = createInnHost({
      stats: (ref) =>
        ref.number === 2 && ref.letter === 'C'
          ? parseShopContainers(
              saveWith([containerBytes({ number: 2, letterIndex: 3, shop: innShop(8, 3) })]),
              SHOPS_OFFSET,
              1,
            )[0]!.stats
          : undefined,
      chapter: () => 1,
      world: () => w,
      setWorld: (x) => {
        w = x;
      },
      party: () => p,
      setParty: (x) => {
        p = x;
      },
      playDialog: (key, done) => {
        calls.push({ key, context: scriptedState.context, value: scriptedState.itemValue });
        done(answers.shift() ?? { cancelled: true, endState: undefined });
      },
      notify: (m) => notes.push(m),
    });
    return {
      inn,
      calls,
      notes,
      get world() {
        return w;
      },
      get party() {
        return p;
      },
    };
  }

  it('does nothing when the offer is refused or has no inn stats', () => {
    const h = host({ answers: [{ cancelled: false, endState: undefined, choice: QUERY_NO }] });
    h.inn.enter({ number: 2, letter: 'C' });
    expect(h.calls).toEqual([{ key: INN_DIALOG_KEY, context: 0, value: 30 }]);
    expect(h.party.gold).toBe(500);
    h.inn.enter({ number: 9, letter: 'A' });
    expect(h.notes).toEqual(['This inn has no rooms.']);
  });

  it('sleeps on Yes, then offers again with the slept context until the party is healed', () => {
    const yes: DialogEnd = { cancelled: false, endState: undefined, choice: QUERY_YES };
    const h = host({ answers: [yes, yes, { cancelled: false, endState: -1 }] });
    h.inn.enter({ number: 2, letter: 'C' });
    expect(h.calls.map((c) => c.context)).toEqual([0, 1, 1]);
    expect(h.party.gold).toBeLessThan(500 - 30);
    expect(h.notes[0]).toBe('You slept for 12 hours.');
    expect(scriptedState.context).toBe(0); // reset after the dialogue
  });

  it('refuses a night the party cannot pay for', () => {
    const h = host({ gold: 10, answers: [{ cancelled: false, endState: undefined, choice: QUERY_YES }] });
    h.inn.enter({ number: 2, letter: 'C' });
    expect(h.notes).toEqual(['You cannot afford a room.']);
    expect(h.party.gold).toBe(10);
  });
});

describe('scripted dialogue state', () => {
  it('answers the inn dialogue conditions like the original', () => {
    const s = new ScriptedState();
    Object.assign(s, { context: 1, itemValue: 30, gold: 305 });
    expect(s.read(0x7530)).toBe(1);
    expect(s.read(0x7531)).toBe(30); // whole sovereigns
    expect(s.read(0x7533)).toBe(1); // money exceeds the price
    s.gold = 30;
    expect(s.read(0x7533)).toBe(0); // strictly greater, as in the original
    expect(s.read(0x753e)).toBe(30);
    expect(s.read(0x1234)).toBeUndefined();
  });
});

// ---- town controller hook -----------------------------------------------------

describe('TownController inn action', () => {
  const inn: Hotspot = {
    index: 0,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    chapterMask: 0,
    keyword: 1,
    action: HotspotAction.Inn,
    unknownD: 0,
    arg1: 0,
    arg2: 0,
    arg3: 0x10000,
    tooltip: 0,
    unknown1a: 0,
    dialog: 0,
    checkEventState: 0,
  };
  const scene = {
    ref: { number: 2, letter: 'C' },
    gds: {
      resource: 'T',
      ttm: '',
      ads: '',
      templeIndex: 0,
      song: 0,
      sceneIndex1: 0,
      sceneIndex2: 0,
      flavourText: 0,
      hotspots: [inn],
    },
    image: { width: 1, height: 1, rgba: new Uint8ClampedArray(4) },
  };
  const hooks = (extra: Partial<TownHooks>): TownHooks => ({
    load: async () => scene,
    show: () => {},
    hide: () => {},
    playDialog: () => {},
    activeHotspots: (s) => s.gds.hotspots,
    left: () => {},
    ...extra,
  });

  it('hands the scene to the inn hook', async () => {
    const seen: string[] = [];
    const c = new TownController(hooks({ inn: (ref) => seen.push(`${ref.number}${ref.letter}`) }));
    await c.enter(scene.ref);
    c.click(inn);
    expect(seen).toEqual(['2C']);
  });

  it('falls back to unsupported without the hook', async () => {
    const seen: number[] = [];
    const c = new TownController(hooks({ unsupported: (a) => seen.push(a) }));
    await c.enter(scene.ref);
    c.click(inn);
    expect(seen).toEqual([HotspotAction.Inn]);
  });
});
