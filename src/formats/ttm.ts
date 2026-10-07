import { Compression, decompress, decompressRLE } from './compression';
import { Reader } from './reader';
import { findTag } from './tagged';

/**
 * Scene scripts: `.TTM` (drawing scripts) and `.ADS` (which script a scene index plays).
 * See docs/formats/towns.md. Layout learned from xavieran/BaKGL (`bak/scene/scene.cpp`, `ads.cpp`);
 * this decoder is our own and keeps only what a still scene needs.
 */

// ---- TTM -------------------------------------------------------------------

export type TtmOp =
  | { op: 'slotImage'; slot: number }
  | { op: 'slotPalette'; slot: number }
  | { op: 'loadPalette'; name: string }
  | { op: 'loadImage'; name: string }
  | { op: 'loadScreen'; name: string }
  | { op: 'sprite'; x: number; y: number; index: number; slot: number; width: number; height: number; flipX: boolean; flipY: boolean }
  | { op: 'rect'; x: number; y: number; width: number; height: number; filled: boolean; edge: number; fill: number }
  | { op: 'clip'; x: number; y: number; right: number; bottom: number }
  | { op: 'actor' };

export interface TtmScript {
  /** Script id, as referenced by ADS `StartScript`. */
  id: number;
  /** Image slot -> resource name (.BMX) and the palette slot it is drawn with. */
  images: Map<number, { name: string; palette: number }>;
  /** Palette slot -> .PAL name. */
  palettes: Map<number, string>;
  /** The full-screen picture (.SCX) and its palette slot; the last one loaded wins. */
  screen: { name: string; palette: number } | undefined;
  /** Drawing operations in order, ignoring frame boundaries (a still view of the scene). */
  ops: TtmOp[];
}

const OP = {
  setColor: 0x2000,
  showDialog: 0x2010,
  clip: 0x4000,
  rect: 0xa100,
  frame: 0xa110,
  sprite: 0xa500,
  spriteFlipY: 0xa510,
  spriteFlipX: 0xa520,
  spriteFlipXY: 0xa530,
  slotImage: 0x1050,
  slotPalette: 0x1060,
  setScript: 0x1110,
  loadScreen: 0xf010,
  loadImage: 0xf020,
  loadPalette: 0xf050,
} as const;

const asciiUpper = (s: string) => s.toUpperCase();
/** The loader names `.BMP`/`.SCR` resources by their packed twin: last character becomes `X`. */
const packedName = (name: string) => `${name.slice(0, -1)}X`;

/** The decompressed `TT3:` op stream of a TTM file. */
function ttmBody(bytes: Uint8Array): Uint8Array {
  const tt3 = findTag(bytes, 'TT3:');
  if (!tt3 || tt3.length < 5) throw new Error('TTM: no TT3 chunk');
  const size = (tt3[1]! | (tt3[2]! << 8) | (tt3[3]! << 16) | (tt3[4]! << 24)) >>> 0;
  return tt3[0] === 1 ? decompressRLE(tt3.subarray(5), size).data : tt3.subarray(5, 5 + size);
}

