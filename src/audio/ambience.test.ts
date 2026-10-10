import { describe, expect, it } from 'vitest';
import { RAIN_MAX, WIND_MAX, ambienceLevels } from './ambience';

describe('ambienceLevels', () => {
  it('is silent on a clear day and underground', () => {
    expect(ambienceLevels({ rain: 0, overcast: 0, mist: 0 })).toEqual({ rain: 0, wind: 0 });
    expect(ambienceLevels({ rain: 1, overcast: 1, mist: 1 }, true)).toEqual({ rain: 0, wind: 0 });
  });

  it('scales rain with the rain amount and adds wind with overcast and mist', () => {
    expect(ambienceLevels({ rain: 0.5, overcast: 0, mist: 0 }).rain).toBeCloseTo(RAIN_MAX / 2);
    const mist = ambienceLevels({ rain: 0, overcast: 0.35, mist: 1 });
    expect(mist.rain).toBe(0);
    expect(mist.wind).toBeGreaterThan(0);
    expect(ambienceLevels({ rain: 1, overcast: 1, mist: 0.6 }).wind).toBeLessThanOrEqual(WIND_MAX);
  });
});
