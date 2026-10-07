import { describe, expect, it, vi } from 'vitest';
import { decodeAds, parseTtmFrames, type TtmFrame } from '../src/formats/ttm';
import {
  CutscenePlayer, CutsceneRenderer, CutsceneRunner, FADE_SECONDS, SECONDS_PER_TICK,
  chapterFinishCutscenes, chapterStartCutscenes, cutsceneResourceNames,
} from '../src/game/cutscene';
import { SCENE_WIDTH } from '../src/game/townScene';

// The screen decoder needs LZW data; a flat-colour stand-in keeps these tests free of game data.
vi.mock('../src/formats/scx', () => ({
  parseSCX: () => ({ width: 320, height: 200, pixels: new Uint8Array(320 * 200).fill(2) }),
}));

// ---- synthetic fixtures ----------------------------------------------------

type Op = number[] | [number, string];
function ttmBytes(ops: Op[]): Uint8Array {
  const body: number[] = [];
  const u16 = (v: number) => body.push(v & 0xff, (v >> 8) & 0xff);
  for (const op of ops) {
    if (typeof op[1] === 'string') {
      u16((op[0] as number) | 0xf);
      const name = op[1] as string;
      for (const ch of name) body.push(ch.charCodeAt(0));
      body.push(0);
      if ((name.length + 1) & 1) body.push(0);
    } else {
      const args = op.slice(1) as number[];
      u16((op[0] as number) | args.length);
      args.forEach((a) => u16(a));
    }
  }
  const tt3 = [0, body.length & 0xff, (body.length >> 8) & 0xff, 0, 0, ...body];
  const out = new Uint8Array(8 + tt3.length);
  out.set([0x54, 0x54, 0x33, 0x3a], 0);
  new DataView(out.buffer).setUint32(4, tt3.length, true);
  out.set(tt3, 8);
  return out;
}

function palBytes(colours: Record<number, [number, number, number]>): Uint8Array {
  const out = new Uint8Array(8 + 768);
  out.set([0x56, 0x47, 0x41, 0x3a], 0);
  new DataView(out.buffer).setUint32(4, 768, true);
  for (const [i, c] of Object.entries(colours)) out.set(c, 8 + Number(i) * 3);
  return out;
}

function bmxBytes(images: { width: number; height: number; pixels: number[] }[]): Uint8Array {
  const blob = images.flatMap((i) => i.pixels);
  const rle: number[] = [];
  for (let p = 0; p < blob.length; p += 100) {
    const run = blob.slice(p, p + 100);
    rle.push(run.length, ...run);
  }
  const out = new Uint8Array(12 + images.length * 8 + rle.length);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, 0x1066, true);
  dv.setUint16(2, 2, true);
  dv.setUint16(4, images.length, true);
  dv.setUint32(8, blob.length, true);
  images.forEach((img, i) => {
    dv.setUint16(12 + i * 8, img.pixels.length, true);
    dv.setUint16(12 + i * 8 + 4, img.width, true);
    dv.setUint16(12 + i * 8 + 6, img.height, true);
  });
  out.set(rle, 12 + images.length * 8);
  return out;
}

/** A decompressed ADS body: scenes of [index, ...ops], each op [code, ...operands]. */
function adsBody(...scenes: number[][][]): Uint8Array {
  const words: number[] = [];
  for (const scene of scenes) for (const w of scene) words.push(...w);
  return new Uint8Array(words.flatMap((w) => [w & 0xff, (w >> 8) & 0xff]));
}

const SET_SCRIPT = 0x1110;
const END_FRAME = 0x0ff0;
const END_SCRIPT = 0x0110;
const GOTO = 0x1200;
const DELAY = 0x1020;
const SLOT_IMAGE = 0x1050;
const SLOT_PALETTE = 0x1060;
const SPRITE = 0xa500;
const SPRITE_FLIP_X = 0xa520;
const SPRITE_ROTATED = 0xa5a0;
const RECT = 0xa100;
const SET_COLOR = 0x2000;
const CLIP = 0x4000;
const SHOW_DIALOG = 0x2010;
const FADE_OUT = 0x4110;
const FADE_IN = 0x4120;
const SAVE_BACKGROUND = 0x0020;
const SAVE_REGION = 0x4210;
const DRAW_SAVED = 0xa600;
const SET_SAVE_LAYER = 0x1120;
const COPY_LAYER = 0xb600;
const SOUND = 0xc050;
const LOAD_SCREEN = 0xf010;
const LOAD_IMAGE = 0xf020;
const LOAD_PALETTE = 0xf050;