/** Decode a TTM file into its scripts, keyed by script id. */
export function parseTtm(bytes: Uint8Array): Map<number, TtmScript> {
  const body = ttmBody(bytes);

  const scripts = new Map<number, TtmScript>();
  let current: TtmScript | undefined;
  let imageSlot: number | undefined;
  let paletteSlot: number | undefined;
  let edge = 0xf;
  let fill = 0xf;

  const r = new Reader(body);
  while (r.remaining >= 2) {
    const word = r.u16();
    const count = word & 0xf;
    const code = word & 0xfff0;

    if (count === 0xf) {
      let name = '';
      for (;;) {
        if (r.atEnd()) break;
        const c = r.u8();
        if (c === 0) break;
        name += String.fromCharCode(c);
      }
      if (r.remaining & 1) r.skip(1);
      name = asciiUpper(name);
      if (!current) continue;
      if (code === OP.loadPalette) {
        if (paletteSlot !== undefined) current.palettes.set(paletteSlot, name);
      } else if (code === OP.loadImage) {
        const n = packedName(name);
        current.ops.push({ op: 'loadImage', name: n });
        if (imageSlot !== undefined) current.images.set(imageSlot, { name: n, palette: paletteSlot ?? imageSlot });
      } else if (code === OP.loadScreen) {
        if (paletteSlot !== undefined) current.screen = { name: packedName(name), palette: paletteSlot };
      }
      continue;
    }

    const args: number[] = [];
    for (let i = 0; i < count && r.remaining >= 2; i++) args.push(r.i16());
    const a = (i: number) => args[i] ?? 0;

    switch (code) {
      case OP.setScript:
        if (count >= 1) {
          current = { id: a(0), images: new Map(), palettes: new Map(), screen: undefined, ops: [] };
          scripts.set(current.id, current);
          imageSlot = undefined;
          edge = 0xf;
          fill = 0xf;
        }
        break;
      case OP.slotImage:
        imageSlot = a(0);
        break;
      case OP.slotPalette:
        paletteSlot = a(0);
        break;
      case OP.setColor:
        edge = a(0);
        fill = a(1);
        break;
      case OP.clip:
        current?.ops.push({ op: 'clip', x: a(0), y: a(1), right: a(2), bottom: a(3) });
        break;
      case OP.rect:
      case OP.frame:
        current?.ops.push({ op: 'rect', x: a(0), y: a(1), width: a(2), height: a(3), filled: code === OP.rect, edge, fill });
        break;
      case OP.sprite:
      case OP.spriteFlipY:
      case OP.spriteFlipX:
      case OP.spriteFlipXY: {
        const flip = (code & 0xf0) >> 4;
        const scaled = args.length >= 6;
        current?.ops.push({
          op: 'sprite', x: a(0), y: a(1), index: a(2), slot: a(3),
          width: scaled ? a(4) : 0, height: scaled ? a(5) : 0,
          flipX: (flip & 2) !== 0, flipY: (flip & 1) !== 0,
        });
        break;
      }
      case OP.showDialog:
        // Dialogue key -1 means "draw the actor image" in a still scene.
        if (a(0) === -1) current?.ops.push({ op: 'actor' });
        break;
      default:
        break;
    }
  }
  return scripts;
}

// ---- TTM frames (animation) ------------------------------------------------

/** One operation of an animated script, in the form the cutscene player runs. */
export type TtmFrameOp =
  | { op: 'slotImage' | 'slotPalette'; slot: number }
  | { op: 'loadPalette' | 'loadImage' | 'loadScreen'; name: string }
  | { op: 'sprite'; x: number; y: number; index: number; slot: number; width: number; height: number; flipX: boolean; flipY: boolean }
  | { op: 'spriteRotated'; x: number; y: number; index: number; slot: number; width: number; height: number; angle: number }
  | { op: 'rect'; x: number; y: number; width: number; height: number; filled: boolean; edge: number; fill: number }
  | { op: 'clip'; x: number; y: number; right: number; bottom: number }
  | { op: 'saveBackground' }
  | { op: 'saveRect'; x: number; y: number; width: number; height: number }
  | { op: 'saveRegion'; x: number; y: number; width: number; height: number }
  | { op: 'setSaveLayer' | 'drawSavedRegion'; layer: number }
  | { op: 'copyLayer'; x: number; y: number; width: number; height: number; source: number; target: number }
  | { op: 'delay'; ticks: number }
  | { op: 'dialog'; key: number | undefined; type: number }
  | { op: 'sound'; index: number }
  | { op: 'fadeIn' | 'fadeOut'; startColor: number; steps: number; endColor: number; duration: number }
  | { op: 'gotoTag'; tag: number }
  | { op: 'endScript' };

