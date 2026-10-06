import type { GamSave } from '../formats/gam';
import {
  TIMES,
  advanceTime,
  createWorldState,
  elapseInMainView,
  formatTime,
  startChapter,
  worldMinutes,
  type TimeReport,
  type WorldState,
} from './state';

/**
 * Game ticks (2 game seconds each) that pass per real second spent walking. This is a tuning
 * estimate, not an original constant: 15 ticks is 30 game seconds per walking second, so a full
 * day/night cycle takes about 48 minutes of walking.
 */
export const WALK_TICKS_PER_SECOND = 15;

/** Owns the `WorldState` for the main view and turns walking time into game time. */
export class GameClock {
  private carry = 0;

  constructor(public state: WorldState) {}

  /** Build a clock from a save, begin `chapter` and apply its CHAPn.DAT time change. */
  static forChapter(save: GamSave, chapter: number, timeElapsed: number): GameClock {
    return new GameClock(startChapter(createWorldState(save), chapter, timeElapsed));
  }

  /** Minutes since midnight (fractional), for `SkyDome.update`. */
  get minutes(): number {
    return worldMinutes(this.state);
  }

  /** "day N HH:MM" for the debug HUD. */
  get label(): string {
    return formatTime(this.state.ticks);
  }

  /** Advance for `dt` real seconds of walking. Returns the report when at least one tick passed. */
  walk(dt: number): TimeReport | undefined {
    this.carry += Math.max(0, dt) * WALK_TICKS_PER_SECOND;
    const whole = Math.floor(this.carry);
    if (whole === 0) return undefined;
    this.carry -= whole;
    const { state, report } = elapseInMainView(this.state, whole);
    this.state = state;
    return report;
  }

  /** Debug: jump by `ticks` (negative allowed, clamped at tick 0). Event timers are not run backwards. */
  shift(ticks: number): void {
    if (ticks >= 0) {
      this.state = advanceTime(this.state, ticks).state;
    } else {
      this.state = { ...this.state, ticks: Math.max(0, this.state.ticks + ticks) };
    }
  }
}

export const DEBUG_TIME_STEP = TIMES.halfHour;