const files = new Map<string, Uint8Array>([
  ['T.PAL', palBytes({ 1: [63, 0, 0], 2: [0, 63, 0], 3: [0, 0, 63], 4: [63, 63, 0] })],
  ['SPR.BMX', bmxBytes([{ width: 2, height: 1, pixels: [1, 3] }, { width: 2, height: 2, pixels: [1, 1, 1, 1] }])],
  ['BACK.SCX', new Uint8Array(1)],
]);
const read = (n: string) => files.get(n);
const SETUP: Op[] = [[SLOT_PALETTE, 0], [LOAD_PALETTE, 'T.PAL'], [SLOT_IMAGE, 1], [LOAD_IMAGE, 'SPR.BMP']];
const frames = (...ops: Op[]) => parseTtmFrames(ttmBytes(ops));

const px = (img: Uint8ClampedArray, x: number, y: number) => [...img.subarray((y * SCENE_WIDTH + x) * 4, (y * SCENE_WIDTH + x) * 4 + 4)];
const RED = [255, 0, 0, 255];
const BLUE = [0, 0, 255, 255];
const GREEN = [0, 255, 0, 255];
const BLACK = [0, 0, 0, 255];

// ---- parseTtmFrames --------------------------------------------------------

describe('parseTtmFrames', () => {
  it('splits frames at 0x0ff0 and tags the frame that opens a script', () => {
    const f = frames([SET_SCRIPT, 7], [SPRITE, 1, 2, 0, 1], [END_FRAME], [DELAY, 5], [END_FRAME], [SET_SCRIPT, 9], [END_SCRIPT], [END_FRAME]);
    expect(f.map((x) => x.tag)).toEqual([7, undefined, 9]);
    expect(f.map((x) => x.ops.map((o) => o.op))).toEqual([['sprite'], ['delay'], ['endScript']]);
  });

  it('keeps trailing ops without a frame end as a last frame', () => {
    expect(frames([SET_SCRIPT, 1], [DELAY, 3])).toHaveLength(1);
  });

  it('decodes names, packed resource names and slot selection', () => {
    const [f] = frames([SET_SCRIPT, 1], [SLOT_PALETTE, 2], [LOAD_PALETTE, 'a.pal'], [LOAD_IMAGE, 'b.bmp'], [LOAD_SCREEN, 'c.scr'], [END_FRAME]);
    expect(f!.ops).toEqual([
      { op: 'slotPalette', slot: 2 }, { op: 'loadPalette', name: 'A.PAL' }, { op: 'loadImage', name: 'B.BMX' }, { op: 'loadScreen', name: 'C.SCX' },
    ]);
  });

  it('resolves rectangle colours per script and resets them at a script start', () => {
    const f = frames([SET_SCRIPT, 1], [SET_COLOR, 3, 4], [RECT, 0, 0, 2, 2], [END_FRAME], [SET_SCRIPT, 2], [RECT, 0, 0, 2, 2], [END_FRAME]);
    expect(f[0]!.ops[0]).toMatchObject({ op: 'rect', edge: 3, fill: 4, filled: true });
    expect(f[1]!.ops[0]).toMatchObject({ edge: 0xf, fill: 0xf });
  });

  it('decodes sprites, dialogue, sound, fades, goto and layer ops', () => {
    const [f] = frames(
      [SET_SCRIPT, 1], [SPRITE_FLIP_X, 5, 6, 1, 1, 8, 4], [SPRITE_ROTATED, 1, 2, 3, 4, 5, 6, 90], [SHOW_DIALOG, -1, 3], [SHOW_DIALOG, 12, 0],
      [SOUND, 4], [FADE_OUT, 0, 1, 2, 3], [FADE_IN, 16, 1, 2, 3], [GOTO, 1], [COPY_LAYER, 1, 2, 3, 4, 1, 2], [END_FRAME],
    );
    expect(f!.ops).toEqual([
      { op: 'sprite', x: 5, y: 6, index: 1, slot: 1, width: 8, height: 4, flipX: true, flipY: false },
      { op: 'spriteRotated', x: 1, y: 2, index: 3, slot: 4, width: 5, height: 6, angle: 90 },
      { op: 'dialog', key: undefined, type: 3 }, { op: 'dialog', key: 12, type: 0 },
      { op: 'sound', index: 4 },
      { op: 'fadeOut', startColor: 0, steps: 1, endColor: 2, duration: 3 }, { op: 'fadeIn', startColor: 16, steps: 1, endColor: 2, duration: 3 },
      { op: 'gotoTag', tag: 1 }, { op: 'copyLayer', x: 1, y: 2, width: 3, height: 4, source: 1, target: 2 },
    ]);
  });

  it('throws without a TT3 chunk', () => {
    expect(() => parseTtmFrames(new Uint8Array(16))).toThrow(/TT3/);
  });
});

