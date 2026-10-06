// Probe zone 1 data to verify docs/formats/zones-and-models.md against real files.
import { readFileSync } from 'node:fs';
import { ResourceArchive } from '../src/formats/archive';
import { Reader } from '../src/formats/reader';
import { findTag } from '../src/formats/tagged';

const D = process.env.BAK_DIR ?? 'C:/Program Files (x86)/GOG Galaxy/Games/Betrayal at Krondor';
const a = new ResourceArchive(readFileSync(`${D}/KRONDOR.RMF`), readFileSync(`${D}/KRONDOR.001`));
const hex = (b: Uint8Array, n = 32) => [...b.subarray(0, n)].map((x) => x.toString(16).padStart(2, '0')).join(' ');

console.log('Z01 files:', a.entries.filter((e) => /^Z01/.test(e.name)).map((e) => `${e.name}(${e.size})`).join(' '));
console.log('CHAP/ZONE:', a.entries.filter((e) => /^(CHAP|ZONE)/.test(e.name)).map((e) => e.name).join(' '));

const tbl = a.get('Z01.TBL');
const tags: string[] = [];
for (let i = 0; i + 4 <= tbl.length; i++) {
  const s = String.fromCharCode(tbl[i]!, tbl[i + 1]!, tbl[i + 2]!, tbl[i + 3]!);
  if (/^[A-Z]{3}:$/.test(s)) tags.push(`${s}@${i}`);
}
console.log('TBL tags:', tags.join(' '));
const map = new Reader(findTag(tbl, 'MAP:')!);
map.skip(2);
const count = map.u16();
const offs = Array.from({ length: count }, () => map.u16());
map.skip(2);
const start = map.pos;
const names = offs.map((o) => {
  let s = '';
  for (let p = start + o; map.bytes[p]; p++) s += String.fromCharCode(map.bytes[p]!);
  return s;
});
console.log(`MAP: ${count} names:`, names.join(','));

const ref = a.get('Z01REF.DAT');
console.log('REF len', ref.length, 'count', ref[0], 'first tiles', Array.from({ length: Math.min(8, ref[0]!) }, (_, i) => `${ref[1 + i * 2]},${ref[2 + i * 2]}`).join(' '));

const firstTile = `T01${String(ref[1]).padStart(2, '0')}${String(ref[2]).padStart(2, '0')}.WLD`;
const wld = a.get(firstTile);
console.log(firstTile, 'len', wld.length, 'len%20', wld.length % 20);
const r = new Reader(wld);
for (let i = 0; i < Math.min(6, wld.length / 20); i++) {
  const rec = { type: r.u16(), xr: r.u16(), yr: r.u16(), zr: r.u16(), x: r.u32(), y: r.u32(), z: r.u32() };
  console.log('  ', JSON.stringify(rec), names[rec.type]);
}
for (const n of ['CHAP1.DAT', 'Z01DEF.DAT', 'ZONE.DAT']) if (a.has(n)) console.log(n, a.get(n).length, hex(a.get(n), 40));
