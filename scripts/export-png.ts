// Export BMX images to PNG for inspection.
// Usage: npx vite-node scripts/export-png.ts <outDir> <NAME.BMX> [PALETTE.PAL] ...
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { ResourceArchive } from '../src/formats/archive';
import { parseBMX, toRGBA } from '../src/formats/bmx';
import { parsePalette } from '../src/formats/palette';
import { guessPalette } from '../src/data/palettes';

const D = process.env.BAK_DIR ?? 'C:/Program Files (x86)/GOG Galaxy/Games/Betrayal at Krondor';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}
/** Minimal RGBA PNG encoder with an integer nearest-neighbour upscale. */
export function encodePNG(width: number, height: number, rgba: Uint8ClampedArray, scale = 1): Buffer {
  const w = width * scale;
  const h = height * scale;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 4 + 1);
    for (let x = 0; x < w; x++) {
      const s = ((Math.floor(y / scale) * width) + Math.floor(x / scale)) * 4;
      raw.set(rgba.subarray(s, s + 4), row + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array()),
  ]);
}

const [outDir, ...names] = process.argv.slice(2);
if (!outDir || names.length === 0) {
  console.error('usage: export-png.ts <outDir> <NAME.BMX> [PALETTE.PAL] ...');
  process.exit(1);
}
const archive = new ResourceArchive(readFileSync(`${D}/KRONDOR.RMF`), readFileSync(`${D}/KRONDOR.001`));
mkdirSync(outDir, { recursive: true });
let palName: string | undefined;
for (const name of names) {
  if (name.toUpperCase().endsWith('.PAL')) {
    palName = name;
    continue;
  }
  const pn = palName ?? guessPalette(name, archive.entries.map((e) => e.name));
  const pal = parsePalette(archive.get(pn));
  parseBMX(archive.get(name)).forEach((img, i) => {
    const file = path.join(outDir, `${name}_${i}.png`);
    writeFileSync(file, encodePNG(img.width, img.height, toRGBA(img, pal), 3));
    console.log(`${file} ${img.width}x${img.height} pal=${pn}`);
  });
  palName = undefined;
}
