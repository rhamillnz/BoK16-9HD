import { describe, expect, it } from 'vitest';
import { ActionType, parseDDX } from '../formats/ddx';
import { SKILL_NAMES, type Character, type Skill, GAM_OFFSETS } from '../formats/gam';
import type { ChapterStart } from '../formats/world';
import {
  ENCOUNTER_FLAG_BASE,
  START_OF_CHAPTER_KEY,
  chapterFinale,
  chapterIntro,
  chapterStartTextKey,
  clearFlags,
  startOfChapterActions,
  transitionCutscenes,
  transitionRequested,
  clearTransitionRequest,
  transitionToChapter,
} from './chapters';
import { GAME_STATE_CHAPTER_TRANSITION, scriptedState } from './dialogState';
import { installChapters } from './chapterControls';
import { DialogStore, applySetFlag } from './encounterRunner';
import type { PartyState } from './party';
import { TICKS_PER_DAY, getFlag, setFlag, type WorldState } from './state';

// ---- synthetic fixtures ----------------------------------------------------

interface Spec {
  key?: number;
  choices?: { state: number; target: number }[];
  actions?: { type: number; words?: number[]; target?: number }[];
}
const KEY = 0x10000000;
const HEADER = 9;

/** Build a DDX; targets are 1-based indices into `specs` (0 = none). */
function buildDDX(specs: Spec[]): Uint8Array {
  const keyed = specs.flatMap((s, i) => (s.key === undefined ? [] : [[s.key, i] as const]));
  const sizes = specs.map((s) => HEADER + (s.choices?.length ?? 0) * 10 + (s.actions?.length ?? 0) * 10);
  const offsets: number[] = [];
  let at = 2 + 8 * keyed.length;
  for (const size of sizes) {
    offsets.push(at);
    at += size;
  }
  const out = new Uint8Array(at);
  const dv = new DataView(out.buffer);
  const resolve = (t: number) => (t === 0 ? 0 : t >= KEY ? (t - KEY) | 0xf0000000 : offsets[t - 1]!);
  dv.setUint16(0, keyed.length, true);
  keyed.forEach(([key, i], n) => {
    dv.setUint32(2 + n * 8, key, true);
    dv.setUint32(6 + n * 8, offsets[i]!, true);
  });
  specs.forEach((s, i) => {
    const choices = s.choices ?? [];
    const actions = s.actions ?? [];
    let p = offsets[i]!;
    dv.setUint16(p + 1, 0xff, true);
    dv.setUint8(p + 5, choices.length);
    dv.setUint8(p + 6, actions.length);
    p += HEADER;
    for (const c of choices) {
      dv.setUint16(p, c.state, true);
      dv.setUint16(p + 4, 0xffff, true);
      dv.setUint32(p + 6, resolve(c.target) >>> 0, true);
      p += 10;
    }
    for (const a of actions) {
      dv.setUint16(p, a.type, true);
      if (a.target !== undefined) dv.setUint32(p + 2, resolve(a.target) >>> 0, true);
      else (a.words ?? []).forEach((v, k) => dv.setUint16(p + 2 + k * 2, v, true));
      p += 10;
    }
  });
  return out;
}

const FLAG_NEW = 0x300;
const FLAG_RESET = 0x301;
const FLAG_ENCOUNTER = ENCOUNTER_FLAG_BASE + 5;
const FLAG_KEEP = 0x40;

/** Root -> reset snippet; push -> table whose choice n is chapter n's script. Chapter 2's sets FLAG_NEW and teleports to 7. */
const store = () =>
  new DialogStore(new Map([[0, parseDDX(buildDDX([
    { key: START_OF_CHAPTER_KEY, choices: [{ state: 0, target: 2 }], actions: [{ type: ActionType.PushNextDialog, target: 3 }] },
    { actions: [{ type: ActionType.SetFlag, words: [FLAG_RESET, 0, 0, 1] }] },
    { choices: [{ state: 0, target: 4 }, { state: 0, target: 5 }] },
    { actions: [] },
    { actions: [{ type: ActionType.SetFlag, words: [FLAG_NEW, 0, 0, 1] }, { type: ActionType.Teleport, words: [7, 0, 0, 0] }] },
  ])) ]]));

