import type { Font, Glyph } from '../formats/fnt';
import { CHARACTER_SKILL_STRIDE, GAM_OFFSETS as O, parseGam, type GamSave } from '../formats/gam';
import type { Face, Model } from '../formats/tbl';
import type { ZoneData } from '../world/zone';

/**
 * Hand-built stand-ins for the original game data, so the end-to-end smoke tests run anywhere
 * (CI has no BaK install). Nothing here is copied from the game; it only has the right shapes.
 */

/** A plain 4x6 block font covering printable ASCII. */
export function syntheticFont(): Font {
  const glyphs: Glyph[] = [];
  for (let code = 32; code < 127; code++)
    glyphs.push({ code, width: 4, height: 6, pixels: new Uint8Array(24).fill(code === 32 ? 0 : 1) });
  return { version: 0xff, maxWidth: 4, height: 6, baseline: 5, firstChar: 32, glyphs };
}

/** A save image with Owyn and Pug active, 500 gold and ordinary skills. */
export function syntheticSave(): GamSave {
  const SHOPS_OFFSET = 0x443c9;
  const b = new Uint8Array(SHOPS_OFFSET + 200);
  const v = new DataView(b.buffer);
  v.setUint16(O.chapter, 1, true);
  v.setUint16(O.chapterCopy, 1, true);
  v.setUint32(O.gold, 500, true);
  v.setUint32(O.time, 6 * 1800, true);
  [
    ['Owyn', 0],
    ['Pug', 1],
  ].forEach(([name, index]) => {
    b.set(
      [...(name as string)].map((c) => c.charCodeAt(0)),
      O.characterName + (index as number) * 10,
    );
    const s = O.characterSkills + (index as number) * CHARACTER_SKILL_STRIDE;
    for (let skill = 0; skill < 16; skill++) b.set([50, 40, 40, 0, 0], s + 8 + skill * 5);
    b[O.characterConditions + 7 * (index as number)] = 0;
    v.setUint16(O.characterInventory + 0x70 * (index as number) + 1, 24, true);
  });
  b[O.activeCharacters] = 2;
  b.set([0, 1], O.activeCharacters + 1);
  v.setUint16(O.partyKeys + 1, 8, true);

  // Shop container 1A
  let r = SHOPS_OFFSET;
  v.setUint32(r + 4, 1, true); // number
  v.setUint32(r + 8, 1, true); // letter 'A'
  b[r + 13] = 1; // itemCount
  b[r + 14] = 10; // capacity
  b[r + 15] = 0x04; // flags = Shop

  b[r + 16] = 1; // itemIndex
  b[r + 17] = 1; // conditionOrQuantity
  b[r + 18] = 0; // status
  b[r + 19] = 0; // modifiers

  b[r + 21] = 100; // sellFactor
  b[r + 23] = 100; // buyFactor

  return parseGam(b);
}

const SPAN = 4800;
const quad = (z: number, half: number): number[] => [-half, -half, z, half, -half, z, half, half, z, -half, half, z];

const model = (name: string, extra: Partial<Model>): Model => ({
  name,
  flags: 0,
  entityType: 0,
  terrainType: 0,
  scale: 0,
  radius: 128,
  vertices: [],
  faces: [],
  frames: 1,
  ...extra,
});

/**
 * One flat grass tile with a stone block and a tree sprite on it. Palette entries 1..3 are
 * green, grey and brown; the tree sprite is a 16x24 brown-and-green bitmap.
 */
export function syntheticZone(): ZoneData {
  const palette = new Uint8Array(256 * 4);
  const colour = (i: number, r: number, g: number, bl: number) => palette.set([r, g, bl, 255], i * 4);
  colour(1, 70, 140, 60);
  colour(2, 150, 150, 160);
  colour(3, 110, 70, 40);
  const face = (color: number, indices: number[]): Face => ({ material: 0, color, indices });
  const ground = model('ground', { vertices: quad(0, SPAN / 2), faces: [face(1, [0, 1, 2, 3])] });
  const block = model('block', {
    vertices: [...quad(0, 150), ...quad(300, 150)],
    faces: [
      face(2, [4, 5, 6, 7]),
      face(2, [0, 1, 5, 4]),
      face(2, [1, 2, 6, 5]),
      face(2, [2, 3, 7, 6]),
      face(2, [3, 0, 4, 7]),
    ],
  });
  const tree = model('tree', { radius: 128, sprite: { index: 0, offsetX: 0, offsetY: 0, baseVertex: 0, scale: 256 } });
  const treePixels = new Uint8Array(16 * 24);
  for (let y = 0; y < 24; y++)
    for (let x = 0; x < 16; x++) treePixels[y * 16 + x] = y < 14 ? (x > 1 && x < 14 ? 1 : 0) : x > 6 && x < 10 ? 3 : 0;
  const item = (type: number, x: number, y: number) => ({ type, xRot: 0, yRot: 0, zRot: 0, x, y, z: 0 });
  return {
    zone: 1,
    palette,
    table: { models: [ground, block, tree], clips: [] },
    items: [item(0, 0, 0), item(1, 800, 800), item(2, -600, 900), item(2, 600, 1500), item(2, -900, -400)],
    slotImages: [{ width: 16, height: 24, pixels: treePixels }],
    terrain: [],
    tiles: [[0, 0]],
  } as unknown as ZoneData;
}


