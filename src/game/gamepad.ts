/**
 * Gamepad support (standard mapping). Pure: `padFrame` turns one pad snapshot into analog walking input
 * and edge-triggered key presses; `inputControls.ts` polls the browser and dispatches the presses as
 * keyboard events, so every screen and hotkey works with a pad without knowing about it.
 *
 *   World:  left stick walk/turn, right stick turn, RT run; A open/talk (E), X character (C), Y inventory (I),
 *           LB cast (V), RB camp (R), Back map (Tab), Start menu (Esc)
 *   Screen: d-pad or left stick navigate, A confirm (Enter), B back (Esc), LB/RB switch tab (E / Tab), Start Esc
 *   Combat: A Enter, B defend (D), X slash (S), Y shoot (F), LB wait (W), RB cast (C), LT retreat (Q), Start Esc
 */
export type PadContext = 'world' | 'screen' | 'combat';

export interface PadSnapshot {
  buttons: readonly boolean[];
  axes: readonly number[];
}

export interface PadFrame {
  moveAxis: number;
  turnAxis: number;
  run: boolean;
  /** Key codes newly pressed this frame. */
  presses: string[];
}

export const DEADZONE = 0.2;
const NAV_THRESHOLD = 0.6;

const A = 0, B = 1, X = 2, Y = 3, LB = 4, RB = 5, LT = 6, RT = 7, BACK = 8, START = 9, UP = 12, DOWN = 13, LEFT = 14, RIGHT = 15;

/** Button index to key code, per context. */
export const PAD_KEYS: Record<PadContext, Readonly<Record<number, string>>> = {
  world: { [A]: 'KeyE', [X]: 'KeyC', [Y]: 'KeyI', [LB]: 'KeyV', [RB]: 'KeyR', [BACK]: 'Tab', [START]: 'Escape' },
  screen: { [A]: 'Enter', [B]: 'Escape', [LB]: 'KeyE', [RB]: 'Tab', [START]: 'Escape', [UP]: 'ArrowUp', [DOWN]: 'ArrowDown', [LEFT]: 'ArrowLeft', [RIGHT]: 'ArrowRight' },
  combat: { [A]: 'Enter', [B]: 'KeyD', [X]: 'KeyS', [Y]: 'KeyF', [LB]: 'KeyW', [RB]: 'KeyC', [LT]: 'KeyQ', [START]: 'Escape' },
};

/** Removes the dead zone and rescales so the usable range still reaches 1. */
export function deadzone(v: number, dz = DEADZONE): number {
  const a = Math.abs(v);
  if (!Number.isFinite(v) || a <= dz) return 0;
  return Math.sign(v) * Math.min(1, (a - dz) / (1 - dz));
}

/** The "key" value a synthesised keydown should carry for a code (menus read `key`, hotkeys read `code`). */
export function keyForCode(code: string): string {
  if (code.startsWith('Key')) return code.slice(3).toLowerCase();
  return code;
}

/**
 * `prev` is the pressed state of each button on the previous frame, including virtual buttons for the
 * left stick (indices 100 to 103: up, down, left, right) used to navigate screens.
 */
export function padFrame(pad: PadSnapshot, prev: readonly boolean[], ctx: PadContext): { frame: PadFrame; pressed: boolean[] } {
  const ax = (i: number) => deadzone(pad.axes[i] ?? 0);
  const pressed: boolean[] = [];
  for (let i = 0; i < 16; i++) pressed[i] = pad.buttons[i] ?? false;
  const lx = ax(0), ly = ax(1);
  pressed[100] = ly < 0 && -ly > NAV_THRESHOLD;
  pressed[101] = ly > 0 && ly > NAV_THRESHOLD;
  pressed[102] = lx < 0 && -lx > NAV_THRESHOLD;
  pressed[103] = lx > 0 && lx > NAV_THRESHOLD;

  const presses: string[] = [];
  const edge = (i: number) => pressed[i] === true && !prev[i];
  for (const [idx, code] of Object.entries(PAD_KEYS[ctx])) if (edge(Number(idx))) presses.push(code);
  if (ctx === 'screen') {
    const stick: [number, string][] = [[100, 'ArrowUp'], [101, 'ArrowDown'], [102, 'ArrowLeft'], [103, 'ArrowRight']];
    for (const [i, code] of stick) if (edge(i)) presses.push(code);
  }

  let moveAxis = 0, turnAxis = 0, run = false;
  if (ctx === 'world') {
    moveAxis = -ly + (pressed[UP] ? 1 : 0) - (pressed[DOWN] ? 1 : 0);
    turnAxis = -lx - ax(2) + (pressed[LEFT] ? 1 : 0) - (pressed[RIGHT] ? 1 : 0);
    run = pressed[RT] === true;
  }
  return { frame: { moveAxis, turnAxis, run, presses }, pressed };
}
