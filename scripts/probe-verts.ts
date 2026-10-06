import { readFileSync } from 'node:fs';
import { ResourceArchive } from '../src/formats/archive';
import { Reader } from '../src/formats/reader';
import { requireTag } from '../src/formats/tagged';
import { parseTBL } from '../src/formats/tbl';
const D = 'C:/Program Files (x86)/GOG Galaxy/Games/Betrayal at Krondor';
const a = new ResourceArchive(readFileSync(`${D}/KRONDOR.RMF`), readFileSync(`${D}/KRONDOR.001`));
const bytes = a.get('Z01.TBL'); const t = parseTBL(bytes); const dat = requireTag(bytes, 'DAT:');
const name = process.argv[2] ?? 'inn'; const idx = t.names.indexOf(name);
const hr = new Reader(dat, idx * 4); const lo = hr.u16(), up = hr.u16(); const off = (up << 4) + (lo & 15);
const r = new Reader(dat, off); const flags = r.u8(); r.skip(3); r.skip(4); const cc = r.u16(); const base = r.u16(); r.skip(2); if (!(flags & 0x20)) r.skip(12);
const comps = Array.from({ length: cc }, () => { r.skip(2); return { meshCount: r.u16(), meshOffset: r.u16() }; });
const headerEnd = off + 14 + (flags & 0x20 ? 0 : 12);
console.log({ off, flags: flags.toString(16), cc, base, headerEnd, afterComps: r.pos, comps });
for (const c of comps) {
  const mr = new Reader(dat, headerEnd + c.meshOffset - base);
  for (let m = 0; m < c.meshCount; m++) {
    const pre = [mr.u8(), mr.u8(), mr.u8()]; const vc = mr.u8(), vo = mr.u16(), fc = mr.u16(), fo = mr.u16(); const post = [mr.u8(), mr.u8(), mr.u8(), mr.u8()];
    const vr = new Reader(dat, headerEnd + vo - base); const vs = Array.from({ length: Math.min(vc, 4) }, () => [vr.i16(), vr.i16(), vr.i16()]);
    console.log(` mesh pre=${pre} vc=${vc} vo=${vo} fc=${fc} fo=${fo} post=${post} first=${JSON.stringify(vs)}`);
  }
}
