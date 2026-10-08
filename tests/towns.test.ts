import { describe, expect, it, vi } from 'vitest';
import {
  HotspotAction,
  HOTSPOT_SIZE,
  TOWN_ENTRY_SIZE,
  gdsFileName,
  gdsLetter,
  hotspotHasDialog,
  parseGds,
  parseTownTable,
  templeNumber,
  type Hotspot,
} from '../src/formats/gds';
import { decodeAds, parseTtm, selectScript } from '../src/formats/ttm';
import {
  SCENE_HEIGHT,
  SCENE_WIDTH,
  composeScene,
  hotspotActive,
  runsImmediately,
  scriptResourceNames,
} from '../src/game/townScene';
import { TownController, actionAfterDialog, type DialogEnd, type TownHooks } from '../src/game/townController';
import { townExit } from '../src/game/townHost';
import { setFlag, type WorldState } from '../src/game/state';
import { GAM_OFFSETS } from '../src/formats/gam';
import { TILE_SIZE, CELL_SIZE } from '../src/formats/world';
import { hotspotAt, layoutTownScreen, stepTown, initialTownState, toScenePoint } from '../src/ui/townScreen';

// The screen decoder needs LZW data; a flat-colour stand-in keeps these tests free of game data.
vi.mock('../src/formats/scx', () => ({
  parseSCX: () => ({ width: 320, height: 200, pixels: new Uint8Array(320 * 200).fill(2) }),
}));

// ---- synthetic fixtures ----------------------------------------------------

type HotspotSpec = Partial<Hotspot>;

const hotspot = (index: number, spec: HotspotSpec = {}): Hotspot => ({
  index,
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  chapterMask: 0,
  keyword: 1,
  action: HotspotAction.Dialog,
  unknownD: 0,
  arg1: 0,
  arg2: 0,
  arg3: 0,
  tooltip: 0,
  unknown1a: 0,
  dialog: 0,
  checkEventState: 0,
  ...spec,
});

function gdsBytes(opts: { name?: string; temple?: number; flavour?: number; hotspots: HotspotSpec[] }): Uint8Array {
  const out = new Uint8Array(43 + HOTSPOT_SIZE * opts.hotspots.length);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, out.length, true);
  for (const [i, c] of [...(opts.name ?? 'T1').toUpperCase()].entries()) out[2 + i] = c.charCodeAt(0);
  out[14] = 0; // unknown_c
  out[15] = opts.temple ?? 0;
  dv.setUint16(19, 33, true); // song
  dv.setUint16(23, 4, true); // scene index 1
  dv.setUint16(27, 5, true); // scene index 2
  dv.setUint16(29, opts.hotspots.length, true);
  dv.setUint32(31, opts.flavour ?? 0x10000, true);
  opts.hotspots.forEach((spec, i) => {
    const h = hotspot(i, spec);
    const p = 43 + i * HOTSPOT_SIZE;
    dv.setUint16(p, h.x, true);
    dv.setUint16(p + 2, h.y, true);
    dv.setUint16(p + 4, h.width, true);
    dv.setUint16(p + 6, h.height, true);
    dv.setUint16(p + 8, h.chapterMask, true);
    dv.setUint16(p + 10, h.keyword, true);
    out[p + 12] = h.action;
    out[p + 13] = h.unknownD;
    dv.setUint16(p + 14, h.arg1, true);
    dv.setUint16(p + 16, h.arg2, true);
    dv.setUint32(p + 18, h.arg3, true);
    dv.setUint32(p + 22, h.tooltip, true);
    dv.setUint32(p + 26, h.unknown1a, true);
    dv.setUint32(p + 30, h.dialog, true);
    dv.setUint16(p + 34, h.checkEventState, true);
  });
  return out;
}