export interface TtmFrame {
  /** Script id when the frame opens a script (`0x1100`/`0x1110`); ADS starts and `gotoTag` jump to it. */
  tag: number | undefined;
  ops: TtmFrameOp[];
}

const FRAME_OP = {
  saveBackground: 0x0020,
  endScript: 0x0110,
  endFrame: 0x0ff0,
  delay: 0x1020,
  slotImage: 0x1050,
  slotPalette: 0x1060,
  scriptTag: 0x1100,
  setScript: 0x1110,
  setSaveLayer: 0x1120,
  gotoTag: 0x1200,
  setColor: 0x2000,
  showDialog: 0x2010,
  clip: 0x4000,
  fadeOut: 0x4110,
  fadeIn: 0x4120,
  saveRect: 0x4200,
  saveRegion: 0x4210,
  rect: 0xa100,
  frame: 0xa110,
  sprite: 0xa500,
  spriteRotated: 0xa5a0,
  drawSavedRegion: 0xa600,
  copyLayer: 0xb600,
  sound: 0xc050,
} as const;

/**
 * Decode a TTM file into its animation frames, in file order. A frame ends at op `0x0ff0`; all scripts of the
 * file are laid end to end and a script runs from the frame carrying its tag to its `endScript` (or a `gotoTag`).
 * Edge and fill colours are resolved here, per script, so parallel scripts do not share them.
 */
export function parseTtmFrames(bytes: Uint8Array): TtmFrame[] {
  const r = new Reader(ttmBody(bytes));
  const frames: TtmFrame[] = [];
  let ops: TtmFrameOp[] = [];
  let tag: number | undefined;
  let tagged = false;
  let edge = 0xf;
  let fill = 0xf;
  const push = () => {
    frames.push({ tag, ops });
    ops = [];
    tag = undefined;
    tagged = false;
  };

  while (r.remaining >= 2) {
    const word = r.u16();
    const count = word & 0xf;
    const code = word & 0xfff0;

    if (count === 0xf) {
      let name = '';
      while (!r.atEnd()) {
        const c = r.u8();
        if (c === 0) break;
        name += String.fromCharCode(c);
      }
      if (r.remaining & 1) r.skip(1);
      name = asciiUpper(name);
      if (code === OP.loadPalette) ops.push({ op: 'loadPalette', name });
      else if (code === OP.loadImage) ops.push({ op: 'loadImage', name: packedName(name) });
      else if (code === OP.loadScreen) ops.push({ op: 'loadScreen', name: packedName(name) });
      continue;
    }

    const args: number[] = [];
    for (let i = 0; i < count && r.remaining >= 2; i++) args.push(r.i16());
    const a = (i: number) => args[i] ?? 0;

    switch (code) {
      case FRAME_OP.setScript:
      case FRAME_OP.scriptTag:
        if (ops.length === 0 && !tagged) {
          tag = a(0);
          tagged = true;
        }
        if (code === FRAME_OP.setScript) {
          edge = 0xf;
          fill = 0xf;
        }
        break;
      case FRAME_OP.endFrame: push(); break;
      case FRAME_OP.endScript: ops.push({ op: 'endScript' }); break;
      case FRAME_OP.saveBackground: ops.push({ op: 'saveBackground' }); break;
      case FRAME_OP.delay: ops.push({ op: 'delay', ticks: a(0) }); break;
      case FRAME_OP.slotImage: ops.push({ op: 'slotImage', slot: a(0) }); break;
      case FRAME_OP.slotPalette: ops.push({ op: 'slotPalette', slot: a(0) }); break;
      case FRAME_OP.setSaveLayer: ops.push({ op: 'setSaveLayer', layer: a(0) }); break;
      case FRAME_OP.drawSavedRegion: ops.push({ op: 'drawSavedRegion', layer: a(0) }); break;
      case FRAME_OP.gotoTag: ops.push({ op: 'gotoTag', tag: a(0) }); break;
      case FRAME_OP.setColor:
        edge = a(0);
        fill = a(1);
        break;
      case FRAME_OP.clip: ops.push({ op: 'clip', x: a(0), y: a(1), right: a(2), bottom: a(3) }); break;
      case FRAME_OP.saveRect: ops.push({ op: 'saveRect', x: a(0), y: a(1), width: a(2), height: a(3) }); break;
      case FRAME_OP.saveRegion: ops.push({ op: 'saveRegion', x: a(0), y: a(1), width: a(2), height: a(3) }); break;
      case FRAME_OP.copyLayer:
        ops.push({ op: 'copyLayer', x: a(0), y: a(1), width: a(2), height: a(3), source: a(4), target: a(5) });
        break;
      case FRAME_OP.rect:
      case FRAME_OP.frame:
        ops.push({ op: 'rect', x: a(0), y: a(1), width: a(2), height: a(3), filled: code === FRAME_OP.rect, edge, fill });
        break;
      case FRAME_OP.sprite:
      case 0xa510:
      case 0xa520:
      case 0xa530: {
        const flip = (code & 0xf0) >> 4;
        const scaled = args.length >= 6;
        ops.push({
          op: 'sprite', x: a(0), y: a(1), index: a(2), slot: a(3),
          width: scaled ? a(4) : 0, height: scaled ? a(5) : 0, flipX: (flip & 2) !== 0, flipY: (flip & 1) !== 0,
        });
        break;
      }
      case FRAME_OP.spriteRotated:
        ops.push({ op: 'spriteRotated', x: a(0), y: a(1), index: a(2), slot: a(3), width: a(4), height: a(5), angle: a(6) });
        break;
      case FRAME_OP.showDialog: ops.push({ op: 'dialog', key: a(0) === -1 ? undefined : a(0), type: a(1) }); break;
      case FRAME_OP.sound: ops.push({ op: 'sound', index: a(0) }); break;
      case FRAME_OP.fadeIn:
      case FRAME_OP.fadeOut:
        ops.push({ op: code === FRAME_OP.fadeIn ? 'fadeIn' : 'fadeOut', startColor: a(0), steps: a(1), endColor: a(2), duration: a(3) });
        break;
      default:
        break;
    }
  }
  if (ops.length > 0) push();
  return frames;
}

