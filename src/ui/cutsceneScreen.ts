import { glyphFor, type Font } from '../formats/fnt';
import type { CutscenePlayer } from '../game/cutscene';
import { CREDITS_AREA, type CreditRow } from '../game/creditPages';
import { wrapText } from './dialogBox';
import { registerHudScreen, type HudEvent, type HudHost, type HudScreenHandler } from './hudRegistry';
import { layoutTownScreen, type TownLayout } from './townScreen';

/** Where the text of a cutscene sits in scene pixels: the lower text box of the original. */
export const CUTSCENE_TEXT_BOX = { x: 15, y: 125, width: 285, height: 66 } as const;

/** Keys that continue past a text pause. */
const CONTINUE_KEYS = new Set([' ', 'Enter']);

export function drawText(
  ctx: CanvasRenderingContext2D,
  font: Font,
  text: string,
  x: number,
  y: number,
  scale: number,
  css: string,
): void {
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

/**
 * Draw one player state: the picture scaled to fit, the fade over it (a 320x200 picture of the faded pixels, see
 * `fadeOverlay`, scaled the same way), then any text. Pure drawing.
 */
export function drawCutscene(
  ctx: CanvasRenderingContext2D,
  font: Font,
  layout: TownLayout,
  view: CutsceneDrawable,
  picture: CanvasImageSource | undefined,
  fade: CanvasImageSource | undefined,
  canvasWidth: number,
  canvasHeight: number,
): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  const s = layout.scale;
  if (picture) {
    const smoothing = ctx.imageSmoothingEnabled;
    // The 320x200 original stays crisp; an HD (upscaled) picture, and the fade over it, are resampled smoothly.
    const hd = (picture as { width?: number }).width! > 320;
    ctx.imageSmoothingEnabled = hd;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(picture, layout.x, layout.y, layout.width, layout.height);
    if (fade) ctx.drawImage(fade, layout.x, layout.y, layout.width, layout.height);
    ctx.imageSmoothingEnabled = smoothing;
  }
  if (view.creditRows) drawCredits(ctx, font, layout, view.creditRows);
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
export type CutsceneDrawable = Pick<CutscenePlayer, 'text' | 'creditRows'>;

/** Ink of the printed credits page. */
const CREDITS_INK = '#1c1206';

function textWidth(font: Font, text: string): number {
  let w = 0;
  for (let i = 0; i < text.length; i++) w += glyphFor(font, text.charCodeAt(i)).width;
  return w;
}

/** A credits page in the printed page's style: headings left, names right after a dotted leader, sentences centred. */
export function drawCredits(
  ctx: CanvasRenderingContext2D,
  font: Font,
  layout: TownLayout,
  rows: readonly CreditRow[],
): void {
  const s = layout.scale;
  const at = (x: number, y: number, text: string) =>
    drawText(ctx, font, text, layout.x + x * s, layout.y + y * s, s, CREDITS_INK);
  const dot = textWidth(font, '.');
  for (const r of rows) {
    if (r.centre) {
      at((CREDITS_AREA.left + CREDITS_AREA.right - textWidth(font, r.centre)) / 2, r.y, r.centre);
      continue;
    }
    const nameX = r.right ? CREDITS_AREA.right - textWidth(font, r.right) : CREDITS_AREA.right;
    if (r.left) {
      at(CREDITS_AREA.left, r.y, r.left);
      // Dots from just after the heading to just before the name.
      const from = CREDITS_AREA.left + textWidth(font, r.left) + 2;
      const n = Math.max(0, Math.floor((nameX - 2 - from) / dot));
      if (r.right && n > 0) at(nameX - 2 - n * dot, r.y, '.'.repeat(n));
    }
    if (r.right) at(nameX, r.y, r.right);
  }
}

/** What the game gives the cutscene screen when it opens it. */
export interface CutsceneScreenView {
  player: CutscenePlayer;
  /** The picture changed: a canvas of the player's current image. */
  picture(): CanvasImageSource | undefined;
  /** The palette fade over the picture (320x200), or undefined when nothing shown is faded. */
  fade(): CanvasImageSource | undefined;
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
    // A book or dialogue opened by the cutscene itself takes the screen over; the cutscene waits underneath.
    if (v?.player.waitingForExternal) return;
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
    if (!v) return;
    const { width, height, font } = this.host;
    drawCutscene(ctx, font, this.layout, v.player, v.picture(), v.fade(), width, height);
  }
}

registerHudScreen('cutscene', (host) => new CutsceneScreen(host));
