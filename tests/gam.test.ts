import { describe, expect, it } from 'vitest';
import {
  CHARACTER_SKILL_STRIDE,
  GAM_OFFSETS as O,
  decodeTime,
  eventFlagLocation,
  parseGam,
  readEventFlag,
} from '../src/formats/gam';

/** Hand-built synthetic save image; no original game data. */
function buildSave() {
  const b = new Uint8Array(O.partyKeys + 3 + 4 * 8);
  const v = new DataView(b.buffer);
  const setBit = (ptr: number, on = true) => {
    const { byte, bit } = eventFlagLocation(ptr);
    const w = v.getUint16(byte, true);
    v.setUint16(byte, on ? w | (1 << bit) : w & ~(1 << bit), true);
  };
  v.setUint16(O.chapter, 3, true);
  v.setUint16(O.chapterCopy, 3, true);
  v.setUint16(O.mapPosition, 1000, true);
  v.setUint16(O.mapPosition + 2, 2000, true);
  v.setUint16(O.mapPosition + 4, 7, true);
  v.setUint32(O.gold, 12345, true);
  v.setUint32(O.time, 43200 + 1800 + 30, true); // 1 day, 1 hour, 1 minute... see test
  v.setUint32(O.time + 4, 100, true);
  b[O.location] = 4;
  b[O.location + 1] = 5;
  b[O.location + 2] = 6;
  v.setUint32(O.location + 3, 0x11223344, true);
  v.setUint32(O.location + 7, 0x55667788, true);
  b.set([1, 2, 3, 4, 5], O.location + 11);
  v.setUint16(O.location + 16, 0x0abc, true);
  b[O.followRoad] = 1;

  // Character 1 ("Owyn"), others blank.
  b.set([...'Owyn'].map((c) => c.charCodeAt(0)), O.characterName + 10);
  const s = O.characterSkills + CHARACTER_SKILL_STRIDE;
  b.set([0xaa, 0xbb], s);
  b.set([0b00000101, 0, 0, 0, 0, 0x80], s + 2); // spells 0, 2, 47
  // skill 2 (speed): max 50, true 40, current 45, exp 7, modifier -3
  b.set([50, 40, 45, 7, 0xfd], s + 8 + 2 * 5);
  b[s + 88] = 9; // combat index
  b.set([1, 2, 3, 4, 5, 6], s + 89);
  setBit(0x1856 + 0x11 + 2); // char 1 skill 2 selected
  setBit(0x18ce + 0x11 + 15); // char 1 skill 15 unseen improvement
  b[O.characterConditions + 7 + 6] = 100; // near death
  const a = O.characterAffectors + 8 * 14;
  v.setUint16(a + 14, 2, true); // second slot: type 2
  v.setUint16(a + 16, 0x0008, true); // strength
  v.setInt16(a + 18, -5, true);
  v.setUint32(a + 20, 10, true);
  v.setUint32(a + 24, 20, true);
  const inv = O.characterInventory + 0x70;
  b[inv] = 2;
  v.setUint16(inv + 1, 24, true);
  b.set([10, 90, 0b01000110, 0], inv + 3); // activated + used + equipped
  b.set([20, 3, 0, 1], inv + 7);

  b[O.activeCharacters] = 2;
  b.set([1, 0], O.activeCharacters + 1);
  b[O.partyKeys] = 1;
  v.setUint16(O.partyKeys + 1, 8, true);
  b.set([77, 1, 0, 0], O.partyKeys + 3);
  v.setUint16(O.expiringEvents, 1, true);
  b.set([1, 0xf0], O.expiringEvents + 2);
  v.setUint16(O.expiringEvents + 4, 0x1234, true);
  v.setUint32(O.expiringEvents + 6, 999, true);
  v.setUint16(O.activeSpells, 0x8001, true);
  return b;
}