/** TTM with one uncompressed TT3 chunk. Ops are [code | count, ...int16 args] or a named string op. */
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
      args.forEach(u16);
    }
  }
  const tt3 = [0, body.length & 0xff, (body.length >> 8) & 0xff, 0, 0, ...body];
  const out = new Uint8Array(8 + tt3.length);
  out.set([0x54, 0x54, 0x33, 0x3a], 0); // "TT3:"
  new DataView(out.buffer).setUint32(4, tt3.length, true);
  out.set(tt3, 8);
  return out;
}

function palBytes(colours: Record<number, [number, number, number]>): Uint8Array {
  const out = new Uint8Array(8 + 768);
  out.set([0x56, 0x47, 0x41, 0x3a], 0); // "VGA:"
  new DataView(out.buffer).setUint32(4, 768, true);
  for (const [i, c] of Object.entries(colours)) out.set(c, 8 + Number(i) * 3);
  return out;
}

/** BMX 0x1066 with the whole blob stored as RLE literal runs. */
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
  dv.setUint16(2, 2, true); // RLE
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

const world = (): WorldState => ({
  chapter: 1,
  ticks: 0,
  ticksLastSlept: 0,
  bytes: new Uint8Array(GAM_OFFSETS.complexEventFlags + 0x800),
  expiringEvents: [],
});

// Op codes used by the fixtures.
const SET_SCRIPT = 0x1110;
const SLOT_IMAGE = 0x1050;
const SLOT_PALETTE = 0x1060;
const SPRITE = 0xa500;
const SPRITE_FLIP_X = 0xa520;
const LOAD_SCREEN = 0xf010;
const LOAD_IMAGE = 0xf020;
const LOAD_PALETTE = 0xf050;
const CLIP = 0x4000;
const SHOW_DIALOG = 0x2010;

// ---- GDS -------------------------------------------------------------------

describe('parseGds', () => {
  it('reads the header and every hotspot', () => {
    const gds = parseGds(
      gdsBytes({
        name: 'T1',
        temple: 0x85,
        flavour: 0x2468,
        hotspots: [
          {
            x: 10,
            y: 20,
            width: 30,
            height: 40,
            action: HotspotAction.Shop,
            arg2: 3,
            arg3: 0x1234,
            tooltip: 0x5678,
            chapterMask: 0x8001,
            checkEventState: 1,
            dialog: 0x00010345,
          },
          { action: HotspotAction.Exit },
        ],
      }),
    );
    expect(gds).toMatchObject({
      resource: 'T1',
      ttm: 'T1.TTM',
      ads: 'T1.ADS',
      song: 33,
      sceneIndex1: 4,
      sceneIndex2: 5,
      flavourText: 0x2468,
    });
    expect(templeNumber(gds)).toBe(5);
    expect(gds.hotspots).toHaveLength(2);
    expect(gds.hotspots[0]).toMatchObject({
      index: 0,
      x: 10,
      y: 20,
      width: 30,
      height: 40,
      action: HotspotAction.Shop,
      arg2: 3,
      arg3: 0x1234,
      tooltip: 0x5678,
      chapterMask: 0x8001,
      checkEventState: 1,
      dialog: 0x00010345,
    });
    expect(gds.hotspots[1]!.action).toBe(HotspotAction.Exit);
  });

  it('treats 0x10000 flavour text as none and a missing temple bit as not a temple', () => {
    const gds = parseGds(gdsBytes({ hotspots: [] }));
    expect(gds.flavourText).toBe(0);
    expect(templeNumber(gds)).toBeUndefined();
  });

  it('ignores a hotspot cut off by the end of the file', () => {
    const bytes = gdsBytes({ hotspots: [{}, {}] });
    expect(parseGds(bytes.subarray(0, bytes.length - 5)).hotspots).toHaveLength(1);
  });
});

