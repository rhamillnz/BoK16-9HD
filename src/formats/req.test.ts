import { describe, expect, it } from 'vitest';
import { parseReq } from './req';

describe('REQ layout', () => {
  it('reads widgets and their labels', () => {
    const w = (id: number, x: number, y: number, strOff: number, tele: number) => {
      const b = new Uint8Array(33);
      const v = new DataView(b.buffer);
      v.setUint16(0, id, true);
      v.setInt16(2, 3, true);
      b[4] = 1;
      v.setInt16(11, x, true);
      v.setInt16(13, y, true);
      v.setUint16(15, 10, true);
      v.setUint16(17, 8, true);
      v.setInt16(21, strOff, true);
      v.setInt16(23, tele, true);
      return [...b];
    };
    const header = new Uint8Array(30);
    const hv = new DataView(header.buffer);
    hv.setInt16(2, 1, true);
    hv.setInt16(6, 5, true);
    hv.setInt16(8, 6, true);
    hv.setInt16(10, 100, true);
    hv.setInt16(12, 50, true);
    hv.setInt16(16, 2, true);
    hv.setInt16(18, 3, true);
    hv.setUint16(28, 2, true);
    const strings = [...'#Sung\0'].map((c) => c.charCodeAt(0));
    const bytes = new Uint8Array([...header, ...w(0, 40, 20, 0, 4), ...w(1, 60, 30, -1, -1), 0, 0, ...strings]);
    const req = parseReq(bytes);
    expect(req).toMatchObject({ popup: true, x: 5, y: 6, width: 100, height: 50, offsetX: 2, offsetY: 3 });
    expect(req.widgets).toHaveLength(2);
    expect(req.widgets[0]).toMatchObject({ x: 40, y: 20, width: 10, height: 8, teleport: 4, label: '#Sung', visible: true });
    expect(req.widgets[1]!.label).toBe('');
  });

  it('rejects a truncated layout', () => {
    expect(() => parseReq(new Uint8Array(32))).not.toThrow();
    const header = new Uint8Array(30);
    new DataView(header.buffer).setUint16(28, 5, true);
    expect(() => parseReq(header)).toThrow(RangeError);
  });
});
