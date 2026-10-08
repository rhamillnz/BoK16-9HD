import * as fs from 'fs';
let data = fs.readFileSync('src/e2e/syntheticData.ts', 'utf8');

const additions = `
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
    dv.setUint32(6 + i * 8, offsets[idx], true);
  });
  specs.forEach((s, i) => {
    let p = offsets[i];
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
      dv.setUint32(p + 6, c.target === 0 ? 0 : c.target > KEY ? c.target : offsets[c.target], true);
      p += 10;
    }
    for (const a of s.actions ?? []) {
      dv.setUint16(p, a.type, true);
      dv.setUint16(p + 2, a.words?.[0] ?? 0, true);
      dv.setUint16(p + 4, a.words?.[1] ?? 0, true);
      dv.setUint32(p + 6, a.target === 0 ? 0 : a.target > KEY ? a.target : offsets[a.target], true);
      p += 10;
    }
    if (s.text) out.set([...s.text].map((c) => c.charCodeAt(0)), p);
  });
  return out;
}

import { ResourceArchive } from '../formats/archive';

export function syntheticArchive(): ResourceArchive {
  const arc = new ResourceArchive(new Uint8Array(), new Uint8Array());
  const map = new Map<string, Uint8Array>();
  
  // Basic files
  map.set('GAME.FNT', new Uint8Array()); // will be overridden in mountHud
  map.set('OBJINFO.DAT', new Uint8Array(48 * 256)); // empty item defs
  map.set('HEADS.BMX', new Uint8Array()); 
  map.set('OPTIONS.PAL', new Uint8Array(768));
  
  // Encounter setup
  // Zone 1 tile (0, 0)
  map.set('Z01R0000.DAT', syntheticTileFile([
    [], // chapter 0 unused
    [
      { type: 2, l: 120, t: 120, r: 140, b: 140, idx: 0 }, // Dialog trigger
    ], // chapter 1
  ]));
  
  map.set('DIAL_Z01.DDX', syntheticDDX([
    { key: 1, text: 'Hello traveler.', style3: 0, choices: [{ state: 3, target: 1 }] },
    { text: 'Goodbye.', style3: 1 }
  ]));
  
  map.set('DEF_DIAL.DAT', new Uint8Array(0));
  map.set('DEF_BLOC.DAT', new Uint8Array(0));
  map.set('DEF_ZONE.DAT', new Uint8Array(0));
  map.set('DEF_TOWN.DAT', new Uint8Array(0));
  map.set('DEF_BKGR.DAT', new Uint8Array(0));
  map.set('TELEPORT.DAT', new Uint8Array(0));
  map.set('KEYWORD.DAT', new Uint8Array(0));
  
  // Setup override for arc.get
  arc.has = (name) => map.has(name);
  arc.get = (name) => map.get(name) || new Uint8Array();
  return arc;
}
`;
fs.writeFileSync('src/e2e/syntheticData.ts', data + '\n' + additions);