// ---- runner ----------------------------------------------------------------

const IF_NOT_PLAYED = 0x1030;
const IF_PLAYED = 0x1350;
const AND = 0x1420;
const END_IF = 0x1520;
const START = 0x2005;
const STOP = 0x2010;
const IF_CHAP_GTE = 0x13b0;

const tagFrames = (ids: number[][]): TtmFrame[] =>
  ids.flatMap((script, s) => script.map((n, i): TtmFrame => ({
    tag: i === 0 ? s + 1 : undefined,
    ops: [{ op: 'delay', ticks: n }, ...(i === script.length - 1 ? [{ op: 'endScript' as const }] : [])],
  })));

describe('CutsceneRunner', () => {
  const ads = decodeAds(adsBody([[1], [IF_NOT_PLAYED, 0, 1], [START, 0, 1, 0, 0], [END_IF], [IF_PLAYED, 0, 1], [AND], [IF_NOT_PLAYED, 0, 2], [START, 0, 2, 0, 0], [END_IF], [0xffff]]));
  const ticks = (r: CutsceneRunner) => {
    const out: number[] = [];
    for (let f = r.next(); f; f = r.next()) out.push((f[0] as { ticks: number }).ticks);
    return out;
  };

  it('runs a script, then the one that waits for it to finish', () => {
    expect(ticks(new CutsceneRunner(ads, tagFrames([[10, 11, 12], [20, 21]])))).toEqual([10, 11, 12, 20, 21]);
  });

  it('steps parallel scripts together in one frame', () => {
    const parallel = decodeAds(adsBody([[1], [IF_NOT_PLAYED, 0, 1], [START, 0, 1, 0, 0], [START, 0, 2, 0, 0], [END_IF], [0xffff]]));
    const r = new CutsceneRunner(parallel, tagFrames([[1, 2], [5, 6, 7]]));
    expect(r.next()!.filter((o) => o.op === 'delay').map((o) => (o as { ticks: number }).ticks)).toEqual([1, 5]);
    expect(r.next()!.filter((o) => o.op === 'delay').map((o) => (o as { ticks: number }).ticks)).toEqual([2, 6]);
    expect(r.next()!.filter((o) => o.op === 'delay').map((o) => (o as { ticks: number }).ticks)).toEqual([7]);
    expect(r.next()).toBeUndefined();
  });

  it('stops a script by number', () => {
    const body = decodeAds(adsBody([[1], [IF_NOT_PLAYED, 0, 1], [START, 0, 1, 0, 0], [END_IF], [IF_PLAYED, 0, 9], [STOP, 0, 1, 0], [END_IF], [0xffff]]));
    const r = new CutsceneRunner(body, tagFrames([[1, 2, 3]]));
    expect(r.next()).toBeDefined();
    expect(r.next()).toBeDefined();
  });

  it('jumps to a tagged frame on gotoTag and loops until stopped', () => {
    const loop: TtmFrame[] = [{ tag: 1, ops: [{ op: 'delay', ticks: 1 }] }, { tag: undefined, ops: [{ op: 'gotoTag', tag: 1 }] }];
    const r = new CutsceneRunner(ads, loop);
    const seen = Array.from({ length: 6 }, () => r.next()![0]!.op);
    expect(seen).toEqual(['delay', 'gotoTag', 'delay', 'gotoTag', 'delay', 'gotoTag']);
  });

  it('ends a script whose gotoTag has no target', () => {
    const r = new CutsceneRunner(ads, [{ tag: 1, ops: [{ op: 'gotoTag', tag: 99 }] }]);
    expect(r.next()).toBeDefined();
    expect(r.next()).toBeUndefined();
  });

  it('ends at once when no script has a frame', () => {
    expect(new CutsceneRunner(ads, []).next()).toBeUndefined();
  });

  it('honours chapter conditions', () => {
    const late = decodeAds(adsBody([[1], [IF_CHAP_GTE, 3], [START, 0, 1, 0, 0], [END_IF], [0xffff]]));
    const f = tagFrames([[4]]);
    expect(new CutsceneRunner(late, f, 2).next()).toBeUndefined();
    expect(new CutsceneRunner(late, f, 3).next()).toBeDefined();
  });
});

