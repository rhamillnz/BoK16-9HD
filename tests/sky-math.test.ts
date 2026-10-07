import { describe, expect, it } from 'vitest';
import {
  HORIZON_FRAMES,
  MINUTES_PER_DAY,
  MOON_INTENSITY,
  computeSkyState,
  formatClock,
  hexToRgb,
  lerpRgb,
  moonDirection,
  sampleKeyframes,
  shiftMinutes,
  smoothstep,
  sunDirection,
  wrapMinutes,
  type Keyframe,
  type Rgb,
} from '../src/render/skyMath';

const h = (hours: number, mins = 0) => hours * 60 + mins;
const luma = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const len = (v: number[]) => Math.hypot(...v);

describe('clock helpers', () => {
  it('wraps minutes into [0, 1440)', () => {
    expect(wrapMinutes(0)).toBe(0);
    expect(wrapMinutes(1440)).toBe(0);
    expect(wrapMinutes(-30)).toBe(1410);
    expect(wrapMinutes(1440 * 3 + 5)).toBe(5);
  });

  it('shifts by 30 minutes across midnight in both directions', () => {
    expect(shiftMinutes(h(23, 45), 30)).toBe(h(0, 15));
    expect(shiftMinutes(h(0, 10), -30)).toBe(h(23, 40));
  });

  it('formats HH:MM', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(h(9, 5))).toBe('09:05');
    expect(formatClock(h(23, 59.9))).toBe('23:59');
    expect(formatClock(1440)).toBe('00:00');
    expect(formatClock(-1)).toBe('23:59');
  });

  it('smoothstep clamps and is 0.5 at the midpoint', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5);
  });
});

describe('sun and moon direction (Y up, north = −Z, east = +X)', () => {
  it('returns unit vectors', () => {
    for (let m = 0; m < MINUTES_PER_DAY; m += 37) {
      expect(len(sunDirection(m))).toBeCloseTo(1);
      expect(len(moonDirection(m))).toBeCloseTo(1);
    }
  });

  it('rises due east at 06:00 and sets due west at 18:00', () => {
    const [rx, ry, rz] = sunDirection(h(6));
    expect([rx, ry, rz]).toEqual([1, expect.closeTo(0, 6), expect.closeTo(0, 6)]);
    const [sx, sy, sz] = sunDirection(h(18));
    expect(sx).toBeCloseTo(-1);
    expect(sy).toBeCloseTo(0);
    expect(sz).toBeCloseTo(0);
  });

  it('is highest at noon, leaning south (+Z), and lowest at midnight', () => {
    const noon = sunDirection(h(12));
    expect(noon[1]).toBeGreaterThan(0.85);
    expect(noon[2]).toBeGreaterThan(0);
    expect(sunDirection(0)[1]).toBeLessThan(-0.85);
  });

  it('is above the horizon exactly between 06:00 and 18:00', () => {
    expect(sunDirection(h(5, 59))[1]).toBeLessThan(0);
    expect(sunDirection(h(6, 1))[1]).toBeGreaterThan(0);
    expect(sunDirection(h(17, 59))[1]).toBeGreaterThan(0);
    expect(sunDirection(h(18, 1))[1]).toBeLessThan(0);
  });

  it('moves from east to west through the south by day', () => {
    expect(sunDirection(h(9))[0]).toBeGreaterThan(0);
    expect(sunDirection(h(15))[0]).toBeLessThan(0);
  });

  it('puts the moon opposite the sun', () => {
    for (const m of [0, h(6), h(9, 13), h(12), h(21)]) {
      const s = sunDirection(m);
      const mo = moonDirection(m);
      s.forEach((c, i) => expect(mo[i]).toBeCloseTo(-c));
    }
    expect(moonDirection(0)[1]).toBeGreaterThan(0.85);
  });

  it('is periodic over 24 h', () => {
    const a = sunDirection(h(7, 20));
    const b = sunDirection(h(7, 20) + MINUTES_PER_DAY);
    a.forEach((c, i) => expect(b[i]).toBeCloseTo(c));
  });
});

describe('sampleKeyframes', () => {
  const frames: Keyframe<number[]>[] = [
    { minute: h(6), value: [0, 10] },
    { minute: h(18), value: [12, 22] },
  ];

  it('returns exact values at keyframes', () => {
    expect(sampleKeyframes(frames, h(6))).toEqual([0, 10]);
    expect(sampleKeyframes(frames, h(18))).toEqual([12, 22]);
  });

  it('interpolates linearly between keyframes', () => {
    expect(sampleKeyframes(frames, h(12))).toEqual([6, 16]);
    expect(sampleKeyframes(frames, h(9))[0]).toBeCloseTo(3);
  });

  it('wraps across midnight between the last and first keyframe', () => {
    // 18:00 → 06:00 next day is 12 h; midnight is halfway.
    expect(sampleKeyframes(frames, 0)).toEqual([6, 16]);
    expect(sampleKeyframes(frames, h(21))[0]).toBeCloseTo(9);
    expect(sampleKeyframes(frames, h(3))[0]).toBeCloseTo(3);
  });

  it('accepts unsorted frames and out-of-range times', () => {
    const shuffled = [...frames].reverse();
    expect(sampleKeyframes(shuffled, h(12))).toEqual([6, 16]);
    expect(sampleKeyframes(frames, h(12) + MINUTES_PER_DAY)).toEqual([6, 16]);
    expect(sampleKeyframes(frames, h(12) - MINUTES_PER_DAY)).toEqual([6, 16]);
  });

  it('handles a single keyframe and rejects an empty list', () => {
    expect(sampleKeyframes([{ minute: 100, value: [4] }], 900)).toEqual([4]);
    expect(() => sampleKeyframes([], 0)).toThrow();
  });

  it('is continuous across midnight for the real palettes', () => {
    const a = sampleKeyframes(HORIZON_FRAMES, MINUTES_PER_DAY - 0.01);
    const b = sampleKeyframes(HORIZON_FRAMES, 0.01);
    a.forEach((c, i) => expect(b[i]).toBeCloseTo(c, 3));
  });

  it('converts hex to sRGB and lerps colours', () => {
    expect(hexToRgb(0xff8000)).toEqual([1, 128 / 255, 0]);
    expect(lerpRgb([0, 0, 0], [1, 0.5, 1], 0.5)).toEqual([0.5, 0.25, 0.5]);
  });
});