// ---- ADS -------------------------------------------------------------------

export type AdsCondition =
  | { kind: 'notStarted' | 'finished'; script: number }
  | { kind: 'chapterGte' | 'chapterLte'; chapter: number };

export interface AdsAction {
  kind: 'start' | 'stop';
  script: number;
}

export interface AdsBlock {
  conditions: AdsCondition[];
  then: AdsAction[];
  else: AdsAction[];
}

export interface AdsScene {
  index: number;
  blocks: AdsBlock[];
}

const ADS = {
  ifNotPlayed: 0x1030,
  ifNotPlayedElse: 0x1330,
  ifPlayedElse: 0x1350,
  ifChapLte: 0x13a0,
  ifChapGte: 0x13b0,
  and: 0x1420,
  or: 0x1430,
  else: 0x1500,
  endIfElse: 0x1510,
  endIf: 0x1520,
  restart: 0x2000,
  start: 0x2005,
  stop: 0x2010,
  stopScene: 0xf010,
  end: 0xffff,
} as const;

function operandCount(op: number): number {
  switch (op) {
    case ADS.ifNotPlayed: case ADS.ifNotPlayedElse: case ADS.ifPlayedElse: return 2;
    case ADS.restart: case ADS.start: return 4;
    case ADS.stop: return 3;
    case ADS.ifChapGte: case ADS.ifChapLte: case ADS.stopScene: return 1;
    default: return 0;
  }
}

const isCondition = (op: number) =>
  op === ADS.ifNotPlayed || op === ADS.ifNotPlayedElse || op === ADS.ifPlayedElse || op === ADS.ifChapGte || op === ADS.ifChapLte;
const isAction = (op: number) => op === ADS.start || op === ADS.restart || op === ADS.stop;