describe('gam', () => {
  const save = parseGam(buildSave());

  it('reads scalar header fields', () => {
    expect(save.chapter).toBe(3);
    expect(save.chapterCopy).toBe(3);
    expect(save.mapPosition).toEqual({ x: 1000, y: 2000, heading: 7 });
    expect(save.gold).toBe(12345);
    expect(save.followRoad).toBe(true);
    expect(save.activeSpells).toBe(0x8001);
  });

  it('reads location including the unknown block', () => {
    expect(save.location.zone).toBe(4);
    expect(save.location.tileX).toBe(5);
    expect(save.location.tileY).toBe(6);
    expect(save.location.x).toBe(0x11223344);
    expect(save.location.y).toBe(0x55667788);
    expect([...save.location.unknown]).toEqual([1, 2, 3, 4, 5]);
    expect(save.location.heading).toBe(0x0abc);
  });

  it('decodes time as two-second ticks', () => {
    expect(decodeTime(0)).toMatchObject({ seconds: 0, days: 0, hour: 0, minute: 0 });
    expect(decodeTime(1800)).toMatchObject({ seconds: 3600, hour: 1, minute: 0 });
    expect(decodeTime(43200 + 1800 + 30)).toMatchObject({ days: 1, hour: 1, minute: 1 });
    expect(save.timeLastSlept.ticks).toBe(100);
  });

  it('reads character names, skills, spells and unknown fields', () => {
    expect(save.characters).toHaveLength(6);
    expect(save.characters[0]!.name).toBe('');
    const c = save.characters[1]!;
    expect(c.name).toBe('Owyn');
    expect([...c.unknownHeader]).toEqual([0xaa, 0xbb]);
    expect(c.spells).toEqual([0, 2, 47]);
    expect(c.skills.speed).toEqual({
      max: 50, trueSkill: 40, current: 45, experience: 7, modifier: -3,
      selected: true, unseenImprovement: false,
    });
    expect(c.skills.stealth.unseenImprovement).toBe(true);
    expect(c.skills.stealth.selected).toBe(false);
    expect(c.combatCharIndex).toBe(9);
    expect([...c.unknownTrailer]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(save.characters[0]!.skills.speed.selected).toBe(false);
  });

  it('reads conditions and affectors, skipping empty slots', () => {
    const c = save.characters[1]!;
    expect(c.conditions.nearDeath).toBe(100);
    expect(c.conditions.sick).toBe(0);
    expect(c.affectors).toEqual([
      { type: 2, skill: 3, skillMask: 8, adjustment: -5, startTime: 10, endTime: 20 },
    ]);
  });

  it('reads inventories with status flags', () => {
    const inv = save.characters[1]!.inventory;
    expect(inv.capacity).toBe(24);
    expect(inv.items).toHaveLength(2);
    expect(inv.items[0]).toMatchObject({
      itemIndex: 10, conditionOrQuantity: 90, activated: true, used: true, equipped: true, broken: false,
    });
    expect(inv.items[1]).toMatchObject({ itemIndex: 20, conditionOrQuantity: 3, modifiers: 1 });
    expect(save.partyKeys.items.map((i) => i.itemIndex)).toEqual([77]);
  });

  it('reads active party and expiring events', () => {
    expect(save.activeCharacters).toEqual([1, 0]);
    expect(save.expiringEvents).toEqual([{ type: 1, flags: 0xf0, data: 0x1234, duration: 999 }]);
  });

  it('maps event pointers to word-aligned bits', () => {
    expect(eventFlagLocation(0x1856)).toEqual({ byte: 0x30a + O.eventFlags, bit: 6 });
    expect(eventFlagLocation(0x0011)).toEqual({ byte: 0x2 + O.eventFlags, bit: 1 });
    // complex region: (0xdac0 + 0x2540) & 0xffff = 0 -> byte 0, bit 0
    expect(eventFlagLocation(0xdac0)).toEqual({ byte: O.complexEventFlags, bit: 0 });
    expect(eventFlagLocation(0xdac5)).toEqual({ byte: O.complexEventFlags, bit: 4 });
    expect(readEventFlag(buildSave(), 0x1856 + 0x11 + 2)).toBe(true);
  });

  it('rejects truncated files and impossible inventories', () => {
    expect(() => parseGam(new Uint8Array(100))).toThrow(RangeError);
    const bad = buildSave();
    bad[O.partyKeys] = 9; // 9 items, capacity 8
    expect(() => parseGam(bad)).toThrow(/capacity/);
  });
});
