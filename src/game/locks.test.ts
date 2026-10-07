import { describe, expect, it } from 'vitest';
import {
  ITEM_PICKLOCK,
  attemptLock,
  canPickLock,
  classifyLock,
  describeLock,
  isKeyItem,
  keyBreakChance,
  keyItemForLock,
  picklockBreakChance,
} from './locks';

const roll = (...values: number[]) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)]!;
};

describe('locks', () => {
  it('classifies by rating', () => {
    expect([0x32, 0x33, 0x50, 0x51, 0x64, 0x65].map(classifyLock)).toEqual([
      'easy',
      'medium',
      'medium',
      'hard',
      'hard',
      'unpickable',
    ]);
  });

  it('maps special ratings to their key items', () => {
    expect(keyItemForLock(0x32)).toBe(61);
    expect(keyItemForLock(0x6a)).toBe(71);
    expect(keyItemForLock(0x20)).toBeUndefined();
    expect(keyItemForLock(0)).toBeUndefined();
    expect(isKeyItem(61)).toBe(true);
    expect(isKeyItem(60)).toBe(false);
    expect(isKeyItem(72)).toBe(false);
  });

  it('picks only ratings up to 100 below the skill', () => {
    expect(canPickLock(51, 50)).toBe(true);
    expect(canPickLock(50, 50)).toBe(false);
    expect(canPickLock(200, 101)).toBe(false);
  });

  it('describes locks', () => {
    expect([describeLock(60, 50), describeLock(40, 50), describeLock(99, 103), describeLock(99, 107)]).toEqual([
      0, 1, 2, 3,
    ]);
  });

  it('computes break chances', () => {
    expect(picklockBreakChance(30, 60)).toBe(20);
    expect(picklockBreakChance(70, 60)).toBe(0);
    expect(keyBreakChance(61, 30)).toBe(26); // key rating 50: (50 - 10) * 2 / 3
    expect(keyBreakChance(63, 0)).toBe(0); // special key never breaks
  });

  it('opens with the right key and with a good enough pick', () => {
    expect(attemptLock(61, 10, 0x32, roll(99))).toMatchObject({
      unlocked: true,
      attempt: { kind: 'opened', with: 'key' },
    });
    expect(attemptLock(ITEM_PICKLOCK, 80, 0x32, roll(99))).toMatchObject({
      unlocked: true,
      attempt: { kind: 'opened', with: 'picklock' },
      learned: true,
    });
  });

  it('a failed pick may teach and may snap', () => {
    const snap = attemptLock(ITEM_PICKLOCK, 30, 60, roll(10, 5));
    expect(snap).toMatchObject({ unlocked: false, consumed: ITEM_PICKLOCK, learned: true, attempt: { kind: 'broke' } });
    const hold = attemptLock(ITEM_PICKLOCK, 30, 60, roll(90, 90));
    expect(hold).toMatchObject({ unlocked: false, learned: false, attempt: { kind: 'failed' } });
    expect(hold.consumed).toBeUndefined();
  });

  it('a wrong key may snap, a special wrong key never does', () => {
    expect(attemptLock(61, 0, 0x5a, roll(0))).toMatchObject({ attempt: { kind: 'broke' }, consumed: 61 });
    expect(attemptLock(61, 0, 0x5a, roll(99))).toMatchObject({ attempt: { kind: 'failed' } });
    expect(attemptLock(64, 0, 0x5a, roll(0))).toMatchObject({ attempt: { kind: 'failed' } });
  });

  it('other items do nothing', () => {
    expect(attemptLock(30, 99, 10, roll(0))).toMatchObject({ unlocked: false, attempt: { kind: 'nothing' } });
  });
});
