import type { Font } from '../formats/fnt';
import { BOOK_UNIT, layoutBook, type BookSpread } from '../game/book';
import type { Book } from '../formats/book';
import { drawText } from './cutsceneScreen';
import { registerHudScreen, type HudEvent, type HudHost, type HudScreenHandler } from './hudRegistry';
import { layoutTownScreen, type TownLayout } from './townScreen';

/** What the game gives the book screen when it opens it. */
export interface BookScreenView {
  book: Book;
  /** BOOK.SCX as a canvas, when available. */
  background?: CanvasImageSource;
  /** BOOK.BMX images by index (as canvases); missing ones are skipped. */
  images: readonly (CanvasImageSource | undefined)[];
  /** Called once when the book has been read or skipped. */
  done(): void;
}

/** Keys that turn the page. */
const NEXT_KEYS = new Set([' ', 'Enter', 'ArrowRight', 'PageDown']);

const INK = '#2b1a0c';
const INK_ITALIC = '#6b3a1c';

/** Pure drawing of one spread: background, illustrations, text. `sizeOf` gives an image's pixel size. */
export function drawBookSpread(
  ctx: CanvasRenderingContext2D, font: Font, layout: TownLayout, view: Pick<BookScreenView, 'background' | 'images'>,
  spread: BookSpread | undefined, sizeOf: (img: CanvasImageSource) => { width: number; height: number }, canvasWidth: number, canvasHeight: number,
): void {
  ctx.fillStyle = '#1a120a';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  const s = layout.scale;
  const smoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  if (view.background) ctx.drawImage(view.background, layout.x, layout.y, layout.width, layout.height);
  else {
    ctx.fillStyle = '#d9c9a0';
    ctx.fillRect(layout.x, layout.y, layout.width, layout.height);
  }
  if (spread) {
    for (const im of spread.page.images) {
      const img = view.images[im.image];
      if (!img) continue;
      const size = sizeOf(img);
      const w = (size.width / BOOK_UNIT) * s;
      const h = (size.height / BOOK_UNIT) * s;
      const x = layout.x + (im.x / BOOK_UNIT) * s;
      const y = layout.y + (im.y / BOOK_UNIT) * s;
      const flipX = (im.mirroring & 1) !== 0 || im.mirroring === 3;
      const flipY = (im.mirroring & 2) !== 0;
      ctx.save();
      ctx.translate(flipX ? x + w : x, flipY ? y + h : y);
      ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      ctx.drawImage(img, 0, 0, w, h);
      ctx.restore();
    }
    const x0 = layout.x + (spread.page.x / BOOK_UNIT) * s;
    const y0 = layout.y + (spread.page.y / BOOK_UNIT) * s;
    let row = 0;
    for (const line of spread.lines) {
      if (line.blankBefore) row++;
      let gx = x0 + (line.indent ?? 0) * s;
      const gy = y0 + row * (font.height + 1) * s;
      for (const run of line.runs ?? [{ text: line.text, style: { italic: false } }]) {
        drawText(ctx, font, run.text, gx, gy, s, run.style.italic ? INK_ITALIC : INK);
        gx += measure(font, run.text) * s;
      }
      row++;
    }
  }
  ctx.imageSmoothingEnabled = smoothing;
}

function measure(font: Font, text: string): number {
  let w = 0;
  for (const ch of text) {
    const g = font.glyphs[ch.charCodeAt(0) - font.firstChar];
    w += g ? g.width : font.maxWidth;
  }
  return w;
}

/** The book player as a registered, modal HUD screen ('book'). Click, Space, Enter or Right turn the page, Escape skips. */
export class BookScreen implements HudScreenHandler {
  modal = true;
  private view: BookScreenView | undefined;
  private spreads: BookSpread[] = [];
  private index = 0;
  private readonly layout: TownLayout;
  constructor(private readonly host: HudHost) {
    this.layout = layoutTownScreen(host.width, host.height);
  }

  open(arg?: unknown): boolean {
    const view = arg as BookScreenView | undefined;
    if (!view) return false;
    this.spreads = layoutBook(view.book, this.host.font, (i) => {
      const img = view.images[i] as unknown as { width: number; height: number } | undefined;
      return img ? { width: img.width, height: img.height } : undefined;
    });
    if (this.spreads.length === 0) return false;
    this.view = view;
    this.index = 0;
    return true;
  }

  close(): void {
    this.finish();
  }

  escape(): void {
    this.finish();
  }

  /** Turn the page; the last page finishes the book. */
  advance(): void {
    if (!this.view) return;
    if (this.index + 1 >= this.spreads.length) this.finish();
    else {
      this.index++;
      this.host.invalidate();
    }
  }

  private finish(): void {
    const v = this.view;
    this.view = undefined;
    v?.done();
  }

  event(ev: HudEvent): void {
    if (ev.type === 'click' || (ev.type === 'key' && NEXT_KEYS.has(ev.key))) this.advance();
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const v = this.view;
    if (!v) return;
    const sizeOf = (img: CanvasImageSource) => img as unknown as { width: number; height: number };
    drawBookSpread(ctx, this.host.font, this.layout, v, this.spreads[this.index], sizeOf, this.host.width, this.host.height);
  }
}

registerHudScreen('book', (host) => new BookScreen(host));
