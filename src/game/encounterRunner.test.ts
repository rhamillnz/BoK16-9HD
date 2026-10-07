import { describe, expect, it } from 'vitest';
import { ActionType, parseDDX } from '../formats/ddx';
import { ENCOUNTER_BLOCK_SIZE, ENCOUNTER_RECORD_SIZE, EncounterType } from '../formats/encounters';
import { GAM_OFFSETS } from '../formats/gam';
import { TILE_SIZE } from '../formats/world';
import { EncounterMap } from '../world/encounters';
import {
  DialogSession,
  DialogStore,
  EncounterRunner,
  type EncounterRunnerOptions,
  GOODBYE,
  QUERY_NO,
  QUERY_YES,
  applySetFlag,
  parseDefDialog,
  parseKeywords,
  runDialogSession,
  uniqueEncounterFlag,
} from './encounterRunner';
import { destinationAt, type ZoneTransition } from './transitions';
import { getFlag, setFlag, TICKS_PER_HOUR, type WorldState } from './state';

// ---- synthetic fixtures ----------------------------------------------------

interface SnipSpec {
  key?: number;
  text?: string;
  style3?: number;
  choices?: { state: number; min?: number; max?: number; target: number }[];
  actions?: { type: number; words?: number[]; target?: number }[];
}

const KEY = 0x10000000;
const HEADER = 9; // u8 style, u16 actor, u8, u8 style3, u8 choices, u8 actions, u16 text length

/**
 * Build a DDX. A choice or PushNextDialog `target` is the index of a snippet in `specs` (resolved to
 * its file offset), or `KEY | key` for a key target; 0 stays "none".
 */
function buildDDX(specs: SnipSpec[]): Uint8Array {
  const keyed = specs.flatMap((s, i) => (s.key === undefined ? [] : [[s.key, i] as const]));
  const sizes = specs.map((s) => HEADER + (s.choices?.length ?? 0) * 10 + (s.actions?.length ?? 0) * 10 + (s.text?.length ?? 0));
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
    const text = s.text ?? '';
    let p = offsets[i]!;
    dv.setUint16(p + 1, 0xff, true);
    dv.setUint8(p + 4, s.style3 ?? 0);
    dv.setUint8(p + 5, choices.length);
    dv.setUint8(p + 6, actions.length);
    dv.setUint16(p + 7, text.length, true);
    p += HEADER;
    for (const c of choices) {
      dv.setUint16(p, c.state, true);
      dv.setUint16(p + 2, c.min ?? 0, true);
      dv.setUint16(p + 4, c.max ?? 0xffff, true);
      dv.setUint32(p + 6, resolve(c.target) >>> 0, true);
      p += 10;
    }
    for (const a of actions) {
      dv.setUint16(p, a.type, true);
      const w = a.words ?? [];
      const target = a.target;
      if (target !== undefined) dv.setUint32(p + 2, resolve(target) >>> 0, true);
      else w.forEach((v, k) => dv.setUint16(p + 2 + k * 2, v, true));
      p += 10;
    }
    for (let k = 0; k < text.length; k++) out[p + k] = text.charCodeAt(k);
  });
  return out;
}

const store = (...files: [number, SnipSpec[]][]) => new DialogStore(new Map(files.map(([n, specs]) => [n, parseDDX(buildDDX(specs))])));

function world(chapter = 1, ticks = 0): WorldState {
  return { chapter, ticks, ticksLastSlept: 0, bytes: new Uint8Array(GAM_OFFSETS.complexEventFlags + 0x800), expiringEvents: [] };
}

const noRandom = { random: () => 0 };