describe('scene names', () => {
  it('numbers scene letters like the original (0 and 1 are both A)', () => {
    expect([0, 1, 2, 3].map(gdsLetter)).toEqual(['A', 'A', 'B', 'C']);
    expect(gdsFileName({ number: 12, letter: 'C' })).toBe('GDS12C.DAT');
  });

  it('tells dialogue keys from the none markers', () => {
    expect(hotspotHasDialog(hotspot(0, { arg3: 0 }))).toBe(false);
    expect(hotspotHasDialog(hotspot(0, { arg3: 0x10000 }))).toBe(false);
    expect(hotspotHasDialog(hotspot(0, { arg3: 0x1234 }))).toBe(true);
  });
});

describe('parseTownTable', () => {
  it('reads 22-byte entries', () => {
    const bytes = new Uint8Array(4 + 2 * TOWN_ENTRY_SIZE);
    const dv = new DataView(bytes.buffer);
    dv.setUint32(0, 2, true);
    bytes[4 + 3] = 7; // gds number
    bytes[4 + 4] = 3; // letter index -> C
    dv.setUint32(4 + 7, 0x1111, true);
    dv.setUint32(4 + 11, 0x2222, true);
    bytes[4 + 15] = 5;
    bytes[4 + 16] = 6;
    dv.setUint16(4 + 17, 0x4000, true);
    bytes[4 + 19] = 1;
    const [a, b] = parseTownTable(bytes);
    expect(a).toEqual({
      ref: { number: 7, letter: 'C' },
      entryDialog: 0x1111,
      exitDialog: 0x2222,
      exitCellX: 5,
      exitCellY: 6,
      exitHeading: 0x4000,
      walkToDest: true,
    });
    expect(b!.walkToDest).toBe(false);
  });

  it('clamps a count that runs past the file', () => {
    const bytes = new Uint8Array(4 + TOWN_ENTRY_SIZE);
    new DataView(bytes.buffer).setUint32(0, 9, true);
    expect(parseTownTable(bytes)).toHaveLength(1);
  });

  it('places the party outside the door in the encounter tile', () => {
    const bytes = new Uint8Array(4 + TOWN_ENTRY_SIZE);
    bytes.set([1, 0, 0, 0], 0);
    bytes.set([2, 3, 0, 0x40], 4 + 15);
    const [e] = parseTownTable(bytes);
    const d = townExit(e!, 4, 5);
    expect(d.x).toBe(4 * TILE_SIZE + 2 * CELL_SIZE + CELL_SIZE / 2);
    expect(d.y).toBe(5 * TILE_SIZE + 3 * CELL_SIZE + CELL_SIZE / 2);
    expect(d.heading).toBe(0x40);
    expect(d.zone).toBeUndefined();
  });
});

// ---- TTM and ADS -----------------------------------------------------------

describe('parseTtm', () => {
  const ttm = parseTtm(
    ttmBytes([
      [SET_SCRIPT, 7],
      [SLOT_PALETTE, 0],
      [LOAD_PALETTE, 'town.pal'],
      [SLOT_IMAGE, 1],
      [LOAD_IMAGE, 'SPR.BMP'],
      [LOAD_SCREEN, 'BACK.SCR'],
      [CLIP, 1, 2, 30, 40],
      [SPRITE, 10, 20, 0, 1],
      [SPRITE_FLIP_X, 5, 6, 1, 1, 64, 32],
      [SHOW_DIALOG, -1, 0],
      [SET_SCRIPT, 8],
      [SPRITE, 1, 1, 0, 1],
    ]),
  );

  it('splits scripts at each set-script op', () => {
    expect([...ttm.keys()]).toEqual([7, 8]);
    expect(ttm.get(8)!.ops).toHaveLength(1);
  });

  it('collects palettes, image sets and the screen under their slots, naming packed twins', () => {
    const s = ttm.get(7)!;
    expect(s.palettes.get(0)).toBe('TOWN.PAL');
    expect(s.images.get(1)).toEqual({ name: 'SPR.BMX', palette: 0 });
    expect(s.screen).toEqual({ name: 'BACK.SCX', palette: 0 });
    expect(scriptResourceNames([s]).sort()).toEqual(['BACK.SCX', 'SPR.BMX', 'TOWN.PAL']);
  });

  it('decodes clips, plain and scaled flipped sprites, and the actor marker', () => {
    const ops = ttm.get(7)!.ops;
    expect(ops).toContainEqual({ op: 'clip', x: 1, y: 2, right: 30, bottom: 40 });
    expect(ops).toContainEqual({
      op: 'sprite',
      x: 10,
      y: 20,
      index: 0,
      slot: 1,
      width: 0,
      height: 0,
      flipX: false,
      flipY: false,
    });
    expect(ops).toContainEqual({
      op: 'sprite',
      x: 5,
      y: 6,
      index: 1,
      slot: 1,
      width: 64,
      height: 32,
      flipX: true,
      flipY: false,
    });
    expect(ops).toContainEqual({ op: 'actor' });
  });

  it('rejects a file without a TT3 chunk', () => {
    expect(() => parseTtm(new Uint8Array(16))).toThrow(/TT3/);
  });
});

