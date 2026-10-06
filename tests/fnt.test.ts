import { describe, expect, it } from 'vitest';
import { FNT_VERSION_MONO, FNT_VERSION_SHADED, measureString, parseFNT, renderString } from '../src/formats/fnt';

/** Wrap bytes in an RLE stream of literal runs (<=127 bytes each). */
function rleLiteral(data: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < data.length; i += 127) {
    const run = data.slice(i, i + 127);
    out.push(run.length, ...run);
  }
  return out;
}

function u16(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff];
}

/** Build a synthetic FNT: glyph bitmaps already encoded; widths per glyph. */
function buildFNT(version: number, height: number, firstChar: number, glyphs: { width: number; data: number[] }[], rle?: number[]) {
  const offsets: number[] = [];
  let off = 0;
  for (const g of glyphs) {
    offsets.push(off);
    off += g.data.length;
  }
  const raw = [
    ...offsets.flatMap(u16),
    ...glyphs.map((g) => g.width),
    ...glyphs.flatMap((g) => g.data),
  ];
  const payload = rle ?? rleLiteral(raw);
  const chunk = [
    version,
    Math.max(...glyphs.map((g) => g.width)),
    height,
    height - 1,
    firstChar,
    glyphs.length,
    ...u16(payload.length),
    0x01,
    raw.length & 0xff, (raw.length >> 8) & 0xff, 0, 0,
    ...payload,
  ];
  return Uint8Array.from([
    0xde, 0xad, // leading junk: tag search must skip it
    ...'FNT:'.split('').map((c) => c.charCodeAt(0)),
    chunk.length & 0xff, (chunk.length >> 8) & 0xff, 0, 0,
    ...chunk,
  ]);
}

// 'A' (code 65): 3 wide x 3 tall, a "T" shape. 'B' (66): 10 wide x 2 tall, two bytes per row.
const monoGlyphs = [
  { width: 3, data: [0b11100000, 0b01000000, 0b01000000] },
  { width: 10, data: [0b10000000, 0b01000000, 0b01111111, 0b11000000] },
];

describe('parseFNT (src/formats/fnt.ts)', () => {
  it('parses header fields and 1bpp glyphs, including >8px wide rows', () => {
    const font = parseFNT(buildFNT(FNT_VERSION_MONO, 3, 65, monoGlyphs.map((g, i) => (i === 1 ? { ...g, data: [0x80, 0x40, 0x7f, 0xc0, 0, 0] } : g))));
    expect(font.height).toBe(3);
    expect(font.firstChar).toBe(65);
    expect(font.glyphs.map((g) => g.width)).toEqual([3, 10]);
    expect([...font.glyphs[0]!.pixels]).toEqual([1, 1, 1, 0, 1, 0, 0, 1, 0]);
    const b = font.glyphs[1]!;
    // row 0 = 0x80,0x40 -> bit 0 and bit 9 set
    expect(b.pixels[0]).toBe(1);
    expect(b.pixels[1]).toBe(0);
    expect(b.pixels[9]).toBe(1);
    // row 1 = 0x7f,0xc0 -> bits 1..9 set
    expect(b.pixels[10]).toBe(0);
    expect(b.pixels[10 + 1]).toBe(1);
    expect(b.pixels[10 + 9]).toBe(1);
    expect(b.pixels[20 + 9]).toBe(0);
  });

  it('decodes RLE repeat runs', () => {
    // two glyphs, 2 tall, 4 wide: offsets (0,2), widths (4,4), data 4 bytes all 0xF0 via a repeat run
    const raw = [0, 0, 2, 0, 4, 4, 0xf0, 0xf0, 0xf0, 0xf0];
    const rle = [...rleLiteral(raw.slice(0, 6)), 0x84, 0xf0];
    const font = parseFNT(buildFNT(FNT_VERSION_MONO, 2, 32, [{ width: 4, data: [0xf0, 0xf0] }, { width: 4, data: [0xf0, 0xf0] }], rle));
    expect([...font.glyphs[1]!.pixels]).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it('parses 8bpp shaded fonts', () => {
    const font = parseFNT(buildFNT(FNT_VERSION_SHADED, 2, 97, [{ width: 2, data: [0, 5, 9, 0] }]));
    expect([...font.glyphs[0]!.pixels]).toEqual([0, 5, 9, 0]);
  });

  it('rejects bad version, compression marker and missing tag', () => {
    expect(() => parseFNT(buildFNT(0x12, 3, 65, monoGlyphs))).toThrow(/version/);
    const bad = buildFNT(FNT_VERSION_MONO, 3, 65, monoGlyphs);
    bad[2 + 8 + 8] = 0x02;
    expect(() => parseFNT(bad)).toThrow(/compression/);
    expect(() => parseFNT(new Uint8Array(32))).toThrow(/tag not found/);
  });
});

describe('renderString', () => {
  const font = parseFNT(buildFNT(FNT_VERSION_MONO, 3, 65, [monoGlyphs[0]!, { width: 2, data: [0x80, 0x80, 0xc0] }]));

  it('measures and renders with spacing, ink and background', () => {
    expect(measureString(font, 'AB', 1)).toBe(6);
    const img = renderString(font, 'AB', { ink: 7, background: 2, spacing: 1 });
    expect([img.width, img.height]).toEqual([6, 3]);
    expect([...img.pixels.slice(0, 6)]).toEqual([7, 7, 7, 2, 7, 2]);
    expect([...img.pixels.slice(12, 18)]).toEqual([2, 7, 2, 2, 7, 7]);
  });

  it('falls back to the first glyph for unknown characters and supports newlines', () => {
    const img = renderString(font, 'A\n?');
    expect(img.height).toBe(6);
    expect([...img.pixels.slice(9, 12)]).toEqual([1, 1, 1]);
  });

  it('keeps shaded glyph indices', () => {
    const f = parseFNT(buildFNT(FNT_VERSION_SHADED, 1, 97, [{ width: 2, data: [3, 0] }]));
    expect([...renderString(f, 'a', { ink: 9 }).pixels]).toEqual([3, 0]);
  });
});
