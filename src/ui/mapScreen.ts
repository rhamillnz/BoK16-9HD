import { glyphFor, measureString, type Font } from '../formats/fnt';
import { presentTiles, type ZoneMap } from '../formats/zoneMap';
import { TILE_SIZE } from '../formats/world';
import { overheadTiles, type OverheadPolygon } from '../world/overheadMap';
import { HUD_HEIGHT, HUD_WIDTH, chooseScale, type Rect } from './dialogBox';
import {
  COMPASS_POINTS,
  compassAngle,
  compassPoint,
  fitViewport,
  headingToMapDir,
  insideBounds,
  tileBounds,
  tileRect,
  worldToMap,
  type MapViewport,
} from './mapMath';

/** Where the party is: BaK world units (x east, y north) and an 8-bit counter-clockwise heading. */
export interface PartyPose {
  x: number;
  y: number;
  heading: number;
}

export interface MapColors {
  backdrop: string;
  panel: string;
  border: string;
  tile: string;
  tileEdge: string;
  grid: string;
  arrow: string;
  arrowEdge: string;
  text: string;
}

export const MAP_COLORS: MapColors = {
  backdrop: 'rgba(8, 5, 2, 0.88)',
  panel: '#2a1d0e',
  border: '#c9a24a',
  tile: '#6f5530',
  tileEdge: '#8d7040',
  grid: 'rgba(0, 0, 0, 0.25)',
  arrow: '#f4e4a8',
  arrowEdge: '#1a1006',
  text: '#f2dfaa',
};

export interface MapLayout {
  scale: number;
  panel: Rect;
  title: { x: number; y: number };
  viewport: MapViewport;
  tiles: [number, number][];
  /** Mines: overhead model polygons drawn over the tile blocks. */
  overhead?: OverheadPolygon[];
}

export function layoutMap(
  map: ZoneMap,
  width = HUD_WIDTH,
  height = HUD_HEIGHT,
  overhead?: OverheadPolygon[],
): MapLayout {
  const scale = chooseScale(height);
  const panel: Rect = {
    x: Math.floor(width * 0.2),
    y: Math.floor(height * 0.06),
    width: Math.floor(width * 0.6),
    height: Math.floor(height * 0.88),
  };
  const pad = 12 * scale;
  const title = { x: panel.x + pad, y: panel.y + pad };
  const top = title.y + 14 * scale;
  const area = { x: panel.x + pad, y: top, width: panel.width - 2 * pad, height: panel.y + panel.height - pad - top };
  const tiles = overhead?.length ? overheadTiles(overhead, TILE_SIZE) : presentTiles(map);
  return { scale, panel, title, viewport: fitViewport(tileBounds(tiles, 1), area), tiles, overhead };
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

function arrowPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  dir: { x: number; y: number },
  size: number,
): void {
  const px = -dir.y,
    py = dir.x;
  ctx.beginPath();
  ctx.moveTo(cx + dir.x * size, cy + dir.y * size);
  ctx.lineTo(cx - dir.x * size * 0.7 + px * size * 0.7, cy - dir.y * size * 0.7 + py * size * 0.7);
  ctx.lineTo(cx - dir.x * size * 0.3, cy - dir.y * size * 0.3);
  ctx.lineTo(cx - dir.x * size * 0.7 - px * size * 0.7, cy - dir.y * size * 0.7 - py * size * 0.7);
  ctx.closePath();
}

