/** Rebindable movement keys. Each action has two slots: slot 0 is the one Options > Controls rebinds, slot 1 keeps its default. */
export const BINDING_ACTIONS = ['forward', 'back', 'turnLeft', 'turnRight', 'run'] as const;
export type BindingAction = (typeof BINDING_ACTIONS)[number];
export type Bindings = Record<BindingAction, [string, string]>;

export const ACTION_LABELS: Record<BindingAction, string> = {
  forward: 'Walk forward',
  back: 'Walk back',
  turnLeft: 'Turn left',
  turnRight: 'Turn right',
  run: 'Run',
};

export const DEFAULT_BINDINGS: Readonly<Bindings> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  turnLeft: ['KeyA', 'ArrowLeft'],
  turnRight: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
};

export const BINDINGS_KEY = 'bok.bindings';

/** Keys that must stay free: the menu, the HUD hotkeys that open screens, and the debug/save keys. */
export const RESERVED_CODES: ReadonlySet<string> = new Set([
  'Escape',
  'Tab',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
  'BracketLeft',
  'BracketRight',
]);

export const cloneBindings = (b: Readonly<Bindings> = DEFAULT_BINDINGS): Bindings =>
  Object.fromEntries(BINDING_ACTIONS.map((a) => [a, [...b[a]]])) as Bindings;

/** Reads stored bindings; anything missing or malformed falls back to the default for that action. */
export function parseBindings(json: string | null | undefined): Bindings {
  const out = cloneBindings();
  try {
    const raw: unknown = json ? JSON.parse(json) : {};
    if (!raw || typeof raw !== 'object') return out;
    for (const a of BINDING_ACTIONS) {
      const v = (raw as Record<string, unknown>)[a];
      if (Array.isArray(v) && v.length === 2 && v.every((c) => typeof c === 'string' && c.length > 0 && c.length < 32))
        out[a] = [v[0] as string, v[1] as string];
    }
  } catch {
    // corrupt storage: use defaults
  }
  return out;
}

export const serializeBindings = (b: Bindings): string => JSON.stringify(b);

/**
 * Binds `code` to slot 0 of `action`. If another action already used the key, that slot takes the key the
 * action just gave up, so no key ever drives two actions. Reserved keys are refused (returns undefined).
 */
export function rebind(b: Readonly<Bindings>, action: BindingAction, code: string): Bindings | undefined {
  if (RESERVED_CODES.has(code)) return undefined;
  const out = cloneBindings(b);
  const old = out[action][0];
  for (const a of BINDING_ACTIONS) {
    for (const slot of [0, 1] as const) {
      if (!(a === action && slot === 0) && out[a][slot] === code) out[a][slot] = old;
    }
  }
  out[action][0] = code;
  return out;
}

/** True when `code` is bound to `action` in either slot. */
export const isBound = (b: Readonly<Bindings>, action: BindingAction, code: string): boolean =>
  b[action][0] === code || b[action][1] === code;

/** Short readable name for a key code ('KeyW' -> 'W', 'ArrowUp' -> 'Up'). */
export function codeLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code
    .replace(/(Left|Right)$/, ' $1')
    .replace(/^Shift/, 'Shift')
    .trim();
}
