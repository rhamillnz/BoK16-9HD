import { describe, expect, it } from 'vitest';
import { ItemType, OBJINFO_RECORD_SIZE, Race, SaleCategory, modifiersOf, parseObjInfo } from '../src/formats/objinfo';

interface Rec {
  name: string;
  flags?: number;
  level?: number;
  value?: number;
  swing?: [number, number];
  thrust?: [number, number];
  image?: number;
  type?: number;
  race?: number;
  categories?: number;
  modifierMask?: number;
  modifier?: number;
}

function build(recs: Rec[], scrolls: number[] = []): Uint8Array {
  const out = new Uint8Array(recs.length * OBJINFO_RECORD_SIZE + scrolls.length * 2);
  const dv = new DataView(out.buffer);
  recs.forEach((r, i) => {
    const o = i * OBJINFO_RECORD_SIZE;
    for (let c = 0; c < r.name.length; c++) out[o + c] = r.name.charCodeAt(c);
    dv.setUint16(o + 0x1e, 0xaaaa, true);
    dv.setUint16(o + 0x20, r.flags ?? 0, true);
    dv.setUint16(o + 0x22, 0xbbbb, true);
    dv.setInt16(o + 0x24, r.level ?? 0, true);
    dv.setInt16(o + 0x26, r.value ?? 0, true);
    dv.setInt16(o + 0x28, r.swing?.[0] ?? 0, true);
    dv.setInt16(o + 0x2a, r.thrust?.[0] ?? 0, true);
    dv.setInt16(o + 0x2c, r.swing?.[1] ?? 0, true);
    dv.setInt16(o + 0x2e, r.thrust?.[1] ?? 0, true);
    dv.setUint16(o + 0x30, r.image ?? 0, true);
    dv.setUint16(o + 0x32, 2, true);
    out[o + 0x34] = 5;
    out[o + 0x35] = 1;
    out[o + 0x36] = 10;
    out[o + 0x37] = 3;
    dv.setUint16(o + 0x38, r.race ?? 0, true);
    dv.setUint16(o + 0x3a, r.categories ?? 0, true);
    dv.setUint16(o + 0x3c, r.type ?? 0, true);
    dv.setUint16(o + 0x3e, 7, true);
    dv.setInt16(o + 0x40, -3, true);
    dv.setUint16(o + 0x42, 9, true);
    dv.setUint16(o + 0x44, 11, true);
    dv.setUint16(o + 0x46, r.modifierMask ?? 0, true);
    dv.setInt16(o + 0x48, r.modifier ?? 0, true);
    dv.setUint16(o + 0x4a, 20, true);
    dv.setUint16(o + 0x4c, 4, true);
    dv.setUint16(o + 0x4e, 33, true);
  });
  scrolls.forEach((s, i) => dv.setUint16(recs.length * OBJINFO_RECORD_SIZE + i * 2, s, true));
  return out;
}

describe('parseObjInfo', () => {
  it('parses fields from the documented offsets', () => {
    const data = build(
      [
        {
          name: 'Short Sword',
          flags: 0x0102,
          level: 2,
          value: 150,
          swing: [6, 55],
          thrust: [4, 50],
          image: 12,
          type: ItemType.Sword,
          race: Race.Human,
          categories: SaleCategory.Sword,
        },
        { name: 'Ration', value: -1, type: ItemType.Ration },
      ],
      [100, 250],
    );
    const { items, scrollValues } = parseObjInfo(data, 2);
    const s = items[0]!;
    expect(s.name).toBe('Short Sword');
    expect(s.unknown1).toBe(0xaaaa);
    expect(s.unknown2).toBe(0xbbbb);
    expect(s.flags).toBe(0x0102);
    expect(s.level).toBe(2);
    expect(s.value).toBe(150);
    expect([s.strengthSwing, s.strengthThrust, s.accuracySwing, s.accuracyThrust]).toEqual([6, 4, 55, 50]);
    expect(s.imageIndex).toBe(12);
    expect(s.imageSize).toBe(2);
    expect([s.useSound, s.soundPlayTimes, s.stackSize, s.defaultStackSize]).toEqual([5, 1, 10, 3]);
    expect(s.race).toBe(Race.Human);
    expect(s.type).toBe(ItemType.Sword);
    expect(s.categories).toBe(SaleCategory.Sword);
    expect(s.effectMask).toBe(7);
    expect(s.effect).toBe(-3);
    expect(s.potionPowerOrBookChance).toBe(9);
    expect(s.alternativeEffect).toBe(11);
    expect(s.dullChance).toBe(20);
    expect(s.maxDullAmount).toBe(4);
    expect(s.minCondition).toBe(33);
    expect(items[1]!.value).toBe(-1);
    expect(scrollValues).toEqual([100, 250]);
  });

  it('defaults image index to the record index when stored value is 0', () => {
    const { items } = parseObjInfo(build([{ name: 'a' }, { name: 'b' }]), 2);
    expect(items[1]!.imageIndex).toBe(1);
  });

  it('rejects truncated files', () => {
    expect(() => parseObjInfo(new Uint8Array(100), 2)).toThrow(RangeError);
  });

  it('decodes modifier masks from the high byte', () => {
    expect(modifiersOf(0x0500)).toEqual(['Flaming', 'Frost']);
    expect(modifiersOf(0x00ff)).toEqual([]);
  });
});
