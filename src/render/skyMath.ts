/**
 * Pure time-of-day maths for the sky: sun/moon direction, colour keyframe
 * interpolation and the resulting lighting state. No three.js here so it can be
 * unit-tested in plain node. See sky.ts for the renderer side.
 *
 * World space: Y up, north = −Z, east = +X, so south = +Z.
 */

export const MINUTES_PER_DAY = 1440;

export type Vec3 = [number, number, number];
export type Rgb = [number, number, number];

/** The sun rises due east at 06:00, peaks at 12:00 and sets due west at 18:00. */
export const SUNRISE_MINUTE = 360;
/** How far the sun's arc leans towards the south (+Z), in radians. */
export const SUN_ARC_TILT = (24 * Math.PI) / 180;

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** GLSL-style smoothstep. Needs edge0 < edge1. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Wrap any minute count (negative or > 24 h) into [0, 1440). */
export function wrapMinutes(minutes: number): number {
  return ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/** Shift the clock, wrapping around midnight. */
export function shiftMinutes(minutes: number, delta: number): number {
  return wrapMinutes(minutes + delta);
}

/** "HH:MM" (24 h), truncating partial minutes. */
export function formatClock(minutes: number): string {
  const m = Math.floor(wrapMinutes(minutes));
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

// ---------------------------------------------------------------------------
// Sun and moon
// ---------------------------------------------------------------------------

/** Angle of the sun along its arc: 0 at sunrise, π/2 at noon, π at sunset, −π/2 at midnight. */
export function sunAngle(minutes: number): number {
  return ((wrapMinutes(minutes) - SUNRISE_MINUTE) / MINUTES_PER_DAY) * Math.PI * 2;
}

/** Unit vector pointing from the viewer towards the sun. y < 0 means below the horizon. */
export function sunDirection(minutes: number): Vec3 {
  const a = sunAngle(minutes);
  const s = Math.sin(a);
  return [Math.cos(a), s * Math.cos(SUN_ARC_TILT), s * Math.sin(SUN_ARC_TILT)];
}

/** The moon sits opposite the sun: it rises as the sun sets. */
export function moonDirection(minutes: number): Vec3 {
  const [x, y, z] = sunDirection(minutes);
  return [-x, -y, -z];
}

// ---------------------------------------------------------------------------
// Colour keyframes
// ---------------------------------------------------------------------------

/** "#rrggbb" or 0xrrggbb → sRGB components in 0..1. Blending is done in sRGB; sky.ts converts. */
export function hexToRgb(hex: number): Rgb {
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export interface Keyframe<T> {
  /** Minutes since midnight, 0..1440. */
  minute: number;
  value: T;
}

/** A copy of the frames ordered by minute. */
export function sortKeyframes<T>(frames: readonly Keyframe<T>[]): Keyframe<T>[] {
  return [...frames].sort((a, b) => a.minute - b.minute);
}

const isSorted = (frames: readonly Keyframe<unknown>[]): boolean =>
  frames.every((f, i) => i === 0 || frames[i - 1]!.minute <= f.minute);

/**
 * Linear interpolation between keyframes, wrapping around midnight so the last
 * and first frames blend smoothly. Frames need not be sorted.
 */
export function sampleKeyframes<T extends number[]>(frames: readonly Keyframe<T>[], minutes: number): T {
  if (frames.length === 0) throw new Error('sampleKeyframes: no keyframes');
  // Tables built with sortKeyframes() are already ordered; only sort unsorted input.
  const sorted = isSorted(frames) ? frames : sortKeyframes(frames);
  const t = wrapMinutes(minutes);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;

  let prev = last;
  let next = first;
  let prevMinute = last.minute - MINUTES_PER_DAY;
  let nextMinute = first.minute;
  for (let i = 0; i < sorted.length; i++) {
    const f = sorted[i]!;
    if (f.minute <= t) {
      prev = f;
      prevMinute = f.minute;
      const n = sorted[i + 1];
      next = n ?? first;
      nextMinute = n ? n.minute : first.minute + MINUTES_PER_DAY;
    }
  }
  const span = nextMinute - prevMinute;
  const u = span <= 0 ? 0 : (t - prevMinute) / span;
  return prev.value.map((v, i) => lerp(v, next.value[i]!, u)) as T;
}

const hm = (h: number, m = 0): number => h * 60 + m;
const rgbFrames = (rows: [number, number][]): Keyframe<Rgb>[] =>
  sortKeyframes(rows.map(([minute, hex]) => ({ minute, value: hexToRgb(hex) })));
const scalarFrames = (rows: [number, number][]): Keyframe<[number]>[] =>
  sortKeyframes(rows.map(([minute, v]) => ({ minute, value: [v] as [number] })));

/** Dome colour straight overhead. */
export const ZENITH_FRAMES = rgbFrames([
  [hm(0), 0x0b1330],
  [hm(4, 30), 0x14204a],
  [hm(5, 45), 0x2c3f7a],
  [hm(6, 30), 0x4f7fc0],
  [hm(8), 0x3f7ad0],
  [hm(12), 0x2f6fd0],
  [hm(16, 30), 0x3a72c4],
  [hm(17, 45), 0x41508f],
  [hm(18, 30), 0x28305f],
  [hm(19, 30), 0x141b45],
  [hm(21, 30), 0x0b1330],
]);

/** Dome colour at the horizon; also the fog colour. */
export const HORIZON_FRAMES = rgbFrames([
  [hm(0), 0x24335a],
  [hm(4, 30), 0x2f4070],
  [hm(5, 45), 0xe08a5a],
  [hm(6, 30), 0xf0b98a],
  [hm(8), 0xa9c8e8],
  [hm(12), 0xa8cdf0],
  [hm(16, 30), 0xb4cde6],
  [hm(17, 45), 0xf0955a],
  [hm(18, 30), 0xb8607a],
  [hm(19, 30), 0x3a3d6b],
  [hm(21, 30), 0x24335a],
]);

/** Colour of direct sunlight (only used while the sun is up). */
export const SUN_COLOR_FRAMES = rgbFrames([
  [hm(5, 30), 0xff7a40],
  [hm(6, 30), 0xffb070],
  [hm(8), 0xffe0b8],
  [hm(12), 0xfff1d6],
  [hm(16), 0xffe8c8],
  [hm(17, 30), 0xffb070],
  [hm(18, 30), 0xff7a40],
]);

/** Sunlight strength before the low-elevation fade. */
export const SUN_INTENSITY_FRAMES = scalarFrames([
  [hm(5, 30), 1.2],
  [hm(6, 30), 1.6],
  [hm(8), 2.2],
  [hm(12), 2.6],
  [hm(16), 2.3],
  [hm(17, 30), 1.8],
  [hm(18, 30), 1.2],
]);

export const HEMI_SKY_FRAMES = rgbFrames([
  [hm(0), 0x8ea8e8],
  [hm(4, 30), 0x8ea8e8],
  [hm(5, 30), 0xf2c49a],
  [hm(6, 30), 0xf0cca8],
  [hm(7, 30), 0xbcd4f0],
  [hm(12), 0xbcd4f0],
  [hm(16, 30), 0xbcd4f0],
  [hm(17, 30), 0xf2c49a],
  [hm(18, 30), 0xeeb899],
  [hm(19, 30), 0x8ea8e8],
  [hm(21, 30), 0x8ea8e8],
]);

export const HEMI_GROUND_FRAMES = rgbFrames([
  [hm(0), 0x3a4660],
  [hm(4, 30), 0x3a4660],
  [hm(5, 30), 0x6a5448],
  [hm(6, 30), 0x6a5444],
  [hm(7, 30), 0x4a3b28],
  [hm(16, 30), 0x4a3b28],
  [hm(17, 30), 0x6a5444],
  [hm(18, 30), 0x645048],
  [hm(19, 30), 0x3a4660],
  [hm(21, 30), 0x3a4660],
]);

/** Hemisphere (ambient) intensity. Deliberately well above zero at night. */
export const HEMI_INTENSITY_FRAMES = scalarFrames([
  [hm(0), 1.4],
  [hm(4, 30), 1.4],
  [hm(5, 30), 1.8],
  [hm(6, 30), 1.8],
  [hm(7, 30), 1.15],
  [hm(12), 1.2],
  [hm(16, 30), 1.1],
  [hm(17, 30), 1.8],
  [hm(18, 30), 1.8],
  [hm(19, 30), 1.4],
  [hm(21, 30), 1.4],
]);

export const MOON_COLOR: Rgb = hexToRgb(0x9bb4ff);
export const MOON_INTENSITY = 0.8;

// ---------------------------------------------------------------------------
// Combined state
// ---------------------------------------------------------------------------

export interface SkyState {
  sunDir: Vec3;
  moonDir: Vec3;
  zenith: Rgb;
  /** Horizon colour; the scene fog tracks this. */
  horizon: Rgb;
  /** Sunlight colour (valid even when the sun is down; used for the disc and glow). */
  sunColor: Rgb;
  /** Directional light: the sun by day, the moon at night, crossfaded through twilight. */
  keyDir: Vec3;
  keyColor: Rgb;
  keyIntensity: number;
  hemiSky: Rgb;
  hemiGround: Rgb;
  hemiIntensity: number;
  /** 0 = sun disc hidden below the horizon, 1 = fully visible. */
  sunVisibility: number;
  /** Same for the moon disc. */
  moonVisibility: number;
  /** 0 by day, 1 at night. */
  starAlpha: number;
}

/**
 * The sun's key-light weight ramps in over this elevation range (sin of altitude),
 * starting below the horizon so twilight is never unlit. The moon takes the rest.
 */
const KEY_FADE_FROM = -0.08;
const KEY_FADE_TO = 0.12;
/** While the sun and moon trade places their directions are lifted to at least this elevation. */
const KEY_MIN_ELEVATION = 0.35;

const liftDirection = ([x, y, z]: Vec3): Vec3 => [x, Math.max(y, KEY_MIN_ELEVATION), z];
/**
 * The moon light comes from the moon's side of the sky but at a fixed elevation, so night
 * lighting is flat (it neither peaks at midnight nor dips as the moon sinks). The disc itself
 * still follows moonDirection.
 */
const MOON_KEY_ELEVATION = 0.6;
const moonKeyDirection = ([x, , z]: Vec3): Vec3 => {
  const k = Math.sqrt(1 - MOON_KEY_ELEVATION ** 2) / (Math.hypot(x, z) || 1);
  return [x * k, MOON_KEY_ELEVATION, z * k];
};

export function computeSkyState(minutes: number): SkyState {
  const sunDir = sunDirection(minutes);
  const moonDir = moonDirection(minutes);

  // Crossfade sun -> moon. Opposite horizontal directions cancel while both lights are low,
  // leaving a high-ish light that keeps the ground lit; the weights sum to 1 so it never dips.
  const sunW = smoothstep(KEY_FADE_FROM, KEY_FADE_TO, sunDir[1]);
  const moonW = 1 - sunW;
  const sunLift = liftDirection(sunDir);
  const moonLift = moonKeyDirection(moonDir);
  const blended: Vec3 = [
    sunLift[0] * sunW + moonLift[0] * moonW,
    sunLift[1] * sunW + moonLift[1] * moonW,
    sunLift[2] * sunW + moonLift[2] * moonW,
  ];
  const blendedLen = Math.hypot(...blended);
  const keyDir = blended.map((v) => v / blendedLen) as Vec3;
  const sunColor = sampleKeyframes(SUN_COLOR_FRAMES, minutes);

  return {
    sunDir,
    moonDir,
    zenith: sampleKeyframes(ZENITH_FRAMES, minutes),
    horizon: sampleKeyframes(HORIZON_FRAMES, minutes),
    sunColor,
    keyDir,
    keyColor: lerpRgb(MOON_COLOR, sunColor, sunW),
    keyIntensity: sampleKeyframes(SUN_INTENSITY_FRAMES, minutes)[0] * sunW + MOON_INTENSITY * moonW,
    hemiSky: sampleKeyframes(HEMI_SKY_FRAMES, minutes),
    hemiGround: sampleKeyframes(HEMI_GROUND_FRAMES, minutes),
    hemiIntensity: sampleKeyframes(HEMI_INTENSITY_FRAMES, minutes)[0],
    sunVisibility: smoothstep(-0.12, 0, sunDir[1]),
    moonVisibility: smoothstep(-0.12, 0, moonDir[1]),
    starAlpha: 1 - smoothstep(-0.3, -0.05, sunDir[1]),
  };
}