import { ENCOUNTER_BLOCK_SIZE } from '../formats/encounters';

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

export function syntheticTileFile(chapters: Rec[][]): Uint8Array {
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

const KEY = 0x10000000;
const HEADER = 9;

export interface SnipSpec {
  key?: number;
  text?: string;
  style3?: number;
  choices?: { state: number; min?: number; max?: number; target: number }[];
  actions?: { type: number; words?: number[]; target?: number }[];
}

export function syntheticDDX(specs: SnipSpec[]): Uint8Array {
  const keyed = specs.flatMap((s, i) => (s.key === undefined ? [] : [[s.key, i] as const]));
  const sizes = specs.map(
    (s) => HEADER + (s.choices?.length ?? 0) * 10 + (s.actions?.length ?? 0) * 10 + (s.text?.length ?? 0),
  );
  const offsets: number[] = [];
  let at = 2 + 8 * keyed.length;
  for (const size of sizes) {
    offsets.push(at);
    at += size;
  }
  const out = new Uint8Array(at);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, keyed.length, true);
  keyed.forEach(([key, idx], i) => {
    dv.setUint32(2 + i * 8, key, true);
    dv.setUint32(6 + i * 8, offsets[idx]!, true);
  });
  specs.forEach((s, i) => {
    let p = offsets[i]!;
    out[p] = 2; // style 2 (dialogue box)
    dv.setUint16(p + 1, 0, true); // actor
    out[p + 3] = 0;
    out[p + 4] = s.style3 ?? 0;
    out[p + 5] = s.choices?.length ?? 0;
    out[p + 6] = s.actions?.length ?? 0;
    dv.setUint16(p + 7, s.text?.length ?? 0, true);
    p += 9;
    for (const c of s.choices ?? []) {
      dv.setUint16(p, c.state, true);
      dv.setUint16(p + 2, c.min ?? 0, true);
      dv.setUint16(p + 4, c.max ?? 0, true);
      dv.setUint32(p + 6, c.target === 0 ? 0 : c.target > KEY ? c.target : offsets[c.target]!, true);
      p += 10;
    }
    for (const a of s.actions ?? []) {
      dv.setUint16(p, a.type, true);
      dv.setUint16(p + 2, a.words?.[0] ?? 0, true);
      dv.setUint16(p + 4, a.words?.[1] ?? 0, true);
      dv.setUint32(p + 6, (a.target ?? 0) === 0 ? 0 : a.target! > KEY ? a.target! : offsets[a.target!]!, true);
      p += 10;
    }
    if (s.text) out.set([...s.text].map((c) => c.charCodeAt(0)), p);
  });
  return out;
}

import { ResourceArchive } from '../formats/archive';

function table(recordSize: number, writes: ((dv: DataView) => void)[]): Uint8Array {
  const out = new Uint8Array(4 + writes.length * recordSize);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, writes.length, true);
  writes.forEach((w, i) => {
    const p = 4 + i * recordSize;
    w(new DataView(out.buffer, p, recordSize));
  });
  return out;
}

function syntheticGDS(resource: string, hotspots: any[]): Uint8Array {
  const out = new Uint8Array(43 + hotspots.length * 36);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, out.length, true);
  for (let i = 0; i < 6; i++) out[2 + i] = resource.charCodeAt(i) || 0;
  dv.setUint16(29, hotspots.length, true);
  hotspots.forEach((h, i) => {
    let p = 43 + i * 36;
    dv.setUint16(p, h.x ?? 0, true);
    dv.setUint16(p + 2, h.y ?? 0, true);
    dv.setUint16(p + 4, h.width ?? 10, true);
    dv.setUint16(p + 6, h.height ?? 10, true);
    out[p + 12] = h.action ?? 0;
  });
  return out;
}

