import { describe, expect, it } from 'vitest';
import {
  WEATHER_KINDS,
  WEATHER_PRESETS,
  easeWeather,
  parseWeatherParam,
  scheduledWeather,
  type WeatherAmounts,
  type WeatherKind,
} from './weatherPlan';

describe('scheduledWeather', () => {
  it('is deterministic and mostly clear', () => {
    const counts: Record<WeatherKind, number> = { clear: 0, mist: 0, drizzle: 0, rain: 0 };
    for (let day = 0; day < 500; day++) {
      for (const hour of [1, 7, 13, 19]) {
        const k = scheduledWeather(1, day, hour);
        expect(scheduledWeather(1, day, hour)).toBe(k);
        counts[k]++;
      }
    }
    expect(counts.clear / 2000).toBeGreaterThan(0.62);
    expect(counts.clear / 2000).toBeLessThan(0.82);
    expect(counts.rain).toBeGreaterThan(0);
    expect(counts.mist).toBeGreaterThan(0);
  });

  it('holds for six hours, stays clear underground and keeps rain out of the frozen zone', () => {
    expect(scheduledWeather(2, 5, 6)).toBe(scheduledWeather(2, 5, 11));
    let sawWet = false;
    for (let day = 0; day < 300; day++) {
      expect(scheduledWeather(3, day, 12, true)).toBe('clear');
      const k = scheduledWeather(6, day, 12);
      sawWet ||= k === 'mist';
      expect(k === 'rain' || k === 'drizzle').toBe(false);
    }
    expect(sawWet).toBe(true);
  });
});

describe('scheduledWeather edge cases', () => {
  it('uses one kind for each six-hour block of a day, whatever the hour within it', () => {
    for (let day = 0; day < 50; day++) {
      for (let block = 0; block < 4; block++) {
        const first = scheduledWeather(4, day, block * 6);
        for (let h = block * 6; h < block * 6 + 6; h++) {
          expect(scheduledWeather(4, day, h + 0.99)).toBe(first);
        }
      }
    }
  });

  it('changes from one block to the next often enough to vary through a day', () => {
    const kinds = new Set<WeatherKind>();
    for (let day = 0; day < 200; day++) kinds.add(scheduledWeather(1, day, 0));
    expect(kinds).toEqual(new Set(['clear', 'mist', 'drizzle', 'rain']));
  });

  it('always returns a known kind, including for negative and very large inputs', () => {
    for (const [zone, day, hour] of [
      [0, -1, -1],
      [-3, -400, -25],
      [255, 1e6, 1e4],
      [6, 0, 0],
    ] as const) {
      expect(WEATHER_KINDS).toContain(scheduledWeather(zone, day, hour));
    }
  });

  it('keeps the frozen zone free of rain and drizzle in every block, not just on average', () => {
    for (let day = 0; day < 200; day++) {
      for (let hour = 0; hour < 24; hour += 6) {
        expect(['clear', 'mist']).toContain(scheduledWeather(6, day, hour));
      }
    }
  });

  it('keeps underground clear even in the frozen zone or in rainy blocks', () => {
    for (let day = 0; day < 200; day++) {
      expect(scheduledWeather(6, day, 6, true)).toBe('clear');
      expect(scheduledWeather(1, day, 18, true)).toBe('clear');
    }
  });
});

describe('easeWeather', () => {
  it('moves gradually and arrives exactly', () => {
    let w = WEATHER_PRESETS.clear;
    w = easeWeather(w, WEATHER_PRESETS.rain, 1);
    expect(w.rain).toBeCloseTo(0.3);
    for (let i = 0; i < 10; i++) w = easeWeather(w, WEATHER_PRESETS.rain, 1);
    expect(w).toEqual(WEATHER_PRESETS.rain);
  });
});

describe('parseWeatherParam', () => {
  it('accepts kinds only', () => {
    expect(parseWeatherParam('rain')).toBe('rain');
    expect(parseWeatherParam('storm')).toBeUndefined();
    expect(parseWeatherParam(null)).toBeUndefined();
  });
});

describe('easeWeather edge cases', () => {
  const amounts = (rain: number, overcast: number, mist: number, wet: number): WeatherAmounts => ({
    rain,
    overcast,
    mist,
    wet,
  });

  it('returns the same amounts when already at the target or given no time', () => {
    const w = WEATHER_PRESETS.drizzle;
    expect(easeWeather(w, w, 1)).toEqual(w);
    expect(easeWeather(WEATHER_PRESETS.clear, WEATHER_PRESETS.rain, 0)).toEqual(WEATHER_PRESETS.clear);
  });

  it('does not overshoot when one step covers the remaining distance', () => {
    const w = easeWeather(WEATHER_PRESETS.clear, WEATHER_PRESETS.rain, 100);
    expect(w).toEqual(WEATHER_PRESETS.rain);
  });

  it('eases back down towards clear and lands exactly on it', () => {
    let w: WeatherAmounts = WEATHER_PRESETS.rain;
    w = easeWeather(w, WEATHER_PRESETS.clear, 1);
    expect(w.rain).toBeCloseTo(0.7);
    for (let i = 0; i < 10; i++) w = easeWeather(w, WEATHER_PRESETS.clear, 1);
    expect(w).toEqual(WEATHER_PRESETS.clear);
  });

  it('moves each amount independently, so one that has arrived does not hold the others back', () => {
    const w = easeWeather(amounts(0, 0.5, 0, 0), amounts(0, 0, 1, 0), 1);
    expect(w.rain).toBe(0);
    expect(w.overcast).toBeCloseTo(0.2);
    expect(w.mist).toBeCloseTo(0.3);
    expect(w.wet).toBe(0);
  });

  it('honours a custom rate', () => {
    expect(easeWeather(WEATHER_PRESETS.clear, WEATHER_PRESETS.rain, 1, 1).rain).toBe(1);
    expect(easeWeather(WEATHER_PRESETS.clear, WEATHER_PRESETS.rain, 1, 0).rain).toBe(0);
  });

  it('does not change the amounts it was given', () => {
    const current = { ...WEATHER_PRESETS.clear };
    easeWeather(current, WEATHER_PRESETS.rain, 1);
    expect(current).toEqual(WEATHER_PRESETS.clear);
  });
});

describe('parseWeatherParam edge cases', () => {
  it('matches kind names exactly, case included', () => {
    expect(parseWeatherParam('Rain')).toBeUndefined();
    expect(parseWeatherParam(' rain')).toBeUndefined();
    expect(parseWeatherParam('')).toBeUndefined();
  });

  it('ignores object-prototype names', () => {
    expect(parseWeatherParam('constructor')).toBeUndefined();
    expect(parseWeatherParam('__proto__')).toBeUndefined();
    expect(parseWeatherParam(undefined)).toBeUndefined();
  });

  it('accepts each kind', () => {
    for (const k of WEATHER_KINDS) expect(parseWeatherParam(k)).toBe(k);
  });
});