describe('ADS scene selection', () => {
  const u16s = (...v: number[]) => Uint8Array.from(v.flatMap((n) => [n & 0xff, n >> 8]));
  const scenes = decodeAds(
    u16s(
      5,
      0x13b0,
      2,
      0x2005,
      0,
      7,
      0,
      0,
      0x1500,
      0x2005,
      0,
      8,
      0,
      0,
      0x1520,
      0xffff,
      6,
      0x1030,
      1,
      3,
      0x2005,
      0,
      9,
      0,
      0,
      0x1520,
      0xffff,
    ),
  );

  it('groups conditions and branches into blocks', () => {
    expect(scenes.map((s) => s.index)).toEqual([5, 6]);
    expect(scenes[0]!.blocks[0]).toEqual({
      conditions: [{ kind: 'chapterGte', chapter: 2 }],
      then: [{ kind: 'start', script: 7 }],
      else: [{ kind: 'start', script: 8 }],
    });
  });

  it('picks the branch by chapter', () => {
    expect(selectScript(scenes, 5, 1)).toBe(8);
    expect(selectScript(scenes, 5, 3)).toBe(7);
  });

  it('counts played-state tests as true and reports unknown scenes as none', () => {
    expect(selectScript(scenes, 6, 1)).toBe(9);
    expect(selectScript(scenes, 99, 1)).toBeUndefined();
  });
});

// ---- Compositing -----------------------------------------------------------

