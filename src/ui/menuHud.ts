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
import { drawTitleScreen, layoutTitle, type TitleArt } from './titleScreen';
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
  /** When set, the panel sits on the title screen (art, logo, heroes) instead of over the game. */
  private title: { art: TitleArt; since: number } | undefined;
  private frame = 0;
  constructor(private readonly host: HudHost) {}

  /** Show (or with undefined, hide) the title screen behind the panel. */
  setTitle(art: TitleArt | undefined): void {
    if (!art) this.title = undefined;
    else if (!this.title) this.title = { art, since: performance.now() };
    this.host.invalidate();
  }

  /** Replace what the panel shows. Open it with `HudScreens.open(MENU_SCREEN_ID)` when it is not already up. */
  show(model: MenuModel, onPick: (id: string) => void, onCancel: () => void, focusId?: string): void {
    const state = initialMenuState(model);
    const at = [...model.rows, ...model.buttons].findIndex((i) => i.id === focusId && i.enabled !== false);
    if (at >= 0) state.focus = at;
    const place = this.title && model.theme ? { top: layoutTitle(this.host.width, this.host.height).menuTop } : {};
    this.s = { model, layout: layoutMenu(model, this.host.width, this.host.height, place), state, onPick, onCancel };
    this.host.invalidate();
  }

  get active(): boolean {
    return this.s !== undefined;
  }

  /** Take the panel down without calling `onCancel`. */
  dismiss(): void {
    if (!this.s) return;
    this.s = undefined;
    this.title = undefined;
    cancelAnimationFrame(this.frame);
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
    if (this.title) {
      const { width, height, font } = this.host;
      const seconds = (performance.now() - this.title.since) / 1000;
      drawTitleScreen(ctx, font, this.title.art, layoutTitle(width, height), seconds, width, height);
      // Keep the candle shimmer and the fade moving while the title is up.
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(() => this.title && this.host.invalidate());
    }
    if (this.s) drawMenuScreen(ctx, this.host.font, this.s.layout, this.s.model, this.s.state);
  }
}

registerHudScreen(MENU_SCREEN_ID, (h) => new MenuPanelScreen(h));