export function syntheticArchive(): ResourceArchive {
  const rmf = new Uint8Array(21);
  const dv = new DataView(rmf.buffer);
  dv.setUint32(0, 1, true);
  dv.setUint16(4, 4, true);
  // count at offset 19 is 0
  const arc = new ResourceArchive(rmf, new Uint8Array());
  const map = new Map<string, Uint8Array>();
  
  // Basic files
  map.set('GAME.FNT', new Uint8Array()); // will be overridden in mountHud
  map.set('OBJINFO.DAT', new Uint8Array(48 * 256)); // empty item defs
  map.set('HEADS.BMX', new Uint8Array()); 
  map.set('OPTIONS.PAL', new Uint8Array(768));
  
    // Encounter setup
  // Zone 1 tile (0, 0)
  map.set('T010000.DAT', syntheticTileFile([
    [
      { type: 3, l: 10, t: 10, r: 15, b: 15, idx: 0 }, // Dialog trigger (x: 16000)
      { type: 6, l: 20, t: 20, r: 25, b: 25, idx: 0 }, // Town trigger (x: 32000)
      { type: 1, l: 30, t: 30, r: 35, b: 35, idx: 0 }, // Combat trigger (x: 48000)
      { type: 8, l: 10, t: 30, r: 15, b: 35, idx: 0 }, // Zone trigger (x: 16000, y: 48000)
    ],
  ]));
  
  map.set('DIAL_Z01.DDX', syntheticDDX([
    { key: 1, text: 'Hello traveler.', style3: 0, choices: [{ state: 3, target: 1 }] },
    { text: 'Goodbye.', style3: 1 }
  ]));
  
  map.set('DEF_DIAL.DAT', table(9, [
    dv => dv.setUint32(3, 1, true)
  ]));
  
  map.set('DEF_TOWN.DAT', table(22, [
    dv => {
      dv.setUint8(3, 1);
      dv.setUint8(4, 1); // 1A
    }
  ]));
  
  map.set('DEF_ZONE.DAT', table(20, [
    dv => dv.setUint8(3, 2) // zone 2
  ]));
  
  map.set('DEF_COMB.DAT', table(400, [
    dv => {
      dv.setUint32(19, 1000, true);
      dv.setUint32(29, 1000, true);
      dv.setUint32(39, 1000, true);
      dv.setUint32(49, 1000, true);
      dv.setUint8(59, 1);
    }
  ]));

  map.set('GDS1A.DAT', syntheticGDS('TOWN1A', [
    { x: 10, y: 10, width: 50, height: 50, action: 6 }, // Shop
    { x: 100, y: 100, width: 50, height: 50, action: 3 } // Exit town
  ]));
  
  map.set('DEF_BLOC.DAT', table(9, []));
  map.set('DEF_BKGR.DAT', table(22, []));
  map.set('TELEPORT.DAT', table(24, []));
  map.set('KEYWORD.DAT', new Uint8Array([2, 0, 2, 0])); // Valid empty keyword table
  const objFixed = new Uint8Array(60);
  const fixedDv = new DataView(objFixed.buffer);
  fixedDv.setUint16(2, 1, true); // 1 container
  objFixed[4] = 1; // zone 1
  objFixed[5] = 0x16; // chapters 1-6
  fixedDv.setUint32(8, 0, true); // x = 0
  fixedDv.setUint32(12, 0, true); // y = 0
  objFixed[17] = 1; // count = 1
  objFixed[18] = 10; // capacity = 10
  objFixed[20] = 1; // itemIndex = 1
  objFixed[21] = 1; // condition = 1
  map.set('OBJFIXED.DAT', objFixed);
  for (let i = 0; i < 10; i++) {
    map.set(`DIAL_0${i}.DDX`, new Uint8Array([0, 0]));
  }
  
  map.set('TOWN1A.TTM', new Uint8Array([84, 84, 51, 58, 5, 0, 0, 0, 0, 0, 0, 0, 0])); // TT3: len=5 uncompressed empty
  map.set('TOWN1A.ADS', new Uint8Array([83, 67, 82, 58, 5, 0, 0, 0, 2, 0, 0, 0, 0])); // SCR: len=5 LZW empty
  
  // Setup override for arc.get
  arc.has = (name) => map.has(name) || name.startsWith('DIAL_');
  arc.get = (name) => map.get(name) || new Uint8Array([0, 0]);
  return arc;
}