describe('composeScene', () => {
  const files = new Map<string, Uint8Array>([
    ['T.PAL', palBytes({ 1: [63, 0, 0], 2: [0, 63, 0], 3: [0, 0, 63] })],
    [
      'SPR.BMX',
      bmxBytes([
        { width: 2, height: 1, pixels: [1, 3] },
        { width: 1, height: 1, pixels: [0] },
      ]),
    ],
    ['BACK.SCX', new Uint8Array(1)],
  ]);
  const read = (n: string) => files.get(n);
  const px = (img: { rgba: Uint8ClampedArray }, x: number, y: number) => [
    ...img.rgba.subarray((y * SCENE_WIDTH + x) * 4, (y * SCENE_WIDTH + x) * 4 + 4),
  ];
  const script = (...ops: Op[]) => [
    ...parseTtm(
      ttmBytes([
        [SET_SCRIPT, 1],
        [SLOT_PALETTE, 0],
        [LOAD_PALETTE, 'T.PAL'],
        [SLOT_IMAGE, 1],
        [LOAD_IMAGE, 'SPR.BMP'],
        ...ops,
      ]),
    ).values(),
  ];

  it('draws the sprite with the palette, leaving index 0 transparent', () => {
    const img = composeScene(script([SPRITE, 10, 20, 0, 1]), read);
    expect(img.width).toBe(SCENE_WIDTH);
    expect(img.height).toBe(SCENE_HEIGHT);
    expect(px(img, 10, 20)).toEqual([255, 0, 0, 255]);
    expect(px(img, 11, 20)).toEqual([0, 0, 255, 255]);
    expect(px(img, 12, 20)).toEqual([0, 0, 0, 255]);
  });

  it('transparent sprite pixels keep what is underneath', () => {
    const img = composeScene(script([LOAD_SCREEN, 'BACK.SCR'], [SPRITE, 0, 0, 1, 1]), read);
    expect(px(img, 0, 0)).toEqual([0, 255, 0, 255]);
  });

  it('flips and scales sprites', () => {
    const flipped = composeScene(script([SPRITE_FLIP_X, 10, 20, 0, 1]), read);
    expect(px(flipped, 10, 20)).toEqual([0, 0, 255, 255]);
    const scaled = composeScene(script([SPRITE, 0, 0, 0, 1, 4, 2]), read);
    expect([px(scaled, 0, 0), px(scaled, 1, 1), px(scaled, 2, 0), px(scaled, 3, 1)]).toEqual([
      [255, 0, 0, 255],
      [255, 0, 0, 255],
      [0, 0, 255, 255],
      [0, 0, 255, 255],
    ]);
  });

  it('clips sprites to the clip region', () => {
    const img = composeScene(script([CLIP, 0, 0, 11, 100], [SPRITE, 10, 20, 0, 1]), read);
    expect(px(img, 10, 20)).toEqual([255, 0, 0, 255]);
    expect(px(img, 11, 20)).toEqual([0, 0, 0, 255]);
  });

  it('draws the actor image centred above the 112th row', () => {
    const img = composeScene(script([SLOT_IMAGE, 1], [SHOW_DIALOG, -1, 0]), read);
    expect(px(img, 159, 111)).toEqual([255, 0, 0, 255]);
  });

  it('skips missing resources instead of failing', () => {
    const img = composeScene(script([LOAD_SCREEN, 'GONE.SCR'], [SPRITE, 10, 20, 0, 1]), () => undefined);
    expect(px(img, 10, 20)).toEqual([0, 0, 0, 255]);
  });
});

// ---- Hotspot availability --------------------------------------------------

describe('hotspotActive', () => {
  it('hides a hotspot in chapters whose mask bit is set', () => {
    const h = hotspot(0, { chapterMask: 0b100 });
    expect(hotspotActive(h, world(), 1)).toBe(true);
    expect(hotspotActive(h, world(), 3)).toBe(false);
  });

  it('tests an event flag against the expected value when a condition is set', () => {
    const h = hotspot(0, { checkEventState: 1, dialog: (1 << 16) | 0x300, chapterMask: 0xffff });
    expect(hotspotActive(h, world(), 1)).toBe(false);
    expect(hotspotActive(h, setFlag(world(), 0x300, true), 1)).toBe(true);
    const off = hotspot(0, { checkEventState: 1, dialog: 0x300 });
    expect(hotspotActive(off, world(), 1)).toBe(true);
  });

  it('ignores the flag condition when the pointer is not a flag', () => {
    const h = hotspot(0, { checkEventState: 1, dialog: (1 << 16) | 0x7530, chapterMask: 0 });
    expect(hotspotActive(h, world(), 1)).toBe(true);
  });

  it('marks hotspots that run when the scene opens', () => {
    expect(runsImmediately(hotspot(0, { chapterMask: 0x8000 }))).toBe(true);
    expect(runsImmediately(hotspot(0))).toBe(false);
  });
});

// ---- Controller ------------------------------------------------------------

