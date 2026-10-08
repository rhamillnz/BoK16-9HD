import { Reader } from './reader';

/**
 * Dialogue files (DIAL_Zxx.DDX). See docs/formats/dialogue.md.
 * Layout: u16 count, count x (u32 key, u32 offset) index, then snippets back to back until EOF.
 */

export const DDX_CHOICE_SIZE = 10;
export const DDX_ACTION_SIZE = 10;
export const DDX_HEADER_SIZE = 8;
/** Choice targets with any of these bits set are dialogue keys, not file offsets. */
export const DDX_KEY_TARGET_MASK = 0xf0000000;

export type DialogTarget = { kind: 'none' } | { kind: 'key'; key: number } | { kind: 'offset'; offset: number };

/** What a choice's `state` word tests. Categories are the first range (<= bound) that contains it. */
export type ChoiceCategory =
  | 'none'
  | 'conversation'
  | 'query'
  | 'eventFlag'
  | 'gameState'
  | 'customState'
  | 'inventory'
  | 'haveNote'
  | 'castSpell'
  | 'random'
  | 'complexEvent'
  | 'unknown';

const CHOICE_BOUNDS: [number, ChoiceCategory][] = [
  [0x0000, 'none'],
  [0x00ab, 'conversation'],
  [0x01ff, 'query'],
  [0x1fff, 'eventFlag'],
  [0x75ff, 'gameState'],
  [0x9cff, 'customState'],
  [0xc3ff, 'inventory'],
  [0xc7ff, 'haveNote'],
  [0xcbff, 'castSpell'],
  [0xcfff, 'random'],
  [0xdfff, 'complexEvent'],
];

export function categoriseChoice(state: number): ChoiceCategory {
  for (const [bound, category] of CHOICE_BOUNDS) {
    if (state <= bound) return category;
  }
  return 'unknown';
}

export interface DialogChoice {
  /** Raw condition/keyword word; see categoriseChoice. */
  state: number;
  category: ChoiceCategory;
  /** Range operands (meaning depends on category, e.g. min/max of a tested value). */
  min: number;
  max: number;
  target: DialogTarget;
}

export const ActionType = {
  SetTextVariable: 0x01,
  GiveItem: 0x02,
  LoseItem: 0x03,
  SetFlag: 0x04,
  LoadActor: 0x05,
  SetPopupDimensions: 0x06,
  SpecialAction: 0x07,
  GainCondition: 0x08,
  GainSkill: 0x09,
  LoadSkillValue: 0x0a,
  PlaySound: 0x0c,
  ElapseTime: 0x0d,
  SetAddResetState: 0x0e,
  FreeMemory: 0x0f,
  PushNextDialog: 0x10,
  UpdateCharacters: 0x11,
  HealCharacters: 0x12,
  LearnSpell: 0x13,
  Teleport: 0x14,
  SetEndOfDialogState: 0x15,
  SetTimeExpiringState: 0x16,
  LoseNOfItem: 0x17,
} as const;

export interface DialogAction {
  /** Raw action code (see ActionType; unknown codes are kept). */
  type: number;
  /** Name from ActionType, or undefined for unknown codes. */
  name: string | undefined;
  /** The 8 payload bytes, always present. */
  raw: Uint8Array;
  /** The payload as four u16 LE words, for the common layout. */
  words: [number, number, number, number];
  /** Decoded fields for well-understood actions; empty otherwise. */
  fields: Record<string, number | number[] | DialogTarget>;
}

export interface DialogSnippet {
  /** Byte offset of the snippet header within the file. */
  offset: number;
  /** Where text is displayed (see docs). */
  displayStyle: number;
  /** Speaking actor id; 0xff is the party leader. */
  actor: number;
  displayStyle2: number;
  displayStyle3: number;
  choices: DialogChoice[];
  actions: DialogAction[];
  text: string;
}

export interface DialogFile {
  /** Dialogue key -> snippet offset (the file's index). */
  index: Map<number, number>;
  snippets: DialogSnippet[];
  /** Snippet by file offset. */
  byOffset: Map<number, DialogSnippet>;
}

const ACTION_NAMES = new Map<number, string>(Object.entries(ActionType).map(([name, code]) => [code, name]));

export function parseTarget(raw: number): DialogTarget {
  if (raw === 0) return { kind: 'none' };
  if ((raw & DDX_KEY_TARGET_MASK) !== 0) {
    return { kind: 'key', key: (raw & ~DDX_KEY_TARGET_MASK) >>> 0 };
  }
  return { kind: 'offset', offset: raw };
}

