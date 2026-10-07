import { describe, expect, it } from 'vitest';
import { GDS_CONTAINERS_OFFSET, findGdsContainer, parseGdsContainers } from './gdsShops';
import { parseReq } from './req';

/** One container record: 12 byte location (gds, letter), type, item count, capacity, flags, slots, blocks. */
function container(gds: number, letter: number, flags: number, items: number, capacity: number, blocks: number[]): number[] {
  return [0, 0, 0, 0, gds, 0, 0, 0, letter, 0, 0, 0, 5, items, capacity, flags, ...new Array(Math.max(items, capacity) * 4).fill(0), ...blocks];
}

const SHOP = [4, 3, 20, 3, 65, 2, 0, 0, 0, 0, 0, 0, 0, 0, 5, 0];

describe('GDS containers', () => {
  it('walks records of different shapes and reads the shop block', () => {
    const records = [
      container(1, 0, 0x04, 1, 3, SHOP),
      container(2, 2, 0x01 | 0x04 | 0x10, 0, 2, [9, 9, 9, 9, ...SHOP.map((v, i) => (i === 0 ? 7 : v)), 1, 2, 3, 4]),
      container(3, 1, 0x00, 0, 0, []),
    ].flat();
    const save = new Uint8Array(GDS_CONTAINERS_OFFSET + records.length);
    save.set(records, GDS_CONTAINERS_OFFSET);
    const list = parseGdsContainers(save, 3);
    expect(list).toHaveLength(3);
    expect(list[0]!.ref).toEqual({ number: 1, letter: 'A' });
    expect(list[0]!.shop).toMatchObject({ templeNumber: 4, sellFactor: 3, maxDiscount: 20, buyFactor: 3, haggleDifficulty: 65, haggleAnnoyance: 2, categories: 5 });
    expect(list[1]!.shop?.templeNumber).toBe(7);
    expect(list[2]!.shop).toBeUndefined();
    expect(findGdsContainer(list, { number: 2, letter: 'B' })?.index).toBe(1);
    expect(findGdsContainer(list, { number: 9, letter: 'A' })).toBeUndefined();
  });

  it('stops at a truncated table instead of throwing', () => {
    const save = new Uint8Array(GDS_CONTAINERS_OFFSET + 20);
    expect(parseGdsContainers(save, 98).length).toBeLessThan(98);
  });
});

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
