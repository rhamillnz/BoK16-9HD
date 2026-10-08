import { glyphFor, type Font } from '../formats/fnt';
import { chooseScale, type Rect } from './dialogBox';
import { drawText } from './cutsceneScreen';

/** Size of the original full-screen pictures (.SCX). */
export const ART_WIDTH = 320;
export const ART_HEIGHT = 200;
/** Size of the title logo (INT_TITL.BMX image 0) and of a HEADS.BMX portrait. */
export const LOGO_WIDTH = 184;
export const LOGO_HEIGHT = 110;
export const HEAD_WIDTH = 56;
export const HEAD_HEIGHT = 45;

/** Canvases the title screen draws; any missing piece is simply skipped. */
export interface TitleArt {
  /** The parchment scroll (OPTIONS0.SCX with its lettering removed). */
  sheet?: CanvasImageSource;
  /** "Betrayal at Krondor" (INT_TITL.BMX). */
  logo?: CanvasImageSource;
  /** Locklear, Gorath and Owyn (HEADS.BMX 0 to 2). */
  heads: readonly (CanvasImageSource | undefined)[];
}

export interface TitleLayout {
  /** Canvas pixels per original pixel: always a whole number so the pixel art stays crisp. */
  scale: number;
  sheet: Rect;
  logo: Rect;
  subtitle: { x: number; y: number; width: number; scale: number };
  heads: Rect[];
  /** Top of the menu panel and its width in menu layout units. */
  menuTop: number;
  menuUnits: number;
  credit: { x: number; y: number; scale: number };
}

const HEROES = ['Locklear', 'Gorath', 'Owyn'] as const;

/** Lays the title screen out for a canvas: the art at the largest whole scale that fits, centred. */
export function layoutTitle(width: number, height: number): TitleLayout {
  const scale = Math.max(1, Math.floor(Math.min(height / ART_HEIGHT, width / ART_WIDTH)));
  const sw = ART_WIDTH * scale;
  const sh = ART_HEIGHT * scale;
  const sheet: Rect = { x: Math.floor((width - sw) / 2), y: Math.floor((height - sh) / 2), width: sw, height: sh };
  const cx = sheet.x + sw / 2;
  const ls = Math.max(1, Math.floor(scale * 0.55));
  const logo: Rect = {
    x: Math.floor(cx - (LOGO_WIDTH * ls) / 2),
    y: sheet.y + 5 * scale,
    width: LOGO_WIDTH * ls,
    height: LOGO_HEIGHT * ls,
  };
  const text = chooseScale(height, 240);
  const subtitle = { x: cx, y: logo.y + logo.height + 2 * scale, width: sw, scale: text };
  const hs = Math.max(1, Math.floor(scale / 2));
  const gap = 10 * scale;
  const hw = HEAD_WIDTH * hs;
  const hh = HEAD_HEIGHT * hs;
  const rowW = 3 * hw + 2 * gap;
  const hy = subtitle.y + 12 * text + 2 * scale;
  const heads = [0, 1, 2].map((i): Rect => ({
    x: Math.floor(cx - rowW / 2 + i * (hw + gap)),
    y: hy,
    width: hw,
    height: hh,
  }));
  const credit = { x: cx, y: sheet.y + sh - 14 * scale, scale: Math.max(1, chooseScale(height, 360)) };
  return { scale, sheet, logo, subtitle, heads, menuTop: hy + hh + 14 * text, menuUnits: 22, credit };
}

/** 0 to 1 over `fadeSeconds`, for the slow fade in from black. */
export const fadeAlpha = (seconds: number, fadeSeconds = 1.4): number =>
  Math.min(1, Math.max(0, seconds / fadeSeconds));

/** A gentle candle-light shimmer: warm overlay strength, always within [0, 0.07]. */
export function flicker(seconds: number): number {
  const v = Math.sin(seconds * 5.1) * 0.5 + Math.sin(seconds * 12.7 + 1.3) * 0.3 + Math.sin(seconds * 2.3) * 0.2;
  return 0.035 + v * 0.035;
}

function textWidth(font: Font, text: string, scale: number): number {
  let w = 0;
  for (let i = 0; i < text.length; i++) w += glyphFor(font, text.charCodeAt(i)).width * scale;
  return w;
}

function centred(
  ctx: CanvasRenderingContext2D,
  font: Font,
  text: string,
  cx: number,
  y: number,
  s: number,
  css: string,
  shadow = '#1a0e06',
): void {
  const x = Math.floor(cx - textWidth(font, text, s) / 2);
  if (shadow) drawText(ctx, font, text, x + s, y + s, s, shadow);
  drawText(ctx, font, text, x, y, s, css);
}

/** Paints the title backdrop over the whole canvas. `seconds` is time since the screen opened. */
export function drawTitleScreen(
  ctx: CanvasRenderingContext2D,
  font: Font,
  art: TitleArt,
  layout: TitleLayout,
  seconds: number,
  width: number,
  height: number,
): void {
  const smoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  const bg = ctx.createRadialGradient(width / 2, height / 2, height * 0.3, width / 2, height / 2, height * 0.95);
  bg.addColorStop(0, '#2a1a0e');
  bg.addColorStop(1, '#070403');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  const { sheet, logo } = layout;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(sheet.x + layout.scale * 2, sheet.y + layout.scale * 2, sheet.width, sheet.height);
  if (art.sheet) ctx.drawImage(art.sheet, sheet.x, sheet.y, sheet.width, sheet.height);
  else {
    ctx.fillStyle = '#b08850';
    ctx.fillRect(sheet.x, sheet.y, sheet.width, sheet.height);
  }
  if (art.logo) ctx.drawImage(art.logo, logo.x, logo.y, logo.width, logo.height);
  else centred(ctx, font, 'Betrayal at Krondor', logo.x + logo.width / 2, logo.y + logo.height / 2, 8, '#e8c060');
  const sub = layout.subtitle;
  centred(ctx, font, 'The Remake', sub.x, sub.y, sub.scale + 2, '#6b2a10', '');
  layout.heads.forEach((r, i) => {
    const h = art.heads[i];
    if (h) ctx.drawImage(h, r.x, r.y, r.width, r.height);
    centred(ctx, font, HEROES[i]!, r.x + r.width / 2, r.y + r.height + sub.scale, sub.scale, '#2b1a0c', '');
  });
  const c = layout.credit;
  centred(
    ctx,
    font,
    'Midkemia and the Riftwar by Raymond E. Feist. Original game (c) 1993 Dynamix.',
    c.x,
    c.y,
    c.scale,
    '#4a2c12',
    '',
  );
  // Candle-light shimmer over the scroll, then the fade in from black.
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = `rgba(255,150,40,${flicker(seconds).toFixed(3)})`;
  ctx.fillRect(sheet.x, sheet.y, sheet.width, sheet.height);
  ctx.globalCompositeOperation = 'source-over';
  const a = 1 - fadeAlpha(seconds);
  if (a > 0) {
    ctx.fillStyle = `rgba(0,0,0,${a.toFixed(3)})`;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.imageSmoothingEnabled = smoothing;
}