describe('actionAfterDialog', () => {
  it('maps the end-of-dialogue state to a follow-up action and otherwise keeps the clicked one', () => {
    expect(actionAfterDialog(-4, HotspotAction.Shop)).toBe(HotspotAction.Exit);
    expect(actionAfterDialog(-3, HotspotAction.Shop)).toBe(HotspotAction.Inn);
    expect(actionAfterDialog(-2, HotspotAction.Shop)).toBe(HotspotAction.Barmaid);
    expect(actionAfterDialog(-5, HotspotAction.Shop)).toBe(HotspotAction.Repair2);
    expect(actionAfterDialog(-1, HotspotAction.Shop)).toBe(HotspotAction.Unknown0);
    expect(actionAfterDialog(undefined, HotspotAction.Shop)).toBe(HotspotAction.Shop);
    expect(actionAfterDialog(3, HotspotAction.Shop)).toBe(HotspotAction.Shop);
  });
});

describe('TownController', () => {
  const sceneFor = (letter: string, hotspots: Hotspot[]) => ({
    ref: { number: 1, letter },
    gds: {
      resource: 'T1',
      ttm: 'T1.TTM',
      ads: 'T1.ADS',
      templeIndex: 0,
      song: 0,
      sceneIndex1: 0,
      sceneIndex2: 0,
      flavourText: 0,
      hotspots,
    },
    image: { width: SCENE_WIDTH, height: SCENE_HEIGHT, rgba: new Uint8ClampedArray(SCENE_WIDTH * SCENE_HEIGHT * 4) },
  });

  function setup(scenes: Record<string, Hotspot[]>) {
    const log: string[] = [];
    const pending: ((end: DialogEnd) => void)[] = [];
    const unsupported: number[] = [];
    const hooks: TownHooks = {
      load: async (ref) => sceneFor(ref.letter, scenes[ref.letter] ?? []),
      show: (s) => log.push(`show ${s.ref.letter}`),
      hide: () => log.push('hide'),
      playDialog: (key, done) => {
        log.push(`dialog ${key.toString(16)}`);
        pending.push(done);
      },
      activeHotspots: (s) => s.gds.hotspots,
      left: () => log.push('left'),
      unsupported: (a) => unsupported.push(a),
    };
    return { controller: new TownController(hooks), log, pending, unsupported };
  }

  it('plays a hotspot dialogue, then leaves on an exit action', async () => {
    const exit = hotspot(0, { action: HotspotAction.Exit, arg3: 0x10 });
    const t = setup({ A: [exit] });
    await t.controller.enter({ number: 1, letter: 'A' });
    t.controller.click(exit);
    expect(t.log).toEqual(['show A', 'dialog 10']);
    t.pending[0]!({ cancelled: false, endState: undefined });
    expect(t.log).toEqual(['show A', 'dialog 10', 'hide', 'left']);
    expect(t.controller.active).toBe(false);
  });

  it('acts at once when the hotspot has no dialogue', async () => {
    const exit = hotspot(0, { action: HotspotAction.Exit, arg3: 0x10000 });
    const t = setup({ A: [exit] });
    await t.controller.enter({ number: 1, letter: 'A' });
    t.controller.click(exit);
    expect(t.log).toEqual(['show A', 'hide', 'left']);
  });

  it('ignores clicks while a dialogue is open and a cancelled dialogue does nothing further', async () => {
    const exit = hotspot(0, { action: HotspotAction.Exit, arg3: 0x10 });
    const t = setup({ A: [exit] });
    await t.controller.enter({ number: 1, letter: 'A' });
    t.controller.click(exit);
    t.controller.click(exit);
    expect(t.pending).toHaveLength(1);
    t.pending[0]!({ cancelled: true, endState: undefined });
    expect(t.controller.active).toBe(true);
  });

  it('uses the dialogue end state to pick the follow-up action', async () => {
    const shop = hotspot(0, { action: HotspotAction.Shop, arg3: 0x10 });
    const t = setup({ A: [shop] });
    await t.controller.enter({ number: 1, letter: 'A' });
    t.controller.click(shop);
    t.pending[0]!({ cancelled: false, endState: undefined });
    expect(t.unsupported).toEqual([HotspotAction.Shop]);
    t.controller.click(shop);
    t.pending[1]!({ cancelled: false, endState: -4 });
    expect(t.controller.active).toBe(false);
  });

  it('goes to another scene of the same town', async () => {
    const go = hotspot(0, { action: HotspotAction.Goto, arg1: 3 });
    const t = setup({ A: [go], C: [] });
    await t.controller.enter({ number: 1, letter: 'A' });
    t.controller.click(go);
    await Promise.resolve();
    await Promise.resolve();
    expect(t.log).toEqual(['show A', 'show C']);
    expect(t.controller.current?.ref).toEqual({ number: 1, letter: 'C' });
  });

  it('runs a hotspot flagged to act on entry', async () => {
    const auto = hotspot(0, { action: HotspotAction.Exit, chapterMask: 0x8000 });
    const t = setup({ A: [auto] });
    await t.controller.enter({ number: 1, letter: 'A' });
    expect(t.log).toEqual(['show A', 'hide', 'left']);
  });

  it('shows the tooltip dialogue on a right click, and dismiss closes without leaving', async () => {
    const h = hotspot(0, { tooltip: 0x20 });
    const t = setup({ A: [h] });
    await t.controller.enter({ number: 1, letter: 'A' });
    t.controller.describe(h);
    expect(t.log).toContain('dialog 20');
    t.pending[0]!({ cancelled: false, endState: undefined });
    t.controller.describe(hotspot(1)); // no tooltip
    expect(t.pending).toHaveLength(1);
    t.controller.dismiss();
    expect(t.log.slice(-1)).toEqual(['hide']);
  });
});

