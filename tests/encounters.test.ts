import { describe, expect, it } from 'vitest';
import {
  ENCOUNTER_BLOCK_SIZE,
  EncounterType,
  encounterAction,
  encounterChapterCount,
  parseTileEncounters,
} from '../src/formats/encounters';
import { GAM_OFFSETS as O, type GamSave, decodeTime } from '../src/formats/gam';
import { createWorldState, setFlag } from '../src/game/state';
import { EncounterMap, placeEncounter, triggeredAt } from '../src/world/encounters';

interface Rec {
  type: number;
  l: number;
  t: number;
  r: number;
  b: number;
  idx?: number;
  chapterFlag?: number;
  req?: number;
  inh?: number;
  comp?: number;
  rep?: number;
}

/** Build a tile file with the given records per chapter (1-based index into `chapters`). */
function tileFile(chapters: Rec[][]): Uint8Array {
  const out = new Uint8Array(ENCOUNTER_BLOCK_SIZE * chapters.length);
  const dv = new DataView(out.buffer);
  chapters.forEach((recs, c) => {
    let p = c * ENCOUNTER_BLOCK_SIZE;
    dv.setUint16(p, recs.length, true);
    p += 2;
    for (const e of recs) {
      dv.setUint16(p, e.type, true);
      out.set([e.l, e.t, e.r, e.b], p + 2);
      dv.setUint16(p + 6, e.idx ?? 0, true);
      out[p + 8] = 0xaa;
      out[p + 9] = 0xbb;
      out[p + 10] = e.chapterFlag ?? 0;
      dv.setUint16(p + 11, e.req ?? 0, true);
      dv.setUint16(p + 13, e.inh ?? 0, true);
      dv.setUint16(p + 15, e.comp ?? 0, true);
      dv.setUint16(p + 17, e.rep ?? 0, true);
      p += 19;
    }
  });
  return out;
}

function world() {
  const save = {
    chapter: 1,
    time: decodeTime(0),
    timeLastSlept: decodeTime(0),
    bytes: new Uint8Array(O.complexEventFlags + 0x400),
    expiringEvents: [],
  } as unknown as GamSave;
  return createWorldState(save);
}

describe('parseTileEncounters', () => {
  const file = tileFile([
    [
      {
        type: EncounterType.Combat,
        l: 1,
        t: 4,
        r: 3,
        b: 2,
        idx: 7,
        chapterFlag: 1,
        req: 0x20,
        inh: 0x30,
        comp: 0x40,
        rep: 1,
      },
    ],
    [
      { type: EncounterType.Dialog, l: 0, t: 0, r: 0, b: 0, idx: 9 },
      { type: 99, l: 5, t: 5, r: 5, b: 5 },
    ],
  ]);

  it('reads every field of a record', () => {
    const [e] = parseTileEncounters(file, 1);
    expect(e).toMatchObject({
      index: 0,
      typeId: 1,
      left: 1,
      top: 4,
      right: 3,
      bottom: 2,
      tableIndex: 7,
      unknown0: 0xaa,
      unknown1: 0xbb,
      chapterFlag: 1,
      requiredState: 0x20,
      inhibitState: 0x30,
      completionState: 0x40,
      repeatable: 1,
    });
    expect(e!.action).toEqual({ kind: 'combat', tableIndex: 7 });
  });

  it('selects the chapter block by offset', () => {
    const recs = parseTileEncounters(file, 2);
    expect(recs.map((r) => r.action.kind)).toEqual(['dialog', 'unknown']);
    expect(recs[1]!.action).toEqual({ kind: 'unknown', typeId: 99, tableIndex: 0 });
    expect(encounterChapterCount(file)).toBe(2);
  });

  it('maps every known type id to a kind', () => {
    const kinds = Array.from({ length: 12 }, (_, i) => encounterAction(i, 0).kind);
    expect(kinds).toEqual([
      'background',
      'combat',
      'comment',
      'dialog',
      'health',
      'sound',
      'town',
      'trap',
      'zone',
      'disable',
      'enable',
      'block',
    ]);
  });

  it('throws on a truncated block', () => {
    expect(() => parseTileEncounters(file.slice(0, 10), 1)).toThrow(RangeError);
  });
});

describe('trigger rectangles', () => {
  it('covers whole cells, inclusive of right and top, in world units', () => {
    const rec = parseTileEncounters(tileFile([[{ type: 3, l: 1, t: 4, r: 3, b: 2 }]]), 1)[0]!;
    const p = placeEncounter(rec, 2, 1);
    expect([p.minX, p.maxX]).toEqual([128000 + 1600, 128000 + 4 * 1600]);
    expect([p.minY, p.maxY]).toEqual([64000 + 2 * 1600, 64000 + 5 * 1600]);
  });

  const map = new EncounterMap(1);
  map.addTile(
    1,
    0,
    tileFile([
      [
        { type: EncounterType.Dialog, l: 10, t: 10, r: 10, b: 10, idx: 1 },
        { type: EncounterType.Combat, l: 10, t: 12, r: 11, b: 10, idx: 2 },
      ],
    ]),
  );
  const cell = (cx: number, cy: number) => [64000 + cx * 1600 + 800, cy * 1600 + 800] as const;

  it('finds encounters by position and tile', () => {
    expect(map.at(...cell(10, 10)).map((e) => e.record.index)).toEqual([0, 1]);
    expect(map.at(...cell(11, 12)).map((e) => e.record.index)).toEqual([1]);
    expect(map.at(...cell(12, 10))).toEqual([]);
    expect(map.at(800, 800)).toEqual([]);
    expect(map.at(-5, -5)).toEqual([]);
  });

  it('has exclusive upper edges between cells', () => {
    expect(map.at(64000 + 11 * 1600, 10 * 1600 + 10).map((e) => e.record.index)).toEqual([1]);
  });
});

describe('triggeredAt', () => {
  const map = new EncounterMap(1);
  map.addTile(
    0,
    0,
    tileFile([
      [
        { type: 3, l: 0, t: 0, r: 0, b: 0, req: 0x20 },
        { type: 3, l: 0, t: 0, r: 0, b: 0, inh: 0x21 },
        { type: 3, l: 0, t: 0, r: 0, b: 0 },
      ],
    ]),
  );
  const idx = (s: ReturnType<typeof world>) => triggeredAt(map, s, 100, 100).map((e) => e.record.index);

  it('honours required and inhibit flags', () => {
    const s0 = world();
    expect(idx(s0)).toEqual([1, 2]);
    const s1 = setFlag(s0, 0x20, true);
    expect(idx(s1)).toEqual([0, 1, 2]);
    expect(idx(setFlag(s1, 0x21, true))).toEqual([0, 2]);
  });

  it('lets the caller suppress already-seen encounters', () => {
    const s = setFlag(world(), 0x20, true);
    const seen = (e: { record: { index: number } }) => e.record.index === 2;
    expect(triggeredAt(map, s, 100, 100, seen).map((e) => e.record.index)).toEqual([0, 1]);
  });
});
