import type { MenuPanelScreen } from '../ui/menuHud';
import type { MenuModel } from '../ui/menuScreen';
import {
  ACTION_LABELS,
  BINDING_ACTIONS,
  DEFAULT_BINDINGS,
  cloneBindings,
  codeLabel,
  rebind,
  type BindingAction,
  type Bindings,
} from '../world/bindings';
import { getBindings, setBindings } from './bindingsStore';

export function controlsModel(b: Readonly<Bindings>, message?: string): MenuModel {
  return {
    title: 'Movement keys',
    lines: ['Pick an action, then press the new key. The second key stays as it is.'],
    rows: [
      ...BINDING_ACTIONS.map((a) => ({
        id: a,
        label: ACTION_LABELS[a],
        detail: `${codeLabel(b[a][0])} / ${codeLabel(b[a][1])}`,
      })),
      { id: 'reset', label: 'Reset to defaults' },
    ],
    buttons: [{ id: 'back', label: 'Back' }],
    message,
  };
}

/** Options > Rebind movement keys. `back` runs when the player leaves the screen. */
export function showControlsMenu(panel: MenuPanelScreen, back: () => void, focus?: string, message?: string): void {
  const again = (f?: string, m?: string) => showControlsMenu(panel, back, f, m);
  panel.show(
    controlsModel(getBindings(), message),
    (id) => {
      if (id === 'back') return back();
      if (id === 'reset') {
        setBindings(cloneBindings(DEFAULT_BINDINGS));
        return again('reset', 'Defaults restored');
      }
      const action = id as BindingAction;
      panel.show(
        { title: ACTION_LABELS[action], lines: [], rows: [], buttons: [], message: 'Press the new key (Esc cancels)' },
        () => undefined,
        () => again(id),
      );
      const onKey = (e: KeyboardEvent) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.repeat) return;
        if (e.code === 'Escape') {
          window.removeEventListener('keydown', onKey, true);
          return again(id);
        }
        const next = rebind(getBindings(), action, e.code);
        if (!next) return again(id, `${codeLabel(e.code)} is reserved`);
        window.removeEventListener('keydown', onKey, true);
        setBindings(next);
        again(id, `${ACTION_LABELS[action]}: ${codeLabel(e.code)}`);
      };
      // Registered while the capture panel is up; swallows the key before any hotkey sees it.
      window.addEventListener('keydown', onKey, true);
    },
    back,
    focus,
  );
}