describe('computeSkyState', () => {
  it('is bright and sunlit at noon', () => {
    const s = computeSkyState(h(12));
    s.keyDir.forEach((c, i) => expect(c).toBeCloseTo(s.sunDir[i]!, 5));
    expect(s.keyIntensity).toBeGreaterThan(2);
    expect(s.sunVisibility).toBe(1);
    expect(s.starAlpha).toBe(0);
    expect(luma(s.horizon)).toBeGreaterThan(0.6);
  });

  it('switches the key light to the moon at night, dimmer but present', () => {
    const s = computeSkyState(0);
    // The moon light is lifted/capped in elevation but still comes from the moon's side.
    expect(s.keyDir[0] * s.moonDir[0] + s.keyDir[2] * s.moonDir[2]).toBeGreaterThanOrEqual(0);
    expect(s.keyDir[1]).toBeGreaterThan(0.5);
    expect(s.keyIntensity).toBeGreaterThan(0.3);
    expect(s.keyIntensity).toBeLessThanOrEqual(MOON_INTENSITY);
    expect(s.starAlpha).toBe(1);
    expect(s.moonVisibility).toBe(1);
    expect(s.sunVisibility).toBe(0);
  });

  it('keeps night readable: ambient and horizon never collapse to black', () => {
    for (let m = h(20); m <= h(28); m += 15) {
      const s = computeSkyState(m);
      expect(s.hemiIntensity, formatClock(m)).toBeGreaterThanOrEqual(0.7);
      expect(luma(s.hemiSky), formatClock(m)).toBeGreaterThan(0.3);
      expect(luma(s.hemiGround), formatClock(m)).toBeGreaterThan(0.1);
      expect(luma(s.horizon), formatClock(m)).toBeGreaterThan(0.1);
    }
  });

  it('is much dimmer at night than at noon, but never below a readable floor overall', () => {
    const night = computeSkyState(0);
    const day = computeSkyState(h(12));
    const total = (s: typeof night) => s.keyIntensity + s.hemiIntensity;
    expect(total(night)).toBeLessThan(total(day) * 0.6);
    expect(total(night)).toBeGreaterThan(1.8);
  });

  it('warms the horizon and sunlight at dawn and dusk', () => {
    for (const m of [h(6, 30), h(17, 45)]) {
      const s = computeSkyState(m);
      expect(s.horizon[0], formatClock(m)).toBeGreaterThan(s.horizon[2]);
      expect(s.keyColor[0], formatClock(m)).toBeGreaterThan(s.keyColor[2]);
    }
  });

  it('crossfades sun and moon so the key light never drops out at the horizon', () => {
    for (const m of [h(5, 30), h(6), h(6, 30), h(17, 30), h(18), h(18, 30)]) {
      const s = computeSkyState(m);
      expect(s.keyIntensity, formatClock(m)).toBeGreaterThanOrEqual(MOON_INTENSITY - 1e-9);
      expect(s.keyDir[1], formatClock(m)).toBeGreaterThan(0.2);
      expect(len(s.keyDir), formatClock(m)).toBeCloseTo(1, 5);
    }
  });

  it('lights twilight with a strong, warm hemisphere', () => {
    for (const m of [h(5, 30), h(6), h(6, 30), h(17, 30), h(18), h(18, 30)]) {
      const s = computeSkyState(m);
      expect(s.hemiIntensity, formatClock(m)).toBeCloseTo(1.8, 5);
      expect(s.hemiSky[0], formatClock(m)).toBeGreaterThan(s.hemiSky[2]);
    }
  });

  it('never lights the ground less than at midnight (twilight is not darker than night)', () => {
    const ground = (m: number) => {
      const s = computeSkyState(m);
      return s.keyIntensity * luma(s.keyColor) * Math.max(0, s.keyDir[1]) + s.hemiIntensity * luma(s.hemiSky);
    };
    const midnight = ground(0);
    for (let m = 0; m < MINUTES_PER_DAY; m += 15) {
      expect(ground(m), formatClock(m)).toBeGreaterThanOrEqual(midnight - 1e-9);
    }
  });

  it('changes smoothly: no large jumps in any lighting value between adjacent minutes', () => {
    let prev = computeSkyState(0);
    for (let m = 1; m <= MINUTES_PER_DAY; m++) {
      const cur = computeSkyState(m);
      expect(Math.abs(cur.keyIntensity - prev.keyIntensity), formatClock(m)).toBeLessThan(0.1);
      expect(Math.abs(cur.hemiIntensity - prev.hemiIntensity), formatClock(m)).toBeLessThan(0.05);
      cur.horizon.forEach((c, i) => expect(Math.abs(c - prev.horizon[i]!), formatClock(m)).toBeLessThan(0.05));
      prev = cur;
    }
  });

  it('is periodic', () => {
    const a = computeSkyState(h(7, 45));
    const b = computeSkyState(h(7, 45) + MINUTES_PER_DAY);
    expect(b.keyIntensity).toBeCloseTo(a.keyIntensity);
    expect(b.horizon).toEqual(a.horizon);
  });
});