// ---- Screen ----------------------------------------------------------------

describe('town screen', () => {
  const layout = layoutTownScreen(2560, 1440);

  it('fits the 320x200 picture in the canvas and centres it', () => {
    expect(layout.scale).toBeCloseTo(7.2);
    expect(layout.height).toBeCloseTo(1440);
    expect(layout.x).toBeCloseTo((2560 - 2304) / 2);
    expect(toScenePoint(layout, layout.x + 72, layout.y + 36)).toEqual([10, 5]);
  });

  it('finds the hotspot under the pointer', () => {
    const a = hotspot(0, { x: 10, y: 10, width: 20, height: 20 });
    const b = hotspot(1, { x: 100, y: 50, width: 20, height: 20 });
    expect(hotspotAt(layout, [a, b], layout.x + 15 * 7.2, layout.y + 15 * 7.2)).toBe(a);
    expect(hotspotAt(layout, [a, b], layout.x + 110 * 7.2, layout.y + 60 * 7.2)).toBe(b);
    expect(hotspotAt(layout, [a, b], layout.x + 50 * 7.2, layout.y + 15 * 7.2)).toBeUndefined();
    expect(hotspotAt(layout, [a, b], 2, 2)).toBeUndefined();
  });

  it('tracks hover and reports clicks and tooltip requests', () => {
    const a = hotspot(0, { x: 10, y: 10, width: 20, height: 20 });
    const over = { x: layout.x + 15 * 7.2, y: layout.y + 15 * 7.2 };
    let r = stepTown(layout, [a], initialTownState(), { type: 'hover', ...over });
    expect(r.state.hover).toBe(a);
    expect(r.result.kind).toBe('none');
    r = stepTown(layout, [a], r.state, { type: 'click', ...over });
    expect(r.result).toEqual({ kind: 'click', hotspot: a });
    r = stepTown(layout, [a], r.state, { type: 'rightClick', ...over });
    expect(r.result).toEqual({ kind: 'describe', hotspot: a });
    r = stepTown(layout, [a], r.state, { type: 'click', x: 1, y: 1 });
    expect(r.state.hover).toBeUndefined();
    expect(r.result.kind).toBe('none');
  });
});
