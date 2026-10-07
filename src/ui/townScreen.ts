import { glyphFor, type Font } from '../formats/fnt';
import { HotspotAction, type Hotspot } from '../formats/gds';
import { SCENE_HEIGHT, SCENE_WIDTH, type SceneImage } from '../game/townScene';

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
export const toScenePoint = (l: TownLayout, x: number, y: number): [number, number] => [(x - l.x) / l.scale, (y - l.y) / l.scale];

/** The first hotspot whose rectangle contains the canvas point. */
export function hotspotAt(l: TownLayout, hotspots: readonly Hotspot[], x: number, y: number): Hotspot | undefined {
  const [sx, sy] = toScenePoint(l, x, y);
  return hotspots.find((h) => sx >= h.x && sy >= h.y && sx < h.x + h.width && sy < h.y + h.height);
}

export interface TownState {
  hover: Hotspot | undefined;
}

export type TownResult =
  | { kind: 'none' }
  | { kind: 'click' | 'describe'; hotspot: Hotspot };

export type TownEvent =
  | { type: 'hover' | 'click' | 'rightClick'; x: number; y: number }
  | { type: 'key'; key: string };

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

/** Draw the scene picture on black, with the hovered hotspot outlined and named. Clears nothing else. */
export function drawTownScreen(
  ctx: CanvasRenderingContext2D,
  font: Font,
  layout: TownLayout,
  picture: CanvasImageSource,
  state: TownState,
  canvasWidth: number,
  canvasHeight: number,
): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  const smoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(picture, layout.x, layout.y, layout.width, layout.height);
  ctx.imageSmoothingEnabled = smoothing;

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
