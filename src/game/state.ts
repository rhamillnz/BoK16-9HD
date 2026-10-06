import {
  type ExpiringEvent,
  type GamSave,
  type GameTime,
  decodeTime,
  eventFlagLocation,
  readEventFlag,
} from '../formats/gam';

/**
 * Game clock and world state. See docs/formats/gamestate.md.
 *
 * Pure functions over an immutable `WorldState`; every mutator returns a new
 * state and leaves its input untouched. Effects on characters (healing,
 * rations, sleep damage) are *reported* in `TimeReport`, not applied: the
 * condition tables they need are outside this module.
 */

/** Game time units are ticks of two game seconds (original `Time`). */
export const SECONDS_PER_TICK = 2;
export const TICKS_PER_MINUTE = 30;
export const TICKS_PER_HOUR = 0x708;
export const TICKS_PER_DAY = 0xa8c0;
export const MINUTES_PER_DAY = 1440;

/** Original named durations, in ticks. */
export const TIMES = {
  halfHour: 0x384,
  oneHour: TICKS_PER_HOUR,
  threeHours: 0x1518,
  eightHours: 0x3840,
  twelveHours: 0x5460,
  thirteenHours: 0x5b68,
  seventeenHours: 0x7788,
  eighteenHours: 0x7e90,
  oneDay: TICKS_PER_DAY,
} as const;

/** Rest heal parameters passed per hour: [healFraction, healPercentCeiling]. */
export const REST_PARAMS = {
  inn: { healFraction: 0x85, healPercentCeiling: 0x64 },
  camp: { healFraction: 0x64, healPercentCeiling: 0x50 },
} as const;

/** Resting longer than this in one go cures the Sick condition. */
export const REST_CURES_SICK_AFTER = TIMES.thirteenHours;

export interface WorldState {
  chapter: number;
  /** World time in ticks. */
  ticks: number;
  /** Time of the last sleep, in ticks. */
  ticksLastSlept: number;
  /** Save bytes (own copy) holding the event flags. */
  bytes: Uint8Array;
  expiringEvents: ExpiringEvent[];
}

export function createWorldState(save: GamSave): WorldState {
  return {
    chapter: save.chapter,
    ticks: save.time.ticks,
    ticksLastSlept: save.timeLastSlept.ticks,
    bytes: save.bytes.slice(),
    expiringEvents: save.expiringEvents.map((e) => ({ ...e })),
  };
}

/**
 * Begin a chapter, as the original chapter transition does: skip to the next
 * midnight, add the chapter's `timeElapsed` (CHAPn.DAT `timeChange`), and mark
 * the party as freshly rested.
 */
export function startChapter(s: WorldState, chapter: number, timeElapsed: number): WorldState {
  const next = s.ticks + TICKS_PER_DAY;
  const ticks = next - (next % TICKS_PER_DAY) + timeElapsed;
  return { ...s, chapter, ticks, ticksLastSlept: ticks };
}

export const worldTime = (s: WorldState): GameTime => decodeTime(s.ticks);