const skill = (max: number, trueSkill: number): Skill => ({ max, trueSkill, current: 0, experience: 0, modifier: 0, selected: false, unseenImprovement: false });
function character(index: number): Character {
  const skills = Object.fromEntries(SKILL_NAMES.map((n) => [n, skill(0, 0)])) as Character['skills'];
  skills.health = skill(50, 10);
  return {
    index, name: `C${index}`, unknownHeader: new Uint8Array(2), spellBytes: new Uint8Array(6), spells: [], skills,
    combatCharIndex: 0, unknownTrailer: new Uint8Array(6),
    conditions: { sick: 20, plagued: 0, poisoned: 0, drunk: 0, healing: 0, starving: 0, nearDeath: 30 },
    affectors: [], inventory: { capacity: 8, items: [] },
  };
}
const party = (): PartyState => ({ gold: 0, characters: [character(0), character(1)], activeCharacters: [0], partyKeys: { capacity: 4, items: [] } });
const world = (chapter = 1, ticks = 5000): WorldState => ({ chapter, ticks, ticksLastSlept: 0, bytes: new Uint8Array(GAM_OFFSETS.complexEventFlags + 0x800), expiringEvents: [] });
const start = (chapter: number): ChapterStart => ({ chapter, zone: 2, tileX: 1, tileY: 1, cellX: 0, cellY: 0, heading: 64, timeElapsed: 100, x: 64800, y: 64800 });

describe('cutscene sequence', () => {
  it('names the intro files by chapter', () => {
    expect(chapterIntro(3)).toEqual([
      { kind: 'anim', ads: 'CHAPTER3.ADS', ttm: 'CHAPTER3.TTM' },
      { kind: 'book', file: 'C31.BOK' },
      { kind: 'anim', ads: 'C31.ADS', ttm: 'C31.TTM' },
    ]);
  });
  it('skips the ending book in chapters that have none, and ends chapter 9 with C93', () => {
    expect(chapterFinale(2)).toEqual([{ kind: 'anim', ads: 'C22.ADS', ttm: 'C22.TTM' }]);
    expect(chapterFinale(1)[0]).toEqual({ kind: 'book', file: 'C12.BOK' });
    expect(chapterFinale(9).at(-1)).toEqual({ kind: 'anim', ads: 'C93.ADS', ttm: 'C93.TTM' });
    expect(chapterFinale(10)).toEqual([]);
  });
  it('joins the ending of one chapter to the intro of the next', () => {
    const list = transitionCutscenes(1);
    expect(list.at(0)).toEqual({ kind: 'book', file: 'C12.BOK' });
    expect(list.at(-1)).toEqual({ kind: 'anim', ads: 'C21.ADS', ttm: 'C21.TTM' });
  });
  it('keys the map caption by chapter', () => expect(chapterStartTextKey(3)).toBe(0x128));
});

describe('flags', () => {
  it('clears a run of flags and leaves others', () => {
    let w = setFlag(setFlag(world(), FLAG_ENCOUNTER, true), FLAG_KEEP, true);
    w = clearFlags(w, ENCOUNTER_FLAG_BASE, 100);
    expect(getFlag(w, FLAG_ENCOUNTER)).toBe(false);
    expect(getFlag(w, FLAG_KEEP)).toBe(true);
  });
  it('records the transition request instead of storing a bit', () => {
    clearTransitionRequest();
    expect(transitionRequested()).toBe(false);
    const w = applySetFlag(world(), { type: ActionType.SetFlag, name: 'SetFlag', raw: new Uint8Array(8), words: [GAME_STATE_CHAPTER_TRANSITION, 0, 0, 1], fields: {} });
    expect(w.bytes).toEqual(world().bytes);
    expect(transitionRequested()).toBe(true);
    clearTransitionRequest();
  });
});