/** Fill each overhead polygon (BaK world units) in its palette colour. */
function drawOverhead(ctx: CanvasRenderingContext2D, polys: readonly OverheadPolygon[], v: MapViewport): void {
  for (const poly of polys) {
    ctx.beginPath();
    for (let i = 0; i < poly.points.length; i += 2) {
      const p = worldToMap(v, poly.points[i]!, poly.points[i + 1]!);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fillStyle = poly.fill;
    ctx.fill();
  }
}

/** Full-screen map: parchment-dark panel, explored-style tile blocks, party arrow. */
export function drawMap(
  ctx: CanvasRenderingContext2D,
  font: Font,
  layout: MapLayout,
  pose: PartyPose,
  zone: number,
  colors: MapColors = MAP_COLORS,
): void {
  const { scale, panel, viewport: v } = layout;
  ctx.fillStyle = colors.backdrop;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = colors.panel;
  ctx.fillRect(panel.x, panel.y, panel.width, panel.height);
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 2 * scale;
  ctx.strokeRect(panel.x, panel.y, panel.width, panel.height);

  drawText(
    ctx,
    font,
    `Map of zone ${zone}   facing ${compassPoint(pose.heading)}`,
    layout.title.x,
    layout.title.y,
    scale,
    colors.text,
  );

  if (layout.overhead?.length) drawOverhead(ctx, layout.overhead, v);
  else
    for (const [tx, ty] of layout.tiles) {
      const r = tileRect(v, tx, ty);
      ctx.fillStyle = colors.tile;
      ctx.fillRect(r.x, r.y, r.size, r.size);
      ctx.strokeStyle = colors.tileEdge;
      ctx.lineWidth = Math.max(1, scale / 2);
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.size - 1, r.size - 1);
    }

  const p = worldToMap(v, pose.x, pose.y);
  const size = Math.max(6 * scale, v.cell * 0.35);
  if (insideBounds(v.bounds, pose.x, pose.y)) {
    const dir = headingToMapDir(pose.heading);
    arrowPath(ctx, p.x, p.y, dir, size);
    ctx.fillStyle = colors.arrow;
    ctx.fill();
    ctx.strokeStyle = colors.arrowEdge;
    ctx.lineWidth = Math.max(1, scale);
    ctx.stroke();
  }
  const hint = 'Tab or Esc: close';
  drawText(
    ctx,
    font,
    hint,
    panel.x + panel.width - measureString(font, hint) * scale - 12 * scale,
    layout.title.y,
    scale,
    colors.text,
  );
}

export interface CompassLayout {
  scale: number;
  cx: number;
  cy: number;
  radius: number;
}

/** Compass at the top centre of the HUD. */
export function layoutCompass(width = HUD_WIDTH, height = HUD_HEIGHT): CompassLayout {
  const scale = chooseScale(height);
  const radius = 22 * scale;
  return { scale, cx: Math.floor(width / 2), cy: radius + 6 * scale, radius };
}

/** Round compass whose cardinal letters rotate so the party's facing is always at the top. */
export function drawCompass(
  ctx: CanvasRenderingContext2D,
  font: Font,
  layout: CompassLayout,
  heading: number,
  colors: MapColors = MAP_COLORS,
): void {
  const { scale, cx, cy, radius } = layout;
  ctx.fillStyle = colors.backdrop;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 2 * scale;
  ctx.stroke();

  for (let i = 0; i < COMPASS_POINTS.length; i++) {
    const label = COMPASS_POINTS[i]!;
    if (label.length > 1) continue;
    const a = compassAngle(heading, i * 32);
    const lx = cx + Math.sin(a) * radius * 0.68;
    const ly = cy - Math.cos(a) * radius * 0.68;
    const g = glyphFor(font, label.charCodeAt(0));
    drawText(
      ctx,
      font,
      label,
      lx - (g.width * scale) / 2,
      ly - (g.height * scale) / 2,
      scale,
      label === 'N' ? colors.arrow : colors.text,
    );
  }
  // Fixed pointer: the direction the party faces.
  ctx.fillStyle = colors.arrow;
  ctx.beginPath();
  ctx.moveTo(cx, cy - radius - 4 * scale);
  ctx.lineTo(cx - 4 * scale, cy - radius + 3 * scale);
  ctx.lineTo(cx + 4 * scale, cy - radius + 3 * scale);
  ctx.closePath();
  ctx.fill();
}