/** 0..1439. Feed to `SkyDome.update`. Fractional: includes the current second. */
export function minutesSinceMidnight(ticks: number): number {
  const seconds = ((ticks % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY * SECONDS_PER_TICK;
  return seconds / 60;
}

export const worldMinutes = (s: WorldState): number => minutesSinceMidnight(s.ticks);

export const hourOfDay = (ticks: number): number => Math.floor(ticks / TICKS_PER_HOUR) % 24;
export const dayNumber = (ticks: number): number => Math.floor(ticks / TICKS_PER_DAY);

/** Ticks since the party last slept. */
export const timeSinceSlept = (s: WorldState): number => s.ticks - s.ticksLastSlept;

export function formatTime(ticks: number): string {
  const t = decodeTime(ticks);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `day ${t.days} ${pad(t.hour)}:${pad(t.minute)}`;
}

// ---- Event flags -----------------------------------------------------------

export function getFlag(s: WorldState, ptr: number): boolean {
  return readEventFlag(s.bytes, ptr);
}

export function setFlag(s: WorldState, ptr: number, value: boolean): WorldState {
  const { byte, bit } = eventFlagLocation(ptr);
  if (byte + 2 > s.bytes.length) {
    throw new RangeError(`event flag 0x${ptr.toString(16)} at ${byte} past end (${s.bytes.length})`);
  }
  const bytes = s.bytes.slice();
  const word = bytes[byte]! | (bytes[byte + 1]! << 8);
  const next = value ? word | (1 << bit) : word & ~(1 << bit) & 0xffff;
  bytes[byte] = next & 0xff;
  bytes[byte + 1] = next >> 8;
  return { ...s, bytes };
}

// ---- Time ------------------------------------------------------------------

export interface AdvanceOptions {
  /** Original `mustConsumeRations`; true when walking or camping. */
  consumeRations?: boolean;
  /** Original `isNotSleeping`; false while resting. */
  awake?: boolean;
  /** Original `canDisplayDialog`; the sleep warnings only fire when true. */
  canShowDialog?: boolean;
  /** Per-hour heal fraction (see REST_PARAMS); 0 outside resting. */
  healFraction?: number;
  healPercentCeiling?: number;
}

/** What the caller must apply to characters after a time step. */
export interface TimeReport {
  ticksAdvanced: number;
  daysCrossed: number;
  /** The hour of day changed: apply per-hour condition effects. */
  hourChanged: boolean;
  /** Every 30th day: +1 to health and stamina for the active party. */
  improveHealthStamina: boolean;
  /** A day boundary was crossed: each active character eats a ration (or starves). */
  consumeRations: boolean;
  /** A day boundary was crossed: improve each character's NearDeath condition. */
  improveNearDeath: boolean;
  /** Awake 17+ hours at an hour change: show the need-sleep warning. */
  needSleep: boolean;
  /** Awake 18+ hours at an hour change: damage each character's health. */
  sleepDamage: boolean;
  /** Apply per-hour condition effects with these heal parameters. */
  hourlyHeal: { healFraction: number; healPercentCeiling: number } | null;
  /** Event pointers set or reset by expiring events that finished. */
  flagsChanged: { ptr: number; value: boolean }[];
}

/** Reduce expiring events by `delta`; finished ones fire (set/reset) and are removed. */
export function elapseExpiringEvents(
  s: WorldState,
  delta: number,
): { state: WorldState; flagsChanged: { ptr: number; value: boolean }[] } {
  let state = s;
  const flagsChanged: { ptr: number; value: boolean }[] = [];
  const remaining: ExpiringEvent[] = [];
  for (const e of s.expiringEvents) {
    const duration = e.duration < delta ? 0 : e.duration - delta;
    if (duration === 0) {
      if (e.type === 3 || e.type === 4) {
        const value = e.type === 3;
        state = setFlag(state, e.data, value);
        flagsChanged.push({ ptr: e.data, value });
      }
      continue;
    }
    remaining.push({ ...e, duration });
  }
  return { state: { ...state, expiringEvents: remaining }, flagsChanged };
}

/**
 * Advance the world clock. Mirrors the original time-change routine: day
 * boundaries drive rations and near-death recovery, hour boundaries drive
 * sleep warnings and per-hour condition effects. Like the original, boundaries
 * are detected by comparing day number and hour-of-day before and after, so a
 * single step of exactly 24 h would show a day change without an hour change.
 */
export function advanceTime(
  s: WorldState,
  delta: number,
  opts: AdvanceOptions = {},
): { state: WorldState; report: TimeReport } {
  if (!Number.isInteger(delta) || delta < 0) throw new RangeError(`bad time delta ${delta}`);
  const { consumeRations = true, awake = true, canShowDialog = true, healFraction = 0, healPercentCeiling = 0 } = opts;

  const ticks = s.ticks + delta;
  const daysCrossed = dayNumber(ticks) - dayNumber(s.ticks);
  const hourChanged = hourOfDay(ticks) !== hourOfDay(s.ticks);
  const dayChanged = daysCrossed !== 0;

  const moved: WorldState = { ...s, ticks };
  const { state, flagsChanged } = elapseExpiringEvents(moved, delta);

  const slept = ticks - s.ticksLastSlept;
  const warn = hourChanged && canShowDialog && awake;
  return {
    state,
    report: {
      ticksAdvanced: delta,
      daysCrossed,
      hourChanged,
      improveHealthStamina: dayChanged && dayNumber(ticks) % 30 === 0,
      consumeRations: dayChanged && consumeRations,
      improveNearDeath: dayChanged,
      needSleep: warn && slept >= TIMES.seventeenHours,
      sleepDamage: warn && slept >= TIMES.eighteenHours,
      hourlyHeal: hourChanged ? { healFraction, healPercentCeiling } : null,
      flagsChanged,
    },
  };
}

/** Time spent walking: one movement step. */
export function elapseInMainView(s: WorldState, delta: number) {
  return advanceTime(s, delta);
}

/**
 * One hour of rest. As in the original, the step is always exactly one hour
 * regardless of how long the player intends to rest; the caller loops. It also
 * resets the time-last-slept stamp.
 */
export function restOneHour(s: WorldState, inInn: boolean) {
  const { healFraction, healPercentCeiling } = inInn ? REST_PARAMS.inn : REST_PARAMS.camp;
  const r = advanceTime(s, TIMES.oneHour, { awake: false, healFraction, healPercentCeiling });
  return { state: { ...r.state, ticksLastSlept: r.state.ticks }, report: r.report };
}

/** Whole hours until the clock next reads `targetHour` (1..24; a full day if already there). */
export function hoursUntil(ticks: number, targetHour: number): number {
  const diff = (((targetHour - hourOfDay(ticks)) % 24) + 24) % 24;
  return diff === 0 ? 24 : diff;
}

/** Base health points restored per resting hour, before condition adjustments. */
export function restHealPerHour(healFraction: number, healingActive: boolean): number {
  const base = Math.floor(healFraction / 100);
  return healingActive ? base * 2 : base;
}
