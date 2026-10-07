import { drawShopScreen, initialShopState, layoutShopScreen, stepShopScreen, type ShopLayout, type ShopModel, type ShopResult, type ShopScreenState } from './shopScreen';
import { registerHudScreen, type HudEvent, type HudHost, type HudScreenHandler } from './hudRegistry';

/** What the game gives the shop screen: the rows to show for a party member and what to do with clicks. */
export interface ShopView {
  model(member: number): ShopModel;
  /** A buy, haggle or sell request (`member` is the index into the model's `members`). */
  act(result: Exclude<ShopResult, { kind: 'none' } | { kind: 'member' } | { kind: 'leave' }>, member: number): void;
  /** The party left the shop screen. */
  closed(): void;
}

/**
 * The shop as a registered HUD screen ('shop'). Dialogues the shop plays pop up over it and end back at
 * the town scene, so the controller reopens it afterwards with `open('shop')` (state is kept; pass
 * `{ fresh: true }` to start over).
 */
export class ShopHudScreen implements HudScreenHandler {
  rightClick = true;
  private view: ShopView | undefined;
  private s: { layout: ShopLayout; state: ShopScreenState } | undefined;
  constructor(private readonly host: HudHost) {}

  setView(view: ShopView | undefined): void {
    this.view = view;
    this.s = undefined;
  }

  /** Text for the status line. */
  setMessage(message: string): void {
    if (this.s) this.s.state = { ...this.s.state, message };
    this.host.invalidate();
  }

  /** The member whose pack is showing. */
  get member(): number {
    return this.s?.state.member ?? 0;
  }

  open(arg?: unknown): boolean {
    const view = this.view;
    if (!view) return false;
    const fresh = (arg as { fresh?: boolean } | undefined)?.fresh;
    if (!this.s || fresh) {
      const members = view.model(0).members.length;
      this.s = { layout: layoutShopScreen(members, this.host.width, this.host.height), state: initialShopState() };
    }
    return true;
  }

  close(): void {
    const view = this.view;
    this.s = undefined;
    this.view = undefined;
    view?.closed();
  }

  event(ev: HudEvent): void {
    const { view, s } = this;
    if (!view || !s) return;
    const r = stepShopScreen(s.layout, s.state, view.model(s.state.member), ev);
    s.state = r.state;
    if (r.result.kind === 'leave') this.host.close();
    else if (r.result.kind !== 'none' && r.result.kind !== 'member') view.act(r.result, s.state.member);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.view && this.s) drawShopScreen(ctx, this.host.font, this.s.layout, this.s.state, this.view.model(this.s.state.member));
  }
}

registerHudScreen('shop', (h) => new ShopHudScreen(h));