describe('definition files', () => {
  it('reads DEF_DIAL keys from 9-byte records', () => {
    const bytes = new Uint8Array(4 + 2 * 9);
    const dv = new DataView(bytes.buffer);
    dv.setUint32(0, 2, true);
    dv.setUint32(4 + 3, 0x1234, true);
    dv.setUint32(4 + 9 + 3, 0xabcdef, true);
    expect(parseDefDialog(bytes)).toEqual([0x1234, 0xabcdef]);
  });

  it('clamps a count that runs past the file', () => {
    const bytes = new Uint8Array(4 + 9);
    new DataView(bytes.buffer).setUint32(0, 50, true);
    expect(parseDefDialog(bytes)).toHaveLength(1);
  });

  it('reads keyword strings through their offsets', () => {
    const bytes = new Uint8Array(0x2b8 + 16);
    const dv = new DataView(bytes.buffer);
    const strings = ['', 'Rumours', 'Yes'];
    let at = 0x2b8;
    for (let i = 0; i < (0x2b8 - 2) / 2; i++) dv.setUint16(2 + i * 2, at, true); // all point at "" first
    dv.setUint16(2 + 1 * 2, at + 1, true);
    dv.setUint16(2 + 2 * 2, at + 9, true);
    for (const str of strings) {
      for (const ch of str) bytes[at++] = ch.charCodeAt(0);
      bytes[at++] = 0;
    }
    const k = parseKeywords(bytes);
    expect(k).toHaveLength((0x2b8 - 2) / 2);
    expect(k[1]).toBe('Rumours');
    expect(k[2]).toBe('Yes');
  });
});

describe('DialogStore', () => {
  it('finds keys across files, lowest file winning duplicates', () => {
    const s = store([5, [{ key: 7, text: 'five' }]], [2, [{ key: 7, text: 'two' }, { key: 8, text: 'eight' }]]);
    expect(s.byKey(7)?.snippet.text).toBe('two');
    expect(s.byKey(8)?.file).toBe(2);
    expect(s.byKey(99)).toBeUndefined();
  });
});

