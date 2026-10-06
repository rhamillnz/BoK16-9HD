import { readFileSync } from 'node:fs';
import { ResourceArchive } from '../src/formats/archive';
import { parseTBL } from '../src/formats/tbl';
const D = 'C:/Program Files (x86)/GOG Galaxy/Games/Betrayal at Krondor';
const a = new ResourceArchive(readFileSync(`${D}/KRONDOR.RMF`), readFileSync(`${D}/KRONDOR.001`));
const t = parseTBL(a.get('Z01.TBL'));
console.log(t.models.map((m) => m?.sprite ? `${m.name}:${m.sprite.index}` : '').filter(Boolean).join(' '));
