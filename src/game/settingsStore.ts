import { parseSettings, serializeSettings, SETTINGS_KEY, type GameSettings } from './mainMenu';

/** The player's settings, shared between the options menu and the features that apply them (input, camera, HUD). */
let current: GameSettings | undefined;
const listeners = new Set<(s: GameSettings) => void>();

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function getSettings(): GameSettings {
  current ??= parseSettings(storage()?.getItem(SETTINGS_KEY));
  return current;
}

/** Replaces the settings, saves them (best effort) and tells every listener. */
export function setSettings(s: GameSettings): void {
  current = s;
  try {
    storage()?.setItem(SETTINGS_KEY, serializeSettings(s));
  } catch {
    // storage unavailable: the options still apply this session
  }
  for (const fn of listeners) fn(s);
}

/** Calls `fn` now and after every change. */
export function onSettings(fn: (s: GameSettings) => void): void {
  listeners.add(fn);
  fn(getSettings());
}