function decodeFields(type: number, w: number[], raw: Uint8Array): DialogAction['fields'] {
  const u32 = (lo: number, hi: number) => ((w[hi]! << 16) | w[lo]!) >>> 0;
  const s16 = (v: number) => (v << 16) >> 16;
  switch (type) {
    case ActionType.SetTextVariable:
      return { which: w[0]!, what: w[1]! };
    case ActionType.GiveItem:
      return { item: raw[0]!, character: raw[1]!, quantity: w[1]! };
    case ActionType.LoseItem:
    case ActionType.LoseNOfItem:
      return { item: w[0]!, quantity: w[1] === 0 ? 1 : w[1]! };
    case ActionType.SetFlag:
      return { eventPointer: w[0]!, mask: raw[2]!, data: raw[3]!, value: w[3]! };
    case ActionType.SetPopupDimensions:
      return { x: w[0]!, y: w[1]!, width: w[2]!, height: w[3]! };
    case ActionType.SpecialAction:
      return { special: w[0]!, var1: w[1]!, var2: w[2]!, var3: w[3]! };
    case ActionType.GainCondition:
      return { who: w[0]!, condition: w[1]!, min: s16(w[2]!), max: s16(w[3]!) };
    case ActionType.GainSkill:
      return { flag: w[0]!, skill: w[1]!, min: s16(w[2]!), max: s16(w[3]!) };
    case ActionType.PlaySound:
      return { sound: w[0]!, flag: w[1]! };
    case ActionType.ElapseTime:
      return { time: u32(0, 1) };
    case ActionType.PushNextDialog:
      return { target: parseTarget(u32(0, 1)) };
    case ActionType.UpdateCharacters:
      return { characters: w.slice(1, 1 + Math.min(w[0]!, 3)) };
    case ActionType.HealCharacters:
      return { who: w[0]!, amount: w[1]! };
    case ActionType.LearnSpell:
      return { who: w[0]!, spell: w[1]! };
    case ActionType.Teleport:
      return { teleportIndex: w[0]! };
    case ActionType.SetEndOfDialogState:
      return { state: s16(w[0]!) };
    default:
      return {};
  }
}

function readSnippet(r: Reader): DialogSnippet {
  const offset = r.pos;
  const displayStyle = r.u8();
  const actor = r.u16();
  const displayStyle2 = r.u8();
  const displayStyle3 = r.u8();
  const choiceCount = r.u8();
  const actionCount = r.u8();
  const length = r.u16();

  const choices: DialogChoice[] = [];
  for (let i = 0; i < choiceCount; i++) {
    const state = r.u16();
    const min = r.u16();
    const max = r.u16();
    choices.push({ state, category: categoriseChoice(state), min, max, target: parseTarget(r.u32()) });
  }

  const actions: DialogAction[] = [];
  for (let i = 0; i < actionCount; i++) {
    const type = r.u16();
    const raw = r.bytesView(8).slice();
    const dv = new DataView(raw.buffer, raw.byteOffset, 8);
    const words: [number, number, number, number] = [
      dv.getUint16(0, true),
      dv.getUint16(2, true),
      dv.getUint16(4, true),
      dv.getUint16(6, true),
    ];
    actions.push({
      type,
      name: ACTION_NAMES.get(type),
      raw,
      words,
      fields: decodeFields(type, words, raw),
    });
  }

  let text = '';
  if (length > 0) {
    const bytes = r.bytesView(length);
    const end = bytes.indexOf(0);
    text = String.fromCharCode(...(end < 0 ? bytes : bytes.subarray(0, end)));
  }

  return { offset, displayStyle, actor, displayStyle2, displayStyle3, choices, actions, text };
}

export function parseDDX(bytes: Uint8Array): DialogFile {
  const r = new Reader(bytes);
  const count = r.u16();
  const index = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    const key = r.u32();
    index.set(key, r.u32());
  }
  const snippets: DialogSnippet[] = [];
  const byOffset = new Map<number, DialogSnippet>();
  while (!r.atEnd()) {
    const snippet = readSnippet(r);
    snippets.push(snippet);
    byOffset.set(snippet.offset, snippet);
  }
  return { index, snippets, byOffset };
}

/** Snippet for a dialogue key within this file, if the key and its offset resolve. */
export function snippetForKey(file: DialogFile, key: number): DialogSnippet | undefined {
  const offset = file.index.get(key);
  return offset === undefined ? undefined : file.byOffset.get(offset);
}
