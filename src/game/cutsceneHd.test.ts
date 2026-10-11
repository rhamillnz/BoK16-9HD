import { describe, expect, it } from 'vitest';
import type { TtmFrame } from '../formats/ttm';
import { hdScreenName, hdSpriteName, hdUrl, hdUses } from './cutsceneHd';

const frame = (ops: TtmFrame['ops']): TtmFrame => ({ ops }) as unknown as TtmFrame;

describe('cutscene HD names', () => {
  it('names pictures by file stem, image index and palette', () => {
    expect(hdSpriteName('INT_TITL.BMX', 2, 'INT_TITL.PAL')).toBe('INT_TITL-2-INT_TITL');
    expect(hdScreenName('C11.SCX', 'c11b.pal')).toBe('C11-C11B');
    expect(hdUrl('C11-C11B')).toBe('/art/cutscenes-4x/C11-C11B.png');
  });
});

describe('hdUses', () => {
  it('pairs each drawn picture with the palette active when it is drawn', () => {
    const uses = hdUses([
      frame([
        { op: 'slotPalette', slot: 0 },
        { op: 'loadPalette', name: 'A.PAL' },
        { op: 'loadScreen', name: 'BACK.SCX' },
        { op: 'slotImage', slot: 1 },
        { op: 'loadImage', name: 'MAN.BMX' },
      ]),
      frame([
        { op: 'sprite', x: 0, y: 0, index: 3, slot: 1, width: 0, height: 0, flipX: false, flipY: false },
        { op: 'slotPalette', slot: 2 },
        { op: 'loadPalette', name: 'B.PAL' },
        { op: 'spriteRotated', x: 0, y: 0, index: 3, slot: 1, width: 4, height: 4, angle: 10 },
        { op: 'sprite', x: 5, y: 5, index: 3, slot: 1, width: 0, height: 0, flipX: true, flipY: false },
        { op: 'sprite', x: 0, y: 0, index: 0, slot: 7, width: 0, height: 0, flipX: false, flipY: false },
      ]),
    ]);
    expect(uses.screens).toEqual([{ scx: 'BACK.SCX', pal: 'A.PAL' }]);
    expect(uses.sprites).toEqual([
      { bmx: 'MAN.BMX', index: 3, pal: 'A.PAL' },
      { bmx: 'MAN.BMX', index: 3, pal: 'B.PAL' },
    ]);
  });
});
