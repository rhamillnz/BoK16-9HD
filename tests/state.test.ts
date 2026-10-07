import { describe, expect, it } from 'vitest';
import { GAM_OFFSETS as O, decodeTime, type GamSave } from '../src/formats/gam';
import {
  TIMES,
  advanceTime,
  createWorldState,
  getFlag,
  hoursUntil,
  minutesSinceMidnight,
  restHealPerHour,
  restOneHour,
  setFlag,
  startChapter,
  worldMinutes,
  worldTime,
} from '../src/game/state';

function save(ticks = 0, slept = 0, events: GamSave['expiringEvents'] = []): GamSave {
  return {
    chapter: 1,
    time: decodeTime(ticks),
    timeLastSlept: decodeTime(slept),
    bytes: new Uint8Array(O.complexEventFlags + 0x200),
    expiringEvents: events,
  } as unknown as GamSave;
}

describe('clock', () => {
  it('converts ticks to minutes since midnight', () => {
    expect(minutesSinceMidnight(0)).toBe(0);
    expect(minutesSinceMidnight(TIMES.oneHour * 6)).toBe(360);
    expect(minutesSinceMidnight(TIMES.oneDay + 15)).toBe(0.5);
    expect(worldMinutes(createWorldState(save(TIMES.oneHour * 13 + 30)))).toBe(13 * 60 + 1);
  });
  it('agrees with decodeTime', () => {
    const s = createWorldState(save(TIMES.oneDay * 3 + TIMES.oneHour * 5 + 60));
    expect(worldTime(s)).toMatchObject({ days: 3, hour: 5, minute: 2 });
  });
  it('hoursUntil wraps', () => {
    expect(hoursUntil(TIMES.oneHour * 22, 6)).toBe(8);
    expect(hoursUntil(TIMES.oneHour * 6, 6)).toBe(24);
  });
});

describe('flags', () => {
  it('sets and clears without mutating the input', () => {
    const a = createWorldState(save());
    const b = setFlag(a, 0x1856, true);
    expect(getFlag(a, 0x1856)).toBe(false);
    expect(getFlag(b, 0x1856)).toBe(true);
    expect(getFlag(b, 0x1857)).toBe(false);
    expect(getFlag(setFlag(b, 0x1856, false), 0x1856)).toBe(false);
  });
  it('handles complex pointers', () => {
    const b = setFlag(createWorldState(save()), 0xdac5, true);
    expect(getFlag(b, 0xdac5)).toBe(true);
  });
});

describe('advanceTime', () => {
  it('reports hour and day boundaries', () => {
    const s = createWorldState(save(TIMES.oneDay - 10));
    const r = advanceTime(s, 20);
    expect(r.state.ticks).toBe(TIMES.oneDay + 10);
    expect(r.report).toMatchObject({ daysCrossed: 1, hourChanged: true, consumeRations: true, improveNearDeath: true });
    expect(advanceTime(createWorldState(save(0)), 10).report.hourChanged).toBe(false);
  });
  it('flags +1 health/stamina on every 30th day', () => {
    const r = advanceTime(createWorldState(save(TIMES.oneDay * 30 - 1)), 1);
    expect(r.report.improveHealthStamina).toBe(true);
    expect(advanceTime(createWorldState(save(TIMES.oneDay * 29 - 1)), 1).report.improveHealthStamina).toBe(false);
  });
  it('warns about sleep at 17 h and damages at 18 h, only while awake', () => {
    const at = (h: number, opts = {}) => advanceTime(createWorldState(save(TIMES.oneHour * h - 1)), 1, opts).report;
    expect(at(17)).toMatchObject({ needSleep: true, sleepDamage: false });
    expect(at(18)).toMatchObject({ needSleep: true, sleepDamage: true });
    expect(at(16).needSleep).toBe(false);
    expect(at(18, { awake: false }).sleepDamage).toBe(false);
  });
  it('skips rations when told', () => {
    const r = advanceTime(createWorldState(save(TIMES.oneDay - 1)), 1, { consumeRations: false });
    expect(r.report.consumeRations).toBe(false);
  });
  it('rejects bad deltas', () => {
    expect(() => advanceTime(createWorldState(save()), -1)).toThrow();
  });
});

describe('expiring events', () => {
  it('counts down, fires set/reset flags and drops finished events', () => {
    const s = createWorldState(
      save(0, 0, [
        { type: 3, flags: 0, data: 0x1856, duration: 100 },
        { type: 4, flags: 0, data: 0x1857, duration: 50 },
        { type: 1, flags: 0, data: 0, duration: 500 },
      ]),
    );
    const pre = setFlag(s, 0x1857, true);
    const r = advanceTime(pre, 60);
    expect(getFlag(r.state, 0x1857)).toBe(false);
    expect(r.report.flagsChanged).toEqual([{ ptr: 0x1857, value: false }]);
    expect(r.state.expiringEvents.map((e) => e.duration)).toEqual([40, 440]);
    const r2 = advanceTime(r.state, 1000);
    expect(getFlag(r2.state, 0x1856)).toBe(true);
    expect(r2.state.expiringEvents).toEqual([]);
  });
});

describe('resting', () => {
  it('advances exactly one hour and stamps last-slept', () => {
    const r = restOneHour(createWorldState(save(100, 0)), true);
    expect(r.state.ticks).toBe(100 + TIMES.oneHour);
    expect(r.state.ticksLastSlept).toBe(r.state.ticks);
    expect(r.report.hourlyHeal).toEqual({ healFraction: 0x85, healPercentCeiling: 0x64 });
    expect(restOneHour(createWorldState(save(0)), false).report.hourlyHeal?.healPercentCeiling).toBe(0x50);
  });
  it('heal per hour doubles under the healing condition', () => {
    expect(restHealPerHour(0x64, false)).toBe(1);
    expect(restHealPerHour(0x64, true)).toBe(2);
  });
});

describe('startChapter', () => {
  it('skips to the next midnight plus the chapter time change and resets the sleep stamp', () => {
    const s = startChapter(createWorldState(save(TIMES.oneDay * 2 + TIMES.oneHour * 5)), 2, 0x1234);
    expect(s.chapter).toBe(2);
    expect(s.ticks).toBe(TIMES.oneDay * 3 + 0x1234);
    expect(s.ticksLastSlept).toBe(s.ticks);
  });
  it('a time exactly at midnight still moves to the following day', () => {
    expect(startChapter(createWorldState(save(TIMES.oneDay)), 1, 0).ticks).toBe(TIMES.oneDay * 2);
  });
});
