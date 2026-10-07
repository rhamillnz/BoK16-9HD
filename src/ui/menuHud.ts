import {
  drawMenuScreen,
  initialMenuState,
  layoutMenu,
  stepMenu,
  type MenuEvent,
  type MenuLayout,
  type MenuModel,
  type MenuState,
} from './menuScreen';
import { registerHudScreen, type HudEvent, type HudHost, type HudScreenHandler } from './hudRegistry';

export const MENU_SCREEN_ID = 'menuPanel';

/**
 * A modal panel of rows and buttons (see menuScreen.ts) that game features open to ask the player to
 * pick something: temple cures, blessings, teleport destinations. `onPick` runs for each pick and may
 * call `show` again for the next step; `onCancel` runs when the player presses Escape.
 */
export class MenuPanelScreen implements HudScreenHandler {
  modal = true;
  private s:
    | { model: MenuModel; layout: MenuLayout; state: MenuState; onPick: (id: string) => void; onCancel: () => void }
    | undefined;
  constructor(private readonly host: HudHost) {}

  /** Replace what the panel shows. Open it with `HudScreens.open(MENU_SCREEN_ID)` when it is not already up. */
  show(model: MenuModel, onPick: (id: string) => void, onCancel: () => void, focusId?: string): void {
    const state = initialMenuState(model);
    const at = [...model.rows, ...model.buttons].findIndex((i) => i.id === focusId && i.enabled !== false);
    if (at >= 0) state.focus = at;
    this.s = { model, layout: layoutMenu(model, this.host.width, this.host.height), state, onPick, onCancel };
    this.host.invalidate();
  }

  get active(): boolean {
    return this.s !== undefined;
  }

  /** Take the panel down without calling `onCancel`. */
  dismiss(): void {
    if (!this.s) return;
    this.s = undefined;
    this.host.end(MENU_SCREEN_ID);
  }

  open(): boolean {
    return this.s !== undefined;
  }

  private cancel(): void {
    const s = this.s;
    if (!s) return;
    this.dismiss();
    s.onCancel();
  }

  close(): void {
    this.cancel();
  }

  escape(): void {
    this.cancel();
  }

  event(ev: HudEvent): void {
    const s = this.s;
    if (!s || ev.type === 'rightClick') return;
    const r = stepMenu(s.layout, s.model, s.state, ev as MenuEvent);
    s.state = r.state;
    if (r.result.kind === 'pick') s.onPick(r.result.id);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.s) drawMenuScreen(ctx, this.host.font, this.s.layout, this.s.model, this.s.state);
  }
}

registerHudScreen(MENU_SCREEN_ID, (h) => new MenuPanelScreen(h));
