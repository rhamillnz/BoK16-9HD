import { glyphFor, type Font } from '../formats/fnt';
import { HotspotAction, type Hotspot } from '../formats/gds';
import { SCENE_HEIGHT, SCENE_WIDTH, type SceneImage } from '../game/townScene';
import { splitParagraphs, wrapParagraph } from './dialogBox';

/** A scene's flavour text: the place name and its description, shown under the picture while nothing else is. */
export interface TownFlavour {
  title: string;
  text: string;
}

/**
 * Split a flavour dialogue ("#Blue Wheel Inn#<tab>Undoubtedly...") at its second '#' into the name and the
 * description, as the original's dialogue display does. Undefined when the text has no name.
 */
export function parseFlavour(raw: string): TownFlavour | undefined {
  const m = /^#([^#]*)#([\s\S]*)$/.exec(raw);
  if (!m) return undefined;
  const text = splitParagraphs(m[2]!)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');
  return { title: m[1]!.trim(), text };
}

/** Scene rows (of 200) under the picture where the original's text area is. */
export const FLAVOUR_TOP = 118;
const FLAVOUR_MARGIN = 10;

/** Layout of the 320x200 scene picture inside the HUD canvas: scaled to fit and centred. */
export interface TownLayout {
  /** Canvas pixels per scene pixel. */
  scale: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function layoutTownScreen(canvasWidth: number, canvasHeight: number): TownLayout {
  const scale = Math.min(canvasWidth / SCENE_WIDTH, canvasHeight / SCENE_HEIGHT);
  const width = SCENE_WIDTH * scale;
  const height = SCENE_HEIGHT * scale;
  return { scale, width, height, x: (canvasWidth - width) / 2, y: (canvasHeight - height) / 2 };
}

/** Canvas pixel -> scene pixel (may fall outside 0..320 x 0..200). */
export const toScenePoint = (l: TownLayout, x: number, y: number): [number, number] => [
  (x - l.x) / l.scale,
  (y - l.y) / l.scale,
];

/** The first hotspot whose rectangle contains the canvas point. */
export function hotspotAt(l: TownLayout, hotspots: readonly Hotspot[], x: number, y: number): Hotspot | undefined {
  const [sx, sy] = toScenePoint(l, x, y);
  return hotspots.find((h) => sx >= h.x && sy >= h.y && sx < h.x + h.width && sy < h.y + h.height);
}

export interface TownState {
  hover: Hotspot | undefined;
}

export type TownResult = { kind: 'none' } | { kind: 'click' | 'describe'; hotspot: Hotspot };

export type TownEvent = { type: 'hover' | 'click' | 'rightClick'; x: number; y: number } | { type: 'key'; key: string };

export const initialTownState = (): TownState => ({ hover: undefined });

/** Pure state step: hover tracks the pointer; left click activates, right click asks for the tooltip. */
export function stepTown(
  layout: TownLayout,
  hotspots: readonly Hotspot[],
  state: TownState,
  ev: TownEvent,
): { state: TownState; result: TownResult } {
  if (ev.type === 'key') return { state, result: { kind: 'none' } };
  const hotspot = hotspotAt(layout, hotspots, ev.x, ev.y);
  const next = { hover: hotspot };
  if (ev.type === 'hover' || !hotspot) return { state: next, result: { kind: 'none' } };
  return { state: next, result: { kind: ev.type === 'click' ? 'click' : 'describe', hotspot } };
}

const ACTION_LABELS = new Map<number, string>([
  [HotspotAction.Exit, 'Leave'],
  [HotspotAction.Shop, 'Shop'],
  [HotspotAction.Inn, 'Inn'],
  [HotspotAction.Barmaid, 'Barmaid'],
  [HotspotAction.Container, 'Chest'],
  [HotspotAction.Lute, 'Play the lute'],
  [HotspotAction.Temple, 'Temple'],
  [HotspotAction.Teleport, 'Teleport'],
  [HotspotAction.Repair, 'Repairs'],
  [HotspotAction.Repair2, 'Repairs'],
  [HotspotAction.Goto, 'Enter'],
  [HotspotAction.Dialog, 'Talk'],
]);

export const hotspotLabel = (h: Hotspot): string => ACTION_LABELS.get(h.action) ?? '';

/** An RGBA scene picture as a canvas the HUD can draw (browser only). */
export function sceneCanvas(image: SceneImage): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext('2d')!.putImageData(new ImageData(image.rgba, image.width, image.height), 0, 0);
  return canvas;
}

function drawText(
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

/** The place name (centred, gold) and its description under the picture, in the scene's text area. */
function drawFlavour(ctx: CanvasRenderingContext2D, font: Font, layout: TownLayout, f: TownFlavour): void {
  const s = layout.scale;
  const fs = Math.max(1, Math.round((s * 2) / 3)); // the size the dialogue box uses
  const lineHeight = (font.height + 2) * fs;
  const left = layout.x + FLAVOUR_MARGIN * s;
  const width = (SCENE_WIDTH - 2 * FLAVOUR_MARGIN) * s;
  let y = layout.y + FLAVOUR_TOP * s;
  const titleWidth = [...f.title].reduce((w, ch) => w + glyphFor(font, ch.charCodeAt(0)).width * fs, 0);
  drawText(ctx, font, f.title, left + (width - titleWidth) / 2, y, fs, '#f0d060');
  y += lineHeight * 1.5;
  const bottom = layout.y + (SCENE_HEIGHT - 4) * s;
  for (const line of wrapParagraph(font, f.text, width / fs)) {
    if (y + lineHeight > bottom) break;
    drawText(ctx, font, line, left, y, fs, '#e8dcb8');
    y += lineHeight;
  }
}

/** Draw the scene picture on black, with its flavour text and the hovered hotspot outlined and named. */
export function drawTownScreen(
  ctx: CanvasRenderingContext2D,
  font: Font,
  layout: TownLayout,
  picture: CanvasImageSource,
  state: TownState,
  canvasWidth: number,
  canvasHeight: number,
  flavour?: TownFlavour,
): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  const smoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(picture, layout.x, layout.y, layout.width, layout.height);
  ctx.imageSmoothingEnabled = smoothing;
  if (flavour) drawFlavour(ctx, font, layout, flavour);

  const h = state.hover;
  if (!h) return;
  const s = layout.scale;
  const x = layout.x + h.x * s;
  const y = layout.y + h.y * s;
  ctx.strokeStyle = '#f0d060';
  ctx.lineWidth = Math.max(2, Math.round(s / 2));
  ctx.strokeRect(x, y, h.width * s, h.height * s);

  const label = hotspotLabel(h);
  if (label) {
    const fs = Math.max(1, Math.floor(s / 2));
    const ty = Math.max(layout.y, y - (font.height + 2) * fs);
    drawText(ctx, font, label, x + fs, ty, fs, '#000');
    drawText(ctx, font, label, x, ty - fs, fs, '#f0d060');
  }
}
