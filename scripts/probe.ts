// Debug probe: decode each BMX with timing to find slow/hanging files.
// Run: npx vite-node scripts/probe.ts
import { readFileSync } from 'node:fs';
import { ResourceArchive } from '../src/formats/archive';
import { parseBMX } from '../src/formats/bmx';
import { Reader } from '../src/formats/reader';

const D = process.env.BAK_DIR ?? 'C:/Program Files (x86)/GOG Galaxy/Games/Betrayal at Krondor';

const t0 = performance.now();
const a = new ResourceArchive(readFileSync(`${D}/KRONDOR.RMF`), readFileSync(`${D}/KRONDOR.001`));
console.log(`index: ${a.entries.length} entries in ${(performance.now() - t0).toFixed(0)}ms`);
const exts = new Map<string, number>();
for (const e of a.entries) {
  const ext = e.name.split('.').pop() ?? '';
  exts.set(ext, (exts.get(ext) ?? 0) + 1);
}
console.log(
  [...exts]
    .sort()
    .map(([k, v]) => `${k}:${v}`)
    .join(' '),
);

for (const e of a.entries.filter((x) => x.name.endsWith('.BMX'))) {
  const r = new Reader(a.get(e.name));
  const sig = r.u16().toString(16);
  const comp = r.u16();
  process.stdout.write(`${e.name} sig=${sig} comp=${comp} ... `);
  const t = performance.now();
  try {
    const imgs = parseBMX(a.get(e.name));
    console.log(
      `${imgs.length} imgs ${imgs
        .map((i) => `${i.width}x${i.height}`)
        .slice(0, 3)
        .join(',')} ${(performance.now() - t).toFixed(0)}ms`,
    );
  } catch (err) {
    console.log(`FAIL ${(err as Error).message}`);
  }
}
