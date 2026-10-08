import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  KEY_HELP,
  keyHelpModel,
  mainMenuModel,
  optionsModel,
  parseSettings,
  serializeSettings,
  stepFov,
  stepQuality,
  stepUiScale,
  stepVolume,
} from './mainMenu';

describe('settings', () => {
  it('round-trips and survives bad storage', () => {
    const s = { quality: 'high' as const, volume: 0.3, muted: true, fov: 80, uiScale: 0.8, mouseLook: true };
    expect(parseSettings(serializeSettings(s))).toEqual(s);
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{oops')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{"quality":"ultra","volume":9,"muted":"x"}')).toEqual({ ...DEFAULT_SETTINGS, volume: 1 });
  });
  it('steps quality around and clamps volume', () => {
    expect(stepQuality('low')).toBe('medium');
    expect(stepQuality('high')).toBe('low');
    expect(stepVolume(0.7, 1)).toBe(0.8);
    expect(stepVolume(1, 1)).toBe(1);
    expect(stepVolume(0, -1)).toBe(0);
  });
});

describe('view settings', () => {
  it('clamps and snaps stored values', () => {
    expect(parseSettings('{"fov":500,"uiScale":0.1}')).toMatchObject({ fov: 100, uiScale: 0.6 });
    expect(parseSettings('{"fov":63}').fov).toBe(65);
  });
  it('steps and wraps', () => {
    expect(stepFov(60)).toBe(65);
    expect(stepFov(100)).toBe(50);
    expect(stepUiScale(0.9)).toBe(1);
    expect(stepUiScale(1)).toBe(0.6);
  });
  it('shows them in the options rows', () => {
    const m = optionsModel({ ...DEFAULT_SETTINGS, fov: 75, uiScale: 0.8, mouseLook: true });
    expect(m.rows.find((r) => r.id === 'fov')?.detail).toBe('75°');
    expect(m.rows.find((r) => r.id === 'uiScale')?.detail).toBe('80%');
    expect(m.rows.find((r) => r.id === 'mouseLook')?.detail).toBe('on');
  });
});

describe('menus', () => {
  it('offers Resume only once started and disables Continue without saves', () => {
    const ids = (started: boolean, hasSave: boolean) =>
      mainMenuModel({ started, hasSave }).rows.map((r) => [r.id, r.enabled !== false]);
    expect(ids(false, false)).toEqual([
      ['new', true],
      ['continue', false],
      ['load', false],
      ['options', true],
    ]);
    expect(ids(true, true)[0]).toEqual(['resume', true]);
  });
  it('reflects settings in the options rows', () => {
    const m = optionsModel({ ...DEFAULT_SETTINGS, quality: 'low', volume: 1, muted: true });
    expect(m.rows.find((r) => r.id === 'quality')?.detail).toBe('low');
    expect(m.rows.find((r) => r.id === 'volUp')?.enabled).toBe(false);
    expect(m.rows.find((r) => r.id === 'mute')?.detail).toBe('off');
  });
  it('lists every key help line', () => {
    expect(keyHelpModel().lines).toHaveLength(KEY_HELP.length);
  });
});
