import type * as THREE from 'three/webgpu';
import { PartyKeyboard, type PartyController, type PartyInput } from '../world/partyController';
import { getBindings } from './bindingsStore';
import { keyForCode, padFrame, type PadContext } from './gamepad';
import { onSettings } from './settingsStore';

export interface InputHost {
  party: PartyController;
  camera: THREE.PerspectiveCamera;
  /** The 3D canvas, which captures the mouse for mouse-look. */
  canvas: HTMLElement;
  /** A HUD screen is open. */
  blocking(): boolean;
  combatActive(): boolean;
  /** The debug fly camera owns the mouse and keys. */
  flyMode(): boolean;
}

/** Degrees of turn per pixel of mouse movement. */
export const MOUSE_DEGREES_PER_PIXEL = 0.12;

/** Mouse movement in pixels to heading units (256 per circle); moving right turns right, which lowers the heading. */
export const mouseToHeading = (dx: number): number => -dx * MOUSE_DEGREES_PER_PIXEL * (256 / 360);

function activePad(): Gamepad | undefined {
  try {
    for (const p of navigator.getGamepads?.() ?? []) if (p?.connected && p.mapping === 'standard') return p;
  } catch {
    // no gamepad API (or blocked by permissions policy)
  }
  return undefined;
}

/**
 * Wires up everything about player input that is not a HUD screen: rebindable keys, gamepad, optional
 * mouse-look, and the field-of-view and UI-scale options. Returns the party's keyboard-plus-pad reader.
 */
export function installInput(h: InputHost): { read(): PartyInput; clear(): void } {
  const keys = new PartyKeyboard(window, getBindings);
  const pad = { moveAxis: 0, turnAxis: 0, run: false };
  let prev: boolean[] = [];

  const press = (code: string) => {
    const init = { code, key: keyForCode(code), bubbles: true, cancelable: true };
    window.dispatchEvent(new KeyboardEvent('keydown', init));
    window.dispatchEvent(new KeyboardEvent('keyup', init));
  };
  const poll = () => {
    const p = activePad();
    if (p) {
      const ctx: PadContext = h.blocking() ? 'screen' : h.combatActive() ? 'combat' : 'world';
      const { frame, pressed } = padFrame({ buttons: p.buttons.map((b) => b.pressed), axes: p.axes }, prev, ctx);
      prev = pressed;
      pad.moveAxis = frame.moveAxis;
      pad.turnAxis = frame.turnAxis;
      pad.run = frame.run;
      for (const code of frame.presses) press(code);
    } else {
      prev = [];
      pad.moveAxis = pad.turnAxis = 0;
      pad.run = false;
    }
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);

  let mouseLook = false;
  onSettings((s) => {
    mouseLook = s.mouseLook;
    const fov = new URLSearchParams(location.search).get('fov');
    const wanted = fov !== null && Number.isFinite(Number(fov)) ? Number(fov) : s.fov;
    if (h.camera.fov !== wanted) {
      h.camera.fov = wanted;
      h.camera.updateProjectionMatrix();
    }
    document.documentElement.style.setProperty('--ui-scale', String(s.uiScale));
    if (!mouseLook && document.pointerLockElement === h.canvas) document.exitPointerLock();
  });

  const wantsMouse = () => mouseLook && !h.blocking() && !h.combatActive() && !h.flyMode();
  window.addEventListener('mousedown', (e) => {
    if (e.button === 0 && wantsMouse() && document.pointerLockElement !== h.canvas) void Promise.resolve(h.canvas.requestPointerLock()).catch(() => undefined);
  });
  window.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== h.canvas) return;
    if (wantsMouse()) h.party.turnBy(mouseToHeading(e.movementX));
    else if (h.blocking() || h.combatActive()) document.exitPointerLock();
  });

  return {
    read: () => {
      const k = keys.read();
      return { ...k, run: k.run || pad.run, moveAxis: pad.moveAxis, turnAxis: pad.turnAxis };
    },
    clear: () => keys.clear(),
  };
}
