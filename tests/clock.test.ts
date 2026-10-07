import { describe, expect, it } from 'vitest';
import type { GamSave } from '../src/formats/gam';
import { DEBUG_TIME_STEP, GameClock, WALK_TICKS_PER_SECOND } from '../src/game/clock';
import { TICKS_PER_DAY, TICKS_PER_HOUR, createWorldState } from '../src/game/state';

const save = {
  chapter: 0,
  time: { ticks: 100 },
  timeLastSlept: { ticks: 0 },
  bytes: new Uint8Array(16),
  expiringEvents: [],
} as unknown as GamSave;

describe('GameClock', () => {
  it('starts the chapter at the next midnight plus the chapter time change', () => {
    const c = GameClock.forChapter(save, 1, 8 * TICKS_PER_HOUR);
    expect(c.state.chapter).toBe(1);
    expect(c.state.ticks).toBe(TICKS_PER_DAY + 8 * TICKS_PER_HOUR);
    expect(c.minutes).toBeCloseTo(8 * 60);
    expect(c.label).toBe('day 1 08:00');
  });

  it('advances with walking time and carries fractional ticks', () => {
    const c = new GameClock(createWorldState(save));
    const t0 = c.state.ticks;
    expect(c.walk(0.01)).toBeUndefined();
    c.walk(1);
    expect(c.state.ticks).toBe(t0 + Math.floor(WALK_TICKS_PER_SECOND * 1.01));
    for (let i = 0; i < 100; i++) c.walk(0.01);
    expect(c.state.ticks).toBe(t0 + Math.floor(WALK_TICKS_PER_SECOND * 2.01));
  });

  it('does not advance for negative or zero dt', () => {
    const c = new GameClock(createWorldState(save));
    c.walk(-5);
    c.walk(0);
    expect(c.state.ticks).toBe(100);
  });

  it('reports crossing an hour', () => {
    const c = new GameClock(createWorldState(save));
    c.shift(TICKS_PER_HOUR - 100 - 1);
    const r = c.walk(1);
    expect(r?.hourChanged).toBe(true);
  });

  it('debug shift moves both ways and clamps at zero', () => {
    const c = new GameClock(createWorldState(save));
    c.shift(DEBUG_TIME_STEP);
    expect(c.state.ticks).toBe(100 + DEBUG_TIME_STEP);
    c.shift(-10 * DEBUG_TIME_STEP);
    expect(c.state.ticks).toBe(0);
  });
});