// ---- renderer --------------------------------------------------------------

describe('CutsceneRenderer', () => {
  const render = (...ops: Op[]) => {
    const r = new CutsceneRenderer(read);
    const fs = frames([SET_SCRIPT, 1], ...SETUP, ...ops);
    return { r, out: fs.map((f) => r.draw(f.ops)) };
  };

  it('draws sprites with palette colours and leaves index 0 transparent', () => {
    const img = render([SPRITE, 10, 20, 0, 1], [END_FRAME]).out[0]!;
    expect(px(img, 10, 20)).toEqual(RED);
    expect(px(img, 11, 20)).toEqual(BLUE);
    expect(px(img, 12, 20)).toEqual(BLACK);
  });

  it('flips and scales', () => {
    const flipped = render([SPRITE_FLIP_X, 10, 20, 0, 1], [END_FRAME]).out[0]!;
    expect(px(flipped, 10, 20)).toEqual(BLUE);
    const scaled = render([SPRITE, 0, 0, 0, 1, 4, 2], [END_FRAME]).out[0]!;
    // target pixel i samples source floor(i / (width - 1) * (source width - 1))
    expect([px(scaled, 0, 0), px(scaled, 1, 1), px(scaled, 2, 0), px(scaled, 3, 1)]).toEqual([RED, RED, RED, BLUE]);
    const mirrored = render([SPRITE, 0, 0, 0, 1, -2, 1], [END_FRAME]).out[0]!;
    expect([px(mirrored, 0, 0), px(mirrored, 1, 0)]).toEqual([BLUE, RED]);
  });

  it('clips inclusively to the clip region, which persists', () => {
    const { out } = render([CLIP, 0, 0, 10, 100], [SPRITE, 10, 20, 0, 1], [END_FRAME], [SPRITE, 10, 30, 0, 1], [END_FRAME]);
    expect(px(out[0]!, 10, 20)).toEqual(RED);
    expect(px(out[0]!, 11, 20)).toEqual(BLACK);
    expect(px(out[1]!, 11, 30)).toEqual(BLACK);
  });

  it('draws filled and framed rectangles with the script colours', () => {
    const img = render([SET_COLOR, 1, 3], [RECT, 5, 5, 4, 4], [END_FRAME]).out[0]!;
    expect(px(img, 5, 5)).toEqual(RED);
    expect(px(img, 6, 6)).toEqual(BLUE);
  });

  it('clears sprites each frame back to the background, which a screen load sets', () => {
    const { out } = render([LOAD_SCREEN, 'BACK.SCR'], [SPRITE, 0, 0, 0, 1], [END_FRAME], [END_FRAME]);
    expect(px(out[0]!, 0, 0)).toEqual(RED);
    expect(px(out[0]!, 5, 5)).toEqual(GREEN);
    expect(px(out[1]!, 0, 0)).toEqual(GREEN);
  });

  it('keeps sprites drawn before saveBackground', () => {
    const { out } = render([SPRITE, 0, 0, 0, 1], [SAVE_BACKGROUND], [END_FRAME], [END_FRAME]);
    expect(px(out[1]!, 0, 0)).toEqual(RED);
  });

  it('saves a region and draws it back later', () => {
    const { out } = render([SPRITE, 0, 0, 0, 1], [SET_SAVE_LAYER, 2], [SAVE_REGION, 0, 0, 2, 1], [END_FRAME], [DRAW_SAVED, 2], [END_FRAME]);
    expect(px(out[1]!, 0, 0)).toEqual(RED);
    expect(px(out[1]!, 1, 0)).toEqual(BLUE);
  });

  it('copies between layers', () => {
    // screen (1) onto background (2) leaves the sprite behind for the next frame
    const { out } = render([SPRITE, 0, 0, 0, 1], [COPY_LAYER, 0, 0, 2, 1, 1, 2], [END_FRAME], [END_FRAME]);
    expect(px(out[1]!, 1, 0)).toEqual(BLUE);
  });

  it('draws a rotated sprite around its centre', () => {
    const img = render([SPRITE_ROTATED, 50, 50, 1, 1, 4, 4, 0], [END_FRAME]).out[0]!;
    expect(px(img, 50, 50)).toEqual(RED);
    expect(px(img, 60, 60)).toEqual(BLACK);
  });

  it('skips missing resources instead of failing', () => {
    const r = new CutsceneRenderer(() => undefined);
    const [f] = frames([SET_SCRIPT, 1], ...SETUP, [LOAD_SCREEN, 'GONE.SCR'], [SPRITE, 0, 0, 0, 1], [END_FRAME]);
    expect(px(r.draw(f!.ops), 0, 0)).toEqual(BLACK);
  });

  it('lists the resources a cutscene loads', () => {
    expect(cutsceneResourceNames(frames([SET_SCRIPT, 1], ...SETUP, [LOAD_SCREEN, 'BACK.SCR'], [END_FRAME]))).toEqual(['T.PAL', 'SPR.BMX', 'BACK.SCX']);
  });
});