interface RawOp {
  op: number;
  args: number[];
}

function toCondition(o: RawOp): AdsCondition {
  switch (o.op) {
    case ADS.ifChapGte: return { kind: 'chapterGte', chapter: o.args[0]! };
    case ADS.ifChapLte: return { kind: 'chapterLte', chapter: o.args[0]! };
    case ADS.ifPlayedElse: return { kind: 'finished', script: o.args[1]! };
    default: return { kind: 'notStarted', script: o.args[1]! };
  }
}

const toAction = (o: RawOp): AdsAction => ({ kind: o.op === ADS.stop ? 'stop' : 'start', script: o.args[1]! });

/** Group a scene's flat op list into if/else blocks of start/stop actions. */
function parseBlocks(ops: RawOp[]): AdsBlock[] {
  let pos = 0;
  const peek = () => ops[pos]?.op;

  const condition = (): AdsCondition[] => {
    const out = [toCondition(ops[pos++]!)];
    while (peek() === ADS.and || peek() === ADS.or) {
      pos++;
      if (pos >= ops.length) break;
      out.push(toCondition(ops[pos++]!));
    }
    return out;
  };
  const closeIf = () => {
    if (peek() === ADS.endIf || peek() === ADS.endIfElse) pos++;
  };
  const body = (out: AdsAction[]) => {
    while (pos < ops.length) {
      const op = peek()!;
      if (isAction(op)) {
        out.push(toAction(ops[pos++]!));
      } else if (isCondition(op)) {
        condition();
        body(out);
        if (peek() === ADS.else) {
          pos++;
          body(out);
        }
        closeIf();
      } else {
        break;
      }
    }
  };

  const blocks: AdsBlock[] = [];
  while (pos < ops.length) {
    if (!isCondition(peek()!)) {
      pos++; // stray op outside a block
      continue;
    }
    const block: AdsBlock = { conditions: condition(), then: [], else: [] };
    body(block.then);
    if (peek() === ADS.else) {
      pos++;
      body(block.else);
    }
    closeIf();
    blocks.push(block);
  }
  return blocks;
}

/** Decode an ADS file: scenes made of conditional script starts. */
export function parseAds(bytes: Uint8Array): AdsScene[] {
  const scr = findTag(bytes, 'SCR:');
  if (!scr) throw new Error('ADS: no SCR chunk');
  return decodeAds(decompress(Compression.LZW, scr, 0));
}

/** The decompressed ADS body: per scene a u16 index, then ops up to 0xFFFF. */
export function decodeAds(body: Uint8Array): AdsScene[] {
  const r = new Reader(body);
  const scenes: AdsScene[] = [];
  while (r.remaining >= 2) {
    const index = r.u16();
    const ops: RawOp[] = [];
    while (r.remaining >= 2) {
      const op = r.u16();
      if (op === ADS.end) break;
      const args: number[] = [];
      for (let i = operandCount(op); i > 0 && r.remaining >= 2; i--) args.push(r.u16());
      ops.push({ op, args });
    }
    scenes.push({ index, blocks: parseBlocks(ops) });
  }
  return scenes;
}

/**
 * The script a scene index plays in a chapter: the last `start` of the first block that starts anything,
 * taking the then or else branch by the chapter conditions (script played/finished tests count as true).
 */
export function selectScript(scenes: readonly AdsScene[], sceneIndex: number, chapter: number): number | undefined {
  const scene = scenes.find((s) => s.index === sceneIndex);
  if (!scene) return undefined;
  for (const block of scene.blocks) {
    const matched = block.conditions.every((c) =>
      c.kind === 'chapterGte' ? chapter >= c.chapter : c.kind === 'chapterLte' ? chapter <= c.chapter : true,
    );
    const actions = matched ? block.then : block.else;
    for (let i = actions.length - 1; i >= 0; i--) {
      const a = actions[i]!;
      if (a.kind === 'start') return a.script;
    }
  }
  return undefined;
}