describe('DialogSession', () => {
  it('shows a snippet, follows its unconditional choice, and ends', () => {
    const s = store([1, [{ key: 1, text: 'Hello', choices: [{ state: 0, target: 2 }] }, { text: 'World' }]]);
    const d = new DialogSession(s, world());
    d.start(1);
    expect(d.view?.snippet.text).toBe('Hello');
    expect(d.view?.options).toEqual([]);
    d.advance();
    expect(d.view?.snippet.text).toBe('World');
    d.advance();
    expect(d.done).toBe(true);
    expect(d.view).toBeUndefined();
  });

  it('skips snippets without text but runs their actions', () => {
    const s = store([1, [
      { key: 1, choices: [{ state: 0, target: 2 }], actions: [{ type: ActionType.SetFlag, words: [0x300, 0, 0, 1] }] },
      { text: 'After' },
    ]]);
    const d = new DialogSession(s, world());
    d.start(1);
    expect(d.view?.snippet.text).toBe('After');
    expect(getFlag(d.world, 0x300)).toBe(true);
  });

  it('picks the first choice whose event flag is set', () => {
    const s = store([1, [
      { key: 1, text: 'Fork', choices: [{ state: 0x400, min: 1, target: 2 }, { state: 0, target: 3 }] },
      { text: 'flag set' },
      { text: 'fallback' },
    ]]);
    const a = new DialogSession(s, world());
    a.start(1);
    a.advance();
    expect(a.view?.snippet.text).toBe('fallback');

    const b = new DialogSession(s, setFlag(world(), 0x400, true));
    b.start(1);
    b.advance();
    expect(b.view?.snippet.text).toBe('flag set');
  });

  it('tests the chapter and time of day through game-state choices', () => {
    const s = store([1, [
      { key: 1, text: 'Go', choices: [{ state: 0x7537, min: 2, max: 2, target: 2 }, { state: 0x7539, min: 1, target: 3 }, { state: 0, target: 4 }] },
      { text: 'chapter two' },
      { text: 'night' },
      { text: 'day' },
    ]]);
    const text = (w: WorldState) => {
      const d = new DialogSession(s, w);
      d.start(1);
      d.advance();
      return d.view?.snippet.text;
    };
    expect(text(world(2, 12 * TICKS_PER_HOUR))).toBe('chapter two');
    expect(text(world(1, 22 * TICKS_PER_HOUR))).toBe('night');
    expect(text(world(1, 12 * TICKS_PER_HOUR))).toBe('day');
  });

  it('picks a random choice for style 8 snippets', () => {
    const s = store([1, [
      { key: 1, text: 'Roll', style3: 8, choices: [{ state: 0, target: 2 }, { state: 0, target: 3 }] },
      { text: 'first' },
      { text: 'second' },
    ]]);
    const d = new DialogSession(s, world(), [], { random: () => 1 });
    d.start(1);
    d.advance();
    expect(d.view?.snippet.text).toBe('second');
  });

  it('offers query choices and follows the one picked', () => {
    const s = store([1, [
      { key: 1, text: 'Enter?', style3: 2, choices: [{ state: QUERY_YES, target: 2 }, { state: QUERY_NO, target: 3 }] },
      { text: 'in you go' },
      { text: 'stay out' },
    ]]);
    const d = new DialogSession(s, world(), []);
    d.start(1);
    expect(d.view?.mode).toBe('query');
    expect(d.view?.options.map((o) => [o.value, o.label])).toEqual([[QUERY_YES, 'Yes'], [QUERY_NO, 'No']]);
    d.choose(QUERY_NO);
    expect(d.view?.snippet.text).toBe('stay out');
    expect(d.lastChoice).toBe(QUERY_NO);
  });

  it('runs a conversation: topics follow event flags, mark clicks, and Goodbye ends', () => {
    const root = (extra: number) => ({
      key: 1,
      text: 'Ask me',
      style3: 4,
      choices: [{ state: 5, target: 2 }, { state: 6, target: 3 }],
      actions: extra ? [{ type: ActionType.SetFlag, words: [6, 0, 0, 1] }] : [],
    });
    const s = store([1, [
      root(0),
      { text: 'About five', actions: [{ type: ActionType.PushNextDialog, target: KEY | 1 }] },
      { text: 'About six' },
    ]]);
    const keywords = ['', '', '', '', '', 'Rumours', 'Quests'];
    const d = new DialogSession(s, setFlag(world(), 5, true), keywords);
    d.start(1);
    expect(d.view?.mode).toBe('conversation');
    // Topic 6 is not enabled yet; Goodbye is always last.
    expect(d.view?.options).toEqual([{ value: 5, label: 'Rumours' }, { value: GOODBYE, label: 'Goodbye' }]);
    d.choose(5);
    expect(getFlag(d.world, 0x1d4c + 5)).toBe(true);
    expect(d.view?.snippet.text).toBe('About five');
    d.advance(); // pushed root comes back
    expect(d.view?.mode).toBe('conversation');
    d.choose(GOODBYE);
    expect(d.done).toBe(true);
  });

  it('hides topics the dialogue has inhibited', () => {
    const s = store([1, [{ key: 1, text: 'Ask', style3: 4, choices: [{ state: 5, target: 0 }] }]]);
    const open = setFlag(world(), 5, true);
    const d = new DialogSession(s, setFlag(open, 0x1a2c + 5, true), ['', '', '', '', '', 'Rumours']);
    d.start(1);
    expect(d.view?.options.map((o) => o.value)).toEqual([GOODBYE]);
  });

  it('follows offset targets within the file of the snippet that holds them', () => {
    const s = store(
      [3, [{ key: 1, text: 'Start', choices: [{ state: 0, target: 2 }] }, { text: 'Same file' }]],
      [4, [{ key: 2, text: 'Other file' }]],
    );
    const d = new DialogSession(s, world());
    d.start(1);
    d.advance();
    expect(d.view?.snippet.text).toBe('Same file');
  });

  it('follows key targets into another file', () => {
    const s = store(
      [3, [{ key: 1, text: 'Start', choices: [{ state: 0, target: KEY | 2 }] }]],
      [4, [{ key: 2, text: 'Other file' }]],
    );
    const d = new DialogSession(s, world());
    d.start(1);
    d.advance();
    expect(d.view?.snippet.text).toBe('Other file');
  });

  it('applies SetFlag, records teleports, and defers actions it cannot apply', () => {
    const s = store([1, [{
      key: 1,
      text: 'Hi',
      actions: [
        { type: ActionType.SetFlag, words: [0x500, 0, 0, 1] },
        { type: ActionType.Teleport, words: [9] },
        { type: ActionType.GiveItem, words: [3, 0, 1, 0] },
      ],
    }]]);
    const d = new DialogSession(s, world());
    d.start(1);
    expect(getFlag(d.world, 0x500)).toBe(true);
    expect(d.teleport).toBe(9);
    expect(d.pendingActions.map((a) => a.name)).toEqual(['GiveItem']);
  });

  it('empties the stack on end-of-dialogue state -1', () => {
    const s = store([1, [
      { key: 1, text: 'A', choices: [{ state: 0, target: 2 }], actions: [{ type: ActionType.PushNextDialog, target: 3 }] },
      { text: 'B', actions: [{ type: ActionType.SetEndOfDialogState, words: [0xffff] }] },
      { text: 'never' },
    ]]);
    const d = new DialogSession(s, world());
    d.start(1);
    d.advance();
    expect(d.view?.snippet.text).toBe('B');
    d.advance();
    expect(d.done).toBe(true);
  });

  it('ends with a warning when a target does not resolve', () => {
    const s = store([1, [{ key: 1, text: 'A', choices: [{ state: 0, target: KEY | 99 }] }]]);
    const d = new DialogSession(s, world());
    d.start(1);
    d.advance();
    expect(d.done).toBe(true);
    expect(d.warnings).toHaveLength(1);
  });

  it('terminates when snippets loop without text', () => {
    const s = store([1, [{ key: 1, choices: [{ state: 0, target: 1 }] }]]);
    const d = new DialogSession(s, world());
    d.start(1);
    expect(d.done).toBe(true);
    expect(d.warnings).toContain('dialogue did not terminate');
  });
});

