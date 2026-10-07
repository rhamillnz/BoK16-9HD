import { glyphFor, type Font } from '../formats/fnt';
import type { CutscenePlayer } from '../game/cutscene';
import { wrapText } from './dialogBox';
import { registerHudScreen, type HudEvent, type HudHost, type HudScreenHandler } from './hudRegistry';
import { layoutTownScreen, type TownLayout } from './townScreen';

/** Where the text of a cutscene sits in scene pixels: the lower text box of the original. */
export const CUTSCENE_TEXT_BOX = { x: 15, y: 125, width: 285, height: 66 } as const;

/** Keys that continue past a text pause. */
const CONTINUE_KEYS = new Set([' ', 'Enter']);

function drawText(ctx: CanvasRenderingContext2D, font: Font, text: string, x: number, y: number, scale: number, css: string): void {
  ctx.fillStyle = css;
  let gx = x;
  for (let i = 0; i < text.length; i++) {
    const g = glyphFor(font, text.charCodeAt(i));
    for (let py = 0; py < g.height; py++) {
      for (let px = 0; px < g.width; px++) {
        if (g.pixels[py * g.width + px] !== 0) ctx.fillRect(gx + px * scale, y + py * scale, scale, scale);
      }
    }
    gx += g.width * scale;
  }
}

/** Draw one player state: the picture scaled to fit, the fade over it, then any text. Pure drawing. */
export function drawCutscene(ctx: CanvasRenderingContext2D, font: Font, layout: TownLayout, view: CutsceneDrawable, picture: CanvasImageSource | undefined, canvasWidth: number, canvasHeight: number): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  const s = layout.scale;
  if (picture) {
    const smoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(picture, layout.x, layout.y, layout.width, layout.height);
    ctx.imageSmoothingEnabled = smoothing;
  }
  const f = view.fade;
  if (f.alpha > 0) {
    ctx.fillStyle = `rgba(${f.color[0]},${f.color[1]},${f.color[2]},${f.alpha})`;
    ctx.fillRect(layout.x + f.region.x * s, layout.y + f.region.y * s, f.region.width * s, f.region.height * s);
  }
  if (view.text) {
    const box = CUTSCENE_TEXT_BOX;
    const x = layout.x + box.x * s;
    const y = layout.y + box.y * s;
    ctx.fillStyle = 'rgba(20,14,8,0.85)';
    ctx.fillRect(x, y, box.width * s, box.height * s);
    ctx.strokeStyle = '#c9a24a';
    ctx.lineWidth = Math.max(2, s / 3);
    ctx.strokeRect(x, y, box.width * s, box.height * s);
    const pad = 4;
    const rows = Math.floor((box.height - pad * 2) / (font.height + 1));
    let row = 0;
    for (const line of wrapText(font, view.text, box.width - pad * 2)) {
      if (row + (line.blankBefore ? 1 : 0) >= rows) break;
      if (line.blankBefore) row++;
      drawText(ctx, font, line.text, x + pad * s, y + (pad + row * (font.height + 1)) * s, s, '#f3e6c4');
      row++;
    }
  }
}

/** The part of a player the screen draws. */
export type CutsceneDrawable = Pick<CutscenePlayer, 'fade' | 'text'>;

/** What the game gives the cutscene screen when it opens it. */
export interface CutsceneScreenView {
  player: CutscenePlayer;
  /** The picture changed: a canvas of the player's current image. */
  picture(): CanvasImageSource | undefined;
}

/** The cutscene player as a registered, modal HUD screen ('cutscene'). A click or Space/Enter continues, Escape skips. */
export class CutsceneScreen implements HudScreenHandler {
  modal = true;
  private view: CutsceneScreenView | undefined;
  private layout: TownLayout;
  constructor(private readonly host: HudHost) {
    this.layout = layoutTownScreen(host.width, host.height);
  }

  open(arg?: unknown): boolean {
    const view = arg as CutsceneScreenView | undefined;
    if (!view) return false;
    this.view = view;
    return true;
  }

  close(): void {
    const v = this.view;
    this.view = undefined;
    v?.player.skip();
  }

  escape(): void {
    this.view?.player.skip();
  }

  event(ev: HudEvent): void {
    const v = this.view;
    if (!v) return;
    if (ev.type === 'click' || (ev.type === 'key' && CONTINUE_KEYS.has(ev.key))) v.player.click();
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const v = this.view;
    if (v) drawCutscene(ctx, this.host.font, this.layout, v.player, v.picture(), this.host.width, this.host.height);
  }
}

registerHudScreen('cutscene', (host) => new CutsceneScreen(host));