describe('start-of-chapter script', () => {
  it('runs the reset snippet and the chapter script, and reports the teleport', () => {
    const r = startOfChapterActions(store(), world(2), 2);
    expect(r.warnings).toEqual([]);
    expect(getFlag(r.world, FLAG_RESET)).toBe(true);
    expect(getFlag(r.world, FLAG_NEW)).toBe(true);
    expect(r.teleport).toBe(7);
  });
  it('chapter 1 sets nothing beyond the reset', () => {
    const r = startOfChapterActions(store(), world(1), 1);
    expect(getFlag(r.world, FLAG_NEW)).toBe(false);
    expect(r.teleport).toBeUndefined();
  });
  it('warns when the table is missing', () => {
    const r = startOfChapterActions(new DialogStore(new Map()), world(), 2);
    expect(r.warnings).toHaveLength(1);
  });
});

describe('transitionToChapter', () => {
  const run = () => transitionToChapter({ world: setFlag(setFlag(world(1, 5000), FLAG_ENCOUNTER, true), FLAG_KEEP, true), party: party(), chapter: 2, start: start(2), store: store() });
  it('moves the clock to the next midnight plus the time change', () => {
    const r = run();
    expect(r.world.chapter).toBe(2);
    expect(r.world.ticks).toBe(TICKS_PER_DAY + 100);
    expect(r.world.ticksLastSlept).toBe(r.world.ticks);
  });
  it('forgets done encounters but keeps story flags, then applies the script', () => {
    const r = run();
    expect(getFlag(r.world, FLAG_ENCOUNTER)).toBe(false);
    expect(getFlag(r.world, FLAG_KEEP)).toBe(true);
    expect(getFlag(r.world, FLAG_NEW)).toBe(true);
    expect(r.teleport).toBe(7);
  });
  it('heals the active party and leaves the others', () => {
    const r = run();
    const [a, b] = r.party.characters;
    expect(a!.skills.health.trueSkill).toBe(50);
    expect(a!.conditions.sick).toBe(0);
    expect(b!.skills.health.trueSkill).toBe(10);
  });
});

describe('installChapters', () => {
  function host(over: Record<string, unknown> = {}) {
    const log: string[] = [];
    let w = world(1);
    let p = party();
    const h = {
      items: [],
      getParty: () => p, setParty: (x: PartyState) => { p = x; },
      getWorld: () => w, setWorld: (x: WorldState) => { w = x; },
      loadStart: (n: number) => start(n),
      loadStore: async () => store(),
      playCutscenes: async (s: readonly unknown[]) => { log.push(`cutscenes ${s.length}`); },
      showText: async (k: number) => { log.push(`text ${k.toString(16)}`); },
      arrive: async (c: ChapterStart, t: number | undefined) => { log.push(`arrive ${c.chapter} ${t}`); },
      onTransitioned: (c: number) => { log.push(`done ${c}`); },
      ...over,
    };
    return { h, log, world: () => w };
  }

  it('plays cutscenes, resets, shows the caption and arrives', async () => {
    const t = host();
    const c = installChapters(t.h);
    expect(await c.begin()).toBe(true);
    expect(t.log).toEqual(['cutscenes 5', 'done 2', 'text 127', 'arrive 2 7']);
    expect(t.world().chapter).toBe(2);
  });
  it('skips cutscenes when asked or when there is no player', async () => {
    const t = host({ playCutscenes: undefined });
    await installChapters(t.h).begin();
    expect(t.log[0]).toBe('done 2');
    const u = host();
    await installChapters(u.h).begin(3, { cutscenes: false });
    expect(u.log[0]).toBe('done 3');
  });
  it('does nothing after the last chapter or out of range', async () => {
    const t = host();
    const c = installChapters(t.h);
    expect(await c.begin(10)).toBe(false);
    expect(await c.begin(0)).toBe(false);
  });
  it('afterDialog starts the next chapter only when the flag is set, and clears it', async () => {
    const t = host();
    const c = installChapters(t.h);
    expect(await c.afterDialog()).toBe(false);
    scriptedState.chapterTransition = true;
    expect(await c.afterDialog()).toBe(true);
    expect(transitionRequested()).toBe(false);
    expect(t.world().chapter).toBe(2);
  });
  it('refuses a second transition while one runs', async () => {
    let release!: () => void;
    const t = host({ showText: () => new Promise<void>((r) => { release = r; }) });
    const c = installChapters(t.h);
    const first = c.begin();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(c.busy).toBe(true);
    expect(await c.begin()).toBe(false);
    release();
    await first;
    expect(c.busy).toBe(false);
  });
});
