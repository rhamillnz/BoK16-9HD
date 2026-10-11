import { POST_QUALITIES, parseQuality, type PostQuality } from '../render/postSettings';
import type { MenuModel } from '../ui/menuScreen';

/** Player options kept between sessions. */
export interface GameSettings {
  quality: PostQuality;
  /** Music volume, 0 to 1 in steps of 0.1. */
  volume: number;
  muted: boolean;
  /** Vertical field of view of the party camera, in degrees. */
  fov: number;
  /** Size of the HUD canvas relative to the full 16:9 window (1 = fills the window). */
  uiScale: number;
  /** Turn with the mouse in the party view (click the game to capture the pointer). */
  mouseLook: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  quality: 'medium',
  volume: 0.3,
  muted: false,
  fov: 60,
  uiScale: 1,
  mouseLook: false,
};
export const FOV_MIN = 50;
export const FOV_MAX = 100;
export const FOV_STEP = 5;
export const UI_SCALE_MIN = 0.6;
export const SETTINGS_KEY = 'bok.settings';
export const VOLUME_STEP = 0.1;

const clampFov = (v: number): number => Math.round(Math.min(FOV_MAX, Math.max(FOV_MIN, v)) / FOV_STEP) * FOV_STEP;
const clampUiScale = (v: number): number => Math.round(Math.min(1, Math.max(UI_SCALE_MIN, v)) * 10) / 10;

const clampVolume = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 10) / 10;

/** Reads stored settings; anything missing or malformed falls back to the defaults. */
export function parseSettings(json: string | null | undefined): GameSettings {
  let raw: Record<string, unknown> = {};
  try {
    const v: unknown = json ? JSON.parse(json) : {};
    if (v && typeof v === 'object') raw = v as Record<string, unknown>;
  } catch {
    // corrupt storage: use defaults
  }
  return {
    quality: parseQuality(typeof raw.quality === 'string' ? raw.quality : null, DEFAULT_SETTINGS.quality),
    volume:
      typeof raw.volume === 'number' && Number.isFinite(raw.volume) ? clampVolume(raw.volume) : DEFAULT_SETTINGS.volume,
    muted: typeof raw.muted === 'boolean' ? raw.muted : DEFAULT_SETTINGS.muted,
    fov: typeof raw.fov === 'number' && Number.isFinite(raw.fov) ? clampFov(raw.fov) : DEFAULT_SETTINGS.fov,
    uiScale:
      typeof raw.uiScale === 'number' && Number.isFinite(raw.uiScale)
        ? clampUiScale(raw.uiScale)
        : DEFAULT_SETTINGS.uiScale,
    mouseLook: typeof raw.mouseLook === 'boolean' ? raw.mouseLook : DEFAULT_SETTINGS.mouseLook,
  };
}

export const serializeSettings = (s: GameSettings): string => JSON.stringify(s);

export function stepQuality(q: PostQuality): PostQuality {
  return POST_QUALITIES[(POST_QUALITIES.indexOf(q) + 1) % POST_QUALITIES.length]!;
}

export const stepVolume = (v: number, dir: 1 | -1): number => clampVolume(v + dir * VOLUME_STEP);

/** Next field of view, wrapping from the widest back to the narrowest. */
export const stepFov = (v: number): number => (v + FOV_STEP > FOV_MAX ? FOV_MIN : clampFov(v + FOV_STEP));
/** Next UI scale, wrapping from full size back to the smallest. */
export const stepUiScale = (v: number): number => (v + 0.1 > 1.05 ? UI_SCALE_MIN : clampUiScale(v + 0.1));

export type MainMenuId = 'resume' | 'save' | 'new' | 'continue' | 'load' | 'intro' | 'options';
export type OptionsId =
  'quality' | 'volDown' | 'volUp' | 'mute' | 'fov' | 'uiScale' | 'mouseLook' | 'controls' | 'keys' | 'back';

export interface MainMenuState {
  /** The game is running (the menu was opened over it) so Resume makes sense. */
  started: boolean;
  /** There is at least one save to continue from. */
  hasSave: boolean;
  /** In-game time of the newest save, which Continue loads (e.g. "day 2 08:00"). */
  newest?: string;
}