describe('applySetFlag', () => {
  const action = (words: number[]) => parseDDX(buildDDX([{ key: 1, actions: [{ type: ActionType.SetFlag, words }] }])).snippets[0]!.actions[0]!;

  it('sets and clears the pointer, plus the second and third pointers when given', () => {
    const w = applySetFlag(world(), action([0x10, 0x11, 0x12, 1]));
    expect([0x10, 0x11, 0x12].map((p) => getFlag(w, p))).toEqual([true, true, true]);
    const c = applySetFlag(w, action([0x10, 0, 0, 0]));
    expect([0x10, 0x11, 0x12].map((p) => getFlag(c, p))).toEqual([false, true, true]);
  });
});

describe('runDialogSession', () => {
  it('keeps showing until the session ends and maps picks to option values', () => {
    const s = store([1, [
      { key: 1, text: 'Q', style3: 2, choices: [{ state: QUERY_YES, target: 2 }, { state: QUERY_NO, target: 0 }] },
      { text: 'Yes!' },
    ]]);
    const d = new DialogSession(s, world());
    d.start(1);
    const shown: string[] = [];
    let ended: boolean | undefined;
    runDialogSession(d, (view, done) => {
      shown.push(view.snippet.text);
      done(view.options.length > 0 ? { kind: 'choose', index: 0 } : { kind: 'finish' });
    }, (cancelled) => (ended = cancelled));
    expect(shown).toEqual(['Q', 'Yes!']);
    expect(ended).toBe(false);
  });

  it('stops without advancing when the UI cancels', () => {
    const s = store([1, [{ key: 1, text: 'A', choices: [{ state: 0, target: 2 }] }, { text: 'B' }]]);
    const d = new DialogSession(s, world());
    d.start(1);
    const shown: string[] = [];
    let ended: boolean | undefined;
    runDialogSession(d, (view, done) => {
      shown.push(view.snippet.text);
      done({ kind: 'cancel' });
    }, (cancelled) => (ended = cancelled));
    expect(shown).toEqual(['A']);
    expect(ended).toBe(true);
  });
});

// ---- encounters ------------------------------------------------------------

