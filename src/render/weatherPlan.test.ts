import { describe, expect, it } from 'vitest';
import { WEATHER_PRESETS, easeWeather, parseWeatherParam, scheduledWeather, type WeatherKind } from './weatherPlan';

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
