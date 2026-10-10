/**
 * Weather presets and the seeded schedule that picks one for a zone and time. Pure; the rendering
 * is weather.ts. The schedule changes every six hours of game time and is mostly clear.
 */

export type WeatherKind = 'clear' | 'mist' | 'drizzle' | 'rain';

export const WEATHER_KINDS: readonly WeatherKind[] = ['clear', 'mist', 'drizzle', 'rain'];

export interface WeatherAmounts {
  rain: number;
  overcast: number;
  mist: number;
  wet: number;
}

export const WEATHER_PRESETS: Readonly<Record<WeatherKind, WeatherAmounts>> = {
  clear: { rain: 0, overcast: 0, mist: 0, wet: 0 },
  mist: { rain: 0, overcast: 0.35, mist: 1, wet: 0.35 },
  drizzle: { rain: 0.35, overcast: 0.6, mist: 0.45, wet: 0.7 },
  rain: { rain: 1, overcast: 1, mist: 0.6, wet: 1 },
};

/** Small integer hash to [0, 1). */
function unitHash(a: number, b: number, c: number): number {
  let h =
    Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^
    Math.imul(b + 0x7f4a7c15, 0xc2b2ae35) ^
    Math.imul(c + 0x165667b1, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Share of six-hour blocks with each kind: clear 72%, mist 12%, drizzle 10%, rain 6%. */
const CUMULATIVE: readonly (readonly [number, WeatherKind])[] = [
  [0.72, 'clear'],
  [0.84, 'mist'],
  [0.94, 'drizzle'],
  [1, 'rain'],
];

/**
 * The scheduled weather for a zone on a given day (counted from game time zero) and hour. Frozen
 * zone 6 gets no rain (no snow is drawn), and underground it is always clear.
 */
export function scheduledWeather(zone: number, day: number, hour: number, underground = false): WeatherKind {
  if (underground) return 'clear';
  const r = unitHash(zone, day, Math.floor(hour / 6));
  const kind = CUMULATIVE.find(([limit]) => r < limit)![1];
  return zone === 6 && (kind === 'rain' || kind === 'drizzle') ? 'mist' : kind;
}

/** Move `current` towards `target` by at most `rate * dt` per amount. */
export function easeWeather(current: WeatherAmounts, target: WeatherAmounts, dt: number, rate = 0.3): WeatherAmounts {
  const step = rate * dt;
  const go = (a: number, b: number) => (Math.abs(b - a) <= step ? b : a + Math.sign(b - a) * step);
  return {
    rain: go(current.rain, target.rain),
    overcast: go(current.overcast, target.overcast),
    mist: go(current.mist, target.mist),
    wet: go(current.wet, target.wet),
  };
}

/** Parse a `?weather=` value: a kind forces it, anything else (or nothing) leaves the schedule in charge. */
export function parseWeatherParam(value: string | null | undefined): WeatherKind | undefined {
  return WEATHER_KINDS.find((k) => k === value);
}