interface EncSpec {
  typeId?: number;
  l: number; t: number; r: number; b: number;
  tableIndex?: number;
  chapterFlag?: number;
  required?: number;
  inhibit?: number;
  completion?: number;
  repeatable?: number;
}

function tileBytes(specs: EncSpec[]): Uint8Array {
  const out = new Uint8Array(ENCOUNTER_BLOCK_SIZE);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, specs.length, true);
  specs.forEach((e, i) => {
    const p = 2 + i * ENCOUNTER_RECORD_SIZE;
    dv.setUint16(p, e.typeId ?? EncounterType.Dialog, true);
    out.set([e.l, e.t, e.r, e.b], p + 2);
    dv.setUint16(p + 6, e.tableIndex ?? 0, true);
    out[p + 10] = e.chapterFlag ?? 0;
    dv.setUint16(p + 11, e.required ?? 0, true);
    dv.setUint16(p + 13, e.inhibit ?? 0, true);
    dv.setUint16(p + 15, e.completion ?? 0, true);
    dv.setUint16(p + 17, e.repeatable ?? 0, true);
  });
  return out;
}

const CELL = 1600;
const at = (cx: number, cy: number): [number, number] => [cx * CELL + 10, cy * CELL + 10];

function runnerFor(specs: EncSpec[], w: WorldState = world(), tileX = 0, tileY = 0, extra: Partial<EncounterRunnerOptions> = {}) {
  const map = new EncounterMap(1);
  map.addTile(tileX, tileY, tileBytes(specs));
  const s = store([1, [{ key: 100, text: 'Greetings' }, { key: 101, text: 'Blocked' }]]);
  return new EncounterRunner({
    map,
    world: w,
    zone: 1,
    tileIndex: () => 3,
    store: s,
    defDial: [100],
    defBloc: [101],
    env: noRandom,
    ...extra,
  });
}

