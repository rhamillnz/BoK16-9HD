import { describe, expect, it } from 'vitest';
import {
  ActionType,
  categoriseChoice,
  parseDDX,
  parseTarget,
  snippetForKey,
} from '../src/formats/ddx';

const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
const u32 = (v: number) => [...u16(v & 0xffff), ...u16(v >>> 16)];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

function snippet(opts: {
  style?: number;
  actor?: number;
  s2?: number;
  s3?: number;
  choices?: number[][];
  actions?: number[][];
  text?: string;
}): number[] {
  const text = ascii(opts.text ?? '');
  const choices = opts.choices ?? [];
  const actions = opts.actions ?? [];
  return [
    opts.style ?? 0,
    ...u16(opts.actor ?? 0),
    opts.s2 ?? 0,
    opts.s3 ?? 0,
    choices.length,
    actions.length,
    ...u16(text.length),
    ...choices.flat(),
    ...actions.flat(),
    ...text,
  ];
}

function build(entries: [number, number][], snippets: number[][]): Uint8Array {
  const headerLen = 2 + entries.length * 8;
  const out: number[] = [...u16(entries.length)];
  // Offsets given as snippet indexes are resolved to absolute offsets.
  const starts: number[] = [];
  let pos = headerLen;
  for (const s of snippets) {
    starts.push(pos);
    pos += s.length;
  }
  for (const [key, idx] of entries) out.push(...u32(key), ...u32(starts[idx]!));
  for (const s of snippets) out.push(...s);
  return new Uint8Array(out);
}

describe('categoriseChoice', () => {
  it('uses the first range that contains the state', () => {
    expect(categoriseChoice(0)).toBe('none');
    expect(categoriseChoice(0x50)).toBe('conversation');
    expect(categoriseChoice(0x100)).toBe('query');
    expect(categoriseChoice(0x1234)).toBe('eventFlag');
    expect(categoriseChoice(0x753d)).toBe('gameState');
    expect(categoriseChoice(0x9c41)).toBe('customState');
    expect(categoriseChoice(0xc000)).toBe('inventory');
    expect(categoriseChoice(0xcc00)).toBe('random');
    expect(categoriseChoice(0xe000)).toBe('unknown');
  });
});

describe('parseTarget', () => {
  it('distinguishes none, key and offset targets', () => {
    expect(parseTarget(0)).toEqual({ kind: 'none' });
    expect(parseTarget(0x10001234)).toEqual({ kind: 'key', key: 0x1234 });
    expect(parseTarget(0x40)).toEqual({ kind: 'offset', offset: 0x40 });
  });
});

describe('parseDDX', () => {
  it('parses index, header fields and text', () => {
    const file = build(
      [[0xabc, 0]],
      [snippet({ style: 2, actor: 0xff, s2: 3, s3: 4, text: 'Hello' })],
    );
    const dlg = parseDDX(file);
    expect(dlg.index.get(0xabc)).toBe(10);
    const s = snippetForKey(dlg, 0xabc)!;
    expect(s).toMatchObject({
      offset: 10,
      displayStyle: 2,
      actor: 0xff,
      displayStyle2: 3,
      displayStyle3: 4,
      text: 'Hello',
    });
    expect(s.choices).toHaveLength(0);
    expect(s.actions).toHaveLength(0);
  });

  it('parses choices with key and offset targets', () => {
    const second = snippet({ text: 'Bye' });
    const first = snippet({
      choices: [
        [...u16(0x0005), ...u16(0), ...u16(0), ...u32(0x10000777)],
        [...u16(0x753d), ...u16(3), ...u16(9), ...u32(0)],
      ],
      text: 'Q?',
    });
    const dlg = parseDDX(build([[1, 0]], [first, second]));
    const [c0, c1] = dlg.snippets[0]!.choices;
    expect(c0).toMatchObject({ category: 'conversation', target: { kind: 'key', key: 0x777 } });
    expect(c1).toMatchObject({ category: 'gameState', min: 3, max: 9, target: { kind: 'none' } });
    expect(dlg.snippets).toHaveLength(2);
    expect(dlg.byOffset.get(dlg.snippets[1]!.offset)!.text).toBe('Bye');
  });

  it('decodes known actions and keeps unknown ones raw', () => {
    const act = (type: number, payload: number[]) => [...u16(type), ...payload];
    const dlg = parseDDX(
      build(
        [[1, 0]],
        [
          snippet({
            actions: [
              act(ActionType.ElapseTime, [...u32(7200), 0, 0, 0, 0]),
              act(ActionType.GainCondition, [...u16(1), ...u16(2), ...u16(0xfffb), ...u16(5)]),
              act(ActionType.LoseItem, [...u16(30), ...u16(0), 0, 0, 0, 0]),
              act(ActionType.PushNextDialog, [...u32(0x10000042), 0, 0, 0, 0]),
              act(0x33, [1, 2, 3, 4, 5, 6, 7, 8]),
            ],
          }),
        ],
      ),
    );
    const a = dlg.snippets[0]!.actions;
    expect(a[0]).toMatchObject({ name: 'ElapseTime', fields: { time: 7200 } });
    expect(a[1]!.fields).toEqual({ who: 1, condition: 2, min: -5, max: 5 });
    expect(a[2]!.fields).toEqual({ item: 30, quantity: 1 });
    expect(a[3]!.fields).toEqual({ target: { kind: 'key', key: 0x42 } });
    expect(a[4]).toMatchObject({ type: 0x33, name: undefined, fields: {} });
    expect([...a[4]!.raw]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('throws on a truncated snippet', () => {
    const bytes = build([], [snippet({ text: 'abcdef' })]);
    expect(() => parseDDX(bytes.subarray(0, bytes.length - 2))).toThrow(RangeError);
  });
});