export function mainMenuModel(s: MainMenuState, message?: string): MenuModel {
  return {
    title: 'Betrayal at Krondor',
    lines: [],
    rows: [
      ...(s.started
        ? [
            { id: 'resume', label: 'Resume' },
            { id: 'save', label: 'Save game' },
          ]
        : []),
      { id: 'new', label: 'New game' },
      { id: 'continue', label: 'Continue', enabled: s.hasSave },
      { id: 'load', label: 'Load game', enabled: s.hasSave },
      { id: 'intro', label: 'Replay introduction' },
      { id: 'options', label: 'Options' },
    ],
    buttons: [],
    // Continue picks up the newest save (autosave, quick save or a slot); New game starts the story over.
    message: message ?? (s.started ? undefined : s.newest ? `Continue: ${s.newest}` : 'No saved game yet'),
    width: 24,
    compact: true,
    ...(s.started ? {} : { theme: 'parchment' as const }),
  };
}

export const QUALITY_NOTES: Record<PostQuality, string> = {
  low: 'no post-processing or shadows',
  medium: 'bloom, colour grade, shadows',
  high: 'adds ambient occlusion',
};

export function optionsModel(s: GameSettings): MenuModel {
  return {
    title: 'Options',
    lines: [],
    rows: [
      { id: 'quality', label: 'Graphics quality', detail: s.quality },
      { id: 'volDown', label: 'Music volume down', detail: `${Math.round(s.volume * 100)}%`, enabled: s.volume > 0 },
      { id: 'volUp', label: 'Music volume up', detail: `${Math.round(s.volume * 100)}%`, enabled: s.volume < 1 },
      { id: 'mute', label: 'Music', detail: s.muted ? 'off' : 'on' },
      { id: 'fov', label: 'Field of view', detail: `${s.fov}°` },
      { id: 'uiScale', label: 'UI scale', detail: `${Math.round(s.uiScale * 100)}%` },
      { id: 'mouseLook', label: 'Mouse-look', detail: s.mouseLook ? 'on' : 'off' },
      { id: 'controls', label: 'Rebind movement keys' },
      { id: 'keys', label: 'Key help' },
    ],
    buttons: [{ id: 'back', label: 'Back' }],
    message: `Volume ${Math.round(s.volume * 100)}%. Graphics: ${QUALITY_NOTES[s.quality]}`,
  };
}

/** Every key the game uses, as [keys, what it does]. Keep in step with the controls in src/. */
export const KEY_HELP: readonly (readonly [string, string])[] = [
  ['W A S D / arrows', 'Walk and turn (rebindable in Options)'],
  ['Shift', 'Run'],
  ['Mouse', 'Turn, when Mouse-look is on in Options (click the game to capture)'],
  ['Gamepad', 'Sticks walk and turn, RT run, A open, X character, Y inventory, LB cast, RB camp, Back map, Start menu'],
  ['Esc', 'This menu; closes any open screen'],
  ['I', 'Inventory'],
  ['C', 'Character sheet'],
  ['Tab', 'Map'],
  ['E', 'Open the chest or container beside you'],
  ['R', 'Camp and rest'],
  ['V', 'Cast a healing or light spell'],
  ['F5 / F9', 'Quick save / quick load'],
  ['F6', 'Save and load slots'],
  ['M', 'Music on/off'],
  ['P', 'Cycle graphics quality'],
  ['[ and ]', 'Move the clock by 30 minutes (debug)'],
  ['F', 'Fly camera (debug)'],
  ['G', '10x walking speed on/off (testing)'],
  ['Combat', 'D defend, W wait, S slash, F shoot, C cast, Q retreat, Enter end turn'],
];

export function keyHelpModel(): MenuModel {
  return {
    title: 'Keys',
    lines: KEY_HELP.map(([k, what]) => `${k}: ${what}`),
    rows: [],
    buttons: [{ id: 'back', label: 'Back' }],
  };
}