// ---- player ----------------------------------------------------------------

const ONE_SCRIPT = decodeAds(adsBody([[1], [IF_NOT_PLAYED, 0, 1], [START, 0, 1, 0, 0], [END_IF], [0xffff]]));

function play(ops: Op[], host: ConstructorParameters<typeof CutscenePlayer>[0]['host'] = {}) {
  const player = new CutscenePlayer({ ads: ONE_SCRIPT, frames: parseTtmFrames(ttmBytes([[SET_SCRIPT, 1], ...SETUP, ...ops])), read, host });
  const done = vi.fn();
  player.start(done);
  return { player, done };
}

describe('CutscenePlayer', () => {
  it('shows the first frame at once and holds each frame for its delay', () => {
    const { player, done } = play([[SPRITE, 0, 0, 0, 1], [DELAY, 100], [END_FRAME], [SPRITE, 0, 0, 1, 1], [END_FRAME], [END_SCRIPT], [END_FRAME]]);
    expect(px(player.image!, 0, 0)).toEqual(RED);
    player.update(100 * SECONDS_PER_TICK * 1000 - 1);
    expect(px(player.image!, 0, 0)).toEqual(RED);
    player.update(2);
    expect(player.image).toBeDefined();
    expect(done).not.toHaveBeenCalled();
    for (let i = 0; i < 5; i++) player.update(5000);
    expect(player.finished).toBe(true);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('finishes when the script ends and not before', () => {
    const { player, done } = play([[DELAY, 1], [END_FRAME], [END_SCRIPT], [END_FRAME]]);
    expect(done).not.toHaveBeenCalled();
    player.update(1000);
    player.update(1000);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('shows text, waits for a click and clears it when the frame ends', () => {
    const text = vi.fn((k: number) => (k === 5 ? 'Hello' : undefined));
    const { player } = play([[SHOW_DIALOG, 5, 4], [SPRITE, 0, 0, 0, 1], [END_FRAME], [END_SCRIPT], [END_FRAME]], { text });
    expect(player.text).toBe('Hello');
    expect(player.waitingForClick).toBe(true);
    expect(player.image).toBeUndefined();
    player.update(10000);
    expect(player.text).toBe('Hello');
    player.click();
    expect(player.text).toBeUndefined();
    expect(player.image).toBeDefined();
  });

  it('keeps type 0 text across frames and does not wait for type 3', () => {
    const { player } = play([[SHOW_DIALOG, 5, 3], [END_FRAME], [END_SCRIPT], [END_FRAME]], { text: () => 'Hi' });
    expect(player.waitingForClick).toBe(false);
    expect(player.text).toBe('Hi');
  });

  it('does not wait for text it cannot find', () => {
    const { player } = play([[SHOW_DIALOG, 5, 0], [END_FRAME], [END_SCRIPT], [END_FRAME]]);
    expect(player.waitingForClick).toBe(false);
  });

  it('ignores clicks during a delay', () => {
    const { player } = play([[DELAY, 100], [END_FRAME], [DELAY, 100], [END_FRAME], [END_SCRIPT], [END_FRAME]]);
    player.click();
    expect(player.finished).toBe(false);
  });

  it('plays sounds as their frame runs', () => {
    const sound = vi.fn();
    play([[SOUND, 7], [END_FRAME], [END_SCRIPT], [END_FRAME]], { sound });
    expect(sound).toHaveBeenCalledWith(7);
  });

  it('fades in from the palette colour over the fade duration', () => {
    const { player } = play([[SPRITE, 0, 0, 0, 1], [FADE_IN, 0, 1, 4, 3], [END_FRAME], [END_SCRIPT], [END_FRAME]]);
    expect(player.image).toBeDefined();
    expect(player.fade).toMatchObject({ color: [255, 255, 0], alpha: 1 });
    player.update((FADE_SECONDS[3]! * 1000) / 2);
    expect(player.fade.alpha).toBeCloseTo(0.5, 5);
    player.update(FADE_SECONDS[3]! * 1000);
    expect(player.fade.alpha).toBe(0);
  });

  it('fades out to solid, using only the picture window for colours from 16', () => {
    const { player } = play([[FADE_OUT, 16, 1, 1, 0], [END_SCRIPT], [END_FRAME]]);
    expect(player.fade.alpha).toBe(1);
    expect(player.fade.region).toEqual({ x: 15, y: 11, width: 289, height: 101 });
  });

  it('pauses on a hooked dialogue until it reports done', () => {
    let finish = () => {};
    const { player } = play([[SHOW_DIALOG, 3, 5], [END_FRAME], [END_SCRIPT], [END_FRAME]], { dialog: (_k, done) => { finish = done; } });
    player.update(10000);
    expect(player.finished).toBe(false);
    finish();
    player.update(10000);
    player.update(10000);
    expect(player.finished).toBe(true);
  });

  it('skips straight to the end', () => {
    const { player, done } = play([[DELAY, 1000], [END_FRAME], [DELAY, 1000], [END_FRAME]]);
    player.skip();
    expect(player.finished).toBe(true);
    expect(done).toHaveBeenCalledTimes(1);
    player.skip();
    expect(done).toHaveBeenCalledTimes(1);
  });
});

describe('chapter cutscene lists', () => {
  it('starts with the chapter animation, its book and the first scene', () => {
    expect(chapterStartCutscenes(3)).toEqual([
      { kind: 'ttm', ads: 'CHAPTER3.ADS', ttm: 'CHAPTER3.TTM' }, { kind: 'book', file: 'C31.BOK' }, { kind: 'ttm', ads: 'C31.ADS', ttm: 'C31.TTM' },
    ]);
  });

  it('finishes with a book (not in chapters 2, 4, 6, 7, 8) and an animation; chapter 9 uses scene 3; chapter 10 has none', () => {
    expect(chapterFinishCutscenes(1)).toEqual([{ kind: 'book', file: 'C12.BOK' }, { kind: 'ttm', ads: 'C12.ADS', ttm: 'C12.TTM' }]);
    expect(chapterFinishCutscenes(2)).toEqual([{ kind: 'ttm', ads: 'C22.ADS', ttm: 'C22.TTM' }]);
    expect(chapterFinishCutscenes(9)).toEqual([{ kind: 'book', file: 'C92.BOK' }, { kind: 'ttm', ads: 'C93.ADS', ttm: 'C93.TTM' }]);
    expect(chapterFinishCutscenes(10)).toEqual([]);
  });
});

// ---- screen ----------------------------------------------------------------

describe('CutsceneScreen', () => {
  const screen = async () => {
    const { CutsceneScreen } = await import('../src/ui/cutsceneScreen');
    const { player } = play([[SHOW_DIALOG, 5, 4], [END_FRAME], [END_SCRIPT], [END_FRAME]], { text: () => 'Hi' });
    const s = new CutsceneScreen({ width: 2560, height: 1440 } as never);
    expect(s.open({ player, picture: () => undefined })).toBe(true);
    return { s, player };
  };

  it('opens only with a player', async () => {
    const { CutsceneScreen } = await import('../src/ui/cutsceneScreen');
    expect(new CutsceneScreen({ width: 2560, height: 1440 } as never).open()).toBe(false);
  });

  it('continues on a click or Space and ignores other keys', async () => {
    const { s, player } = await screen();
    s.event({ type: 'key', key: 'a' });
    expect(player.waitingForClick).toBe(true);
    s.event({ type: 'key', key: ' ' });
    expect(player.waitingForClick).toBe(false);
  });

  it('skips on Escape and when closed', async () => {
    const a = await screen();
    a.s.escape();
    expect(a.player.finished).toBe(true);
    const b = await screen();
    b.s.close();
    expect(b.player.finished).toBe(true);
  });
});