describe('EncounterRunner', () => {
  const dialogAt = { l: 2, t: 2, r: 3, b: 2 };

  it('starts a dialogue when the party enters the rectangle, once per entry', () => {
    const r = runnerFor([dialogAt]);
    expect(r.update(...at(0, 0))).toEqual([]);
    const events = r.update(...at(2, 2));
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.type).toBe('dialog');
    if (ev.type === 'dialog') expect(ev.session.view?.snippet.text).toBe('Greetings');
    expect(r.update(...at(3, 2))).toEqual([]); // still inside the same rectangle
  });

  it('never fires an encounter whose per-chapter flag is set', () => {
    const r = runnerFor([{ ...dialogAt, chapterFlag: 1 }]);
    expect(r.update(...at(2, 2))).toHaveLength(1);
    r.update(...at(0, 0));
    expect(r.update(...at(2, 2))).toEqual([]);
    expect(getFlag(r.world, uniqueEncounterFlag(1, 3, 0))).toBe(true);
  });

  it('sets the completion flag when the dialogue starts', () => {
    const r = runnerFor([{ ...dialogAt, completion: 0x600 }]);
    r.update(...at(2, 2));
    expect(getFlag(r.world, 0x600)).toBe(true);
  });

  it('lets repeatable encounters fire on every entry and leaves no unique flag', () => {
    const r = runnerFor([{ ...dialogAt, chapterFlag: 1, repeatable: 1 }]);
    expect(r.update(...at(2, 2))).toHaveLength(1);
    r.update(...at(0, 0));
    expect(r.update(...at(2, 2))).toHaveLength(1);
    expect(getFlag(r.world, uniqueEncounterFlag(1, 3, 0))).toBe(false);
  });

  it('does not repeat a non-flagged encounter on the same tile, but does after leaving the tile', () => {
    const r = runnerFor([dialogAt]);
    expect(r.update(...at(2, 2))).toHaveLength(1);
    r.update(...at(0, 0));
    expect(r.update(...at(2, 2))).toEqual([]);
    r.update(TILE_SIZE + 10, 10); // next tile
    r.update(...at(0, 0));
    expect(r.update(...at(2, 2))).toHaveLength(1);
  });

  it('honours required and inhibit flags', () => {
    const needs = runnerFor([{ ...dialogAt, required: 0x700 }]);
    expect(needs.update(...at(2, 2))).toEqual([]);
    const ok = runnerFor([{ ...dialogAt, required: 0x700 }], setFlag(world(), 0x700, true));
    expect(ok.update(...at(2, 2))).toHaveLength(1);
    const blocked = runnerFor([{ ...dialogAt, inhibit: 0x701 }], setFlag(world(), 0x701, true));
    expect(blocked.update(...at(2, 2))).toEqual([]);
  });

  it('flags block encounters as stopping the party', () => {
    const r = runnerFor([{ ...dialogAt, typeId: EncounterType.Block }]);
    const ev = r.update(...at(2, 2))[0]!;
    expect(ev.type === 'dialog' && ev.blocks).toBe(true);
    if (ev.type === 'dialog') expect(ev.session.view?.snippet.text).toBe('Blocked');
  });

  it('reports other encounter types without changing state', () => {
    const r = runnerFor([{ ...dialogAt, typeId: EncounterType.Combat, completion: 0x600 }]);
    const ev = r.update(...at(2, 2));
    expect(ev.map((e) => e.type)).toEqual(['other']);
    expect(getFlag(r.world, 0x600)).toBe(false);
  });

  it('reports a dialog whose table index has no definition as other', () => {
    const r = runnerFor([{ ...dialogAt, tableIndex: 5 }]);
    expect(r.update(...at(2, 2)).map((e) => e.type)).toEqual(['other']);
  });

  it('keeps flags a dialogue sets once the runner takes the session over', () => {
    const map = new EncounterMap(1);
    map.addTile(0, 0, tileBytes([dialogAt]));
    const s = store([1, [{ key: 100, text: 'Hi', actions: [{ type: ActionType.SetFlag, words: [0x800, 0, 0, 1] }] }]]);
    const r = new EncounterRunner({ map, world: world(), zone: 1, tileIndex: () => 0, store: s, defDial: [100] });
    const ev = r.update(...at(2, 2))[0]!;
    if (ev.type !== 'dialog') throw new Error('expected dialog');
    r.finish(ev.session);
    expect(getFlag(r.world, 0x800)).toBe(true);
  });

  describe('zone encounters', () => {
    const transition = (dialog: number): ZoneTransition => ({ ...destinationAt(4, 3, 5, 6, 7, 0x4000), dialog });
    const zoneAt = { ...dialogAt, typeId: EncounterType.Zone };

    it('leaves at once when the transition has no dialogue', () => {
      const r = runnerFor([{ ...zoneAt, completion: 0x600 }], world(), 0, 0, { defZone: [transition(0)] });
      const ev = r.update(...at(2, 2))[0]!;
      expect(ev.type).toBe('zone');
      if (ev.type === 'zone') expect(ev.transition.zone).toBe(4);
      expect(getFlag(r.world, 0x600)).toBe(true);
    });

    it('shows the dialogue first and carries the transition on the event', () => {
      const r = runnerFor([zoneAt], world(), 0, 0, { defZone: [transition(100)] });
      const ev = r.update(...at(2, 2))[0]!;
      expect(ev.type).toBe('dialog');
      if (ev.type === 'dialog') {
        expect(ev.blocks).toBe(false);
        expect(ev.transition?.zone).toBe(4);
        expect(ev.session.view?.snippet.text).toBe('Greetings');
      }
    });

    it('reports a zone encounter without a definition as other', () => {
      const r = runnerFor([zoneAt]);
      expect(r.update(...at(2, 2)).map((e) => e.type)).toEqual(['other']);
    });

    it('does not fire the encounters the party arrives in after a transition', () => {
      const r = runnerFor([zoneAt], world(), 0, 0, { defZone: [transition(0)] });
      r.enterAt(...at(2, 2));
      expect(r.update(...at(2, 2))).toEqual([]);
      r.update(...at(0, 0));
      expect(r.update(...at(2, 2)).map((e) => e.type)).toEqual(['zone']);
    });
  });
});
