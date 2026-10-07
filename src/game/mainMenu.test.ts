import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, KEY_HELP, keyHelpModel, mainMenuModel, optionsModel, parseSettings, serializeSettings, stepQuality, stepVolume } from './mainMenu';

describe('settings', () => {
  it('round-trips and survives bad storage', () => {
    const s = { quality: 'high' as const, volume: 0.3, muted: true };
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

describe('menus', () => {
  it('offers Resume only once started and disables Continue without saves', () => {
    const ids = (started: boolean, hasSave: boolean) => mainMenuModel({ started, hasSave }).rows.map((r) => [r.id, r.enabled !== false]);
    expect(ids(false, false)).toEqual([['new', true], ['continue', false], ['load', false], ['options', true]]);
    expect(ids(true, true)[0]).toEqual(['resume', true]);
  });
  it('reflects settings in the options rows', () => {
    const m = optionsModel({ quality: 'low', volume: 1, muted: true });
    expect(m.rows.find((r) => r.id === 'quality')?.detail).toBe('low');
    expect(m.rows.find((r) => r.id === 'volUp')?.enabled).toBe(false);
    expect(m.rows.find((r) => r.id === 'mute')?.detail).toBe('off');
  });
  it('lists every key help line', () => {
    expect(keyHelpModel().lines).toHaveLength(KEY_HELP.length);
  });
});
