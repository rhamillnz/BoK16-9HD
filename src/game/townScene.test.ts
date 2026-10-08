import { describe, expect, it } from 'vitest';
import { parseTtm, type TtmScript } from '../formats/ttm';
import { composeScene } from './townScene';

const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
const op = (code: number, ...args: number[]) => [...u16(code | args.length), ...args.flatMap((a) => u16(a & 0xffff))];
const named = (code: number, name: string) => {
  const b = [...name].map((c) => c.charCodeAt(0));
  b.push(0);
  if (b.length & 1) b.push(0);
  return [...u16(code | 0xf), ...b];
};

/** A TTM file holding one uncompressed TT3 chunk. */
function ttmFile(body: number[]): Uint8Array {
  const tt3 = [0, body.length & 0xff, body.length >> 8, 0, 0, ...body];
  const size = tt3.length;
  return new Uint8Array([...'TT3:'].map((c) => c.charCodeAt(0)).concat([size & 0xff, size >> 8, 0, 0], tt3));
}

/** A PAL file whose entry 1 is bright red (6-bit 63, 0, 0). */
function palFile(): Uint8Array {
  const vga = new Array(256 * 3).fill(0);
  vga[3] = 63;
  const size = vga.length;
  return new Uint8Array([...'VGA:'].map((c) => c.charCodeAt(0)).concat([size & 0xff, size >> 8, 0, 0], vga));
}

describe('town scene composition', () => {
  // Real scripts load palettes, images and the picture without selecting a slot first: they use slot 0.
  const body = [
    ...op(0x1110, 1),
    ...named(0xf050, 'TOWN.PAL'),
    ...named(0xf010, 'TOWN.SCR'),
    ...named(0xf020, 'TOWN.BMP'),
    ...op(0x2000, 1, 1),
    ...op(0xa100, 10, 10, 20, 20),
  ];

  it('binds resources loaded without a slot select to slot 0', () => {
    const script = parseTtm(ttmFile(body)).get(1)!;
    expect(script.palettes.get(0)).toBe('TOWN.PAL');
    expect(script.screen).toEqual({ name: 'TOWN.SCX', palette: 0 });
    expect(script.images.get(0)).toEqual({ name: 'TOWN.BMX', palette: 0 });
  });

  it('draws the script instead of an all-black picture', () => {
    const script = parseTtm(ttmFile(body)).get(1)!;
    const image = composeScene([script], (name) => (name === 'TOWN.PAL' ? palFile() : undefined));
    const at = (x: number, y: number) =>
      Array.from(image.rgba.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 3));
    expect(at(15, 15)).toEqual([255, 0, 0]);
    expect(at(100, 100)).toEqual([0, 0, 0]);
  });
});

describe('scenes spread over several scripts', () => {
  it('lets a later script use what an earlier one loaded (the usual town layout)', () => {
    // As in G_TOWN.TTM: the background script only loads the palette and picture, the next one draws.
    const loads: TtmScript = {
      id: 10,
      images: new Map([[0, { name: 'PIC.BMX', palette: 0 }]]),
      palettes: new Map([[0, 'TOWN.PAL']]),
      ops: [],
      screen: undefined,
    };
    const draws: TtmScript = {
      id: 13,
      images: new Map(),
      palettes: new Map(),
      screen: undefined,
      ops: [{ op: 'rect', x: 10, y: 10, width: 20, height: 20, filled: true, edge: 1, fill: 1 }],
    } as TtmScript;
    const image = composeScene([loads, draws], (name) => (name === 'TOWN.PAL' ? palFile() : undefined));
    const at = (x: number, y: number) =>
      Array.from(image.rgba.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 3));
    expect(at(15, 15)).not.toEqual([0, 0, 0]);
  });
});
