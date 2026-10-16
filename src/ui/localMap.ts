import { glyphFor, measureString, type Font } from '../formats/fnt';
import type { Town } from '../formats/fullMap';
import { TILE_SIZE } from '../formats/world';
import type { OverheadPolygon } from '../world/overheadMap';
import { headingToVector } from '../world/partyController';
import type { Rect } from './dialogBox';
import { compassPoint } from './mapMath';
import type { MapColors, PartyPose } from './mapScreen';

/**
 * The map screen as the manual describes it (pp. 20, 21): a map of the party's surroundings that zooms in and
 * out and turns with the party (N aligns it north), dark underground until explored; and the full map of the
 * kingdom with its cities (white) and towns (brown), named under the pointer.
 */

/** What the local map draws besides the zone's tiles. */
export interface MapExtras {
  /** Roads and paths (BaK world units). */
  roads?: { get(x: number, y: number): boolean };
  /** Underground: only explored places show. */
  explored?: (x: number, y: number) => boolean;
  /** The kingdom map, for the full-map view. */
  full?: FullMap;
}

export interface FullMap {
  image: CanvasImageSource & { width: number; height: number };
  towns: readonly Town[];
  /** The party's place on the full map (image pixels), when known. */
  party?: { x: number; y: number };
}

export interface LocalMapView {
  northUp: boolean;
  /** Tiles across the view. */
  zoom: number;
  full: boolean;
  /** Pointer position on the full map (canvas pixels), for naming the town under it. */
  hover?: { x: number; y: number };
}

/** Zoom steps, in tiles across. */
export const ZOOMS = [1, 2, 4, 8, 16] as const;

/** Cities on the full map (white points); every other place is a town (brown). The split is ours. */
export const CITIES: ReadonlySet<string> = new Set([
  'Krondor',
  'LaMut',
  'Romney',
  'Silden',
  'Highcastle',
  'Northwarden',
  'Tyr-Sog',
  'Yabon',
  'Sar-Sargoth',
  'Armengar',
  'Sarth',
]);

function text(
  ctx: CanvasRenderingContext2D,
  font: Font,
  s: string,
  x: number,
  y: number,
  scale: number,
  css: string,
): void {
  ctx.fillStyle = css;
  let gx = x;
  for (let i = 0; i < s.length; i++) {
    const g = glyphFor(font, s.charCodeAt(i));
    for (let py = 0; py < g.height; py++)
      for (let px = 0; px < g.width; px++)
        if (g.pixels[py * g.width + px] !== 0) ctx.fillRect(gx + px * scale, y + py * scale, scale, scale);
    gx += g.width * scale;
  }
}

/** World <-> screen for a view centred on the party: north up, or the party's facing up. */
export function mapTransform(pose: PartyPose, northUp: boolean, area: Rect, zoom: number) {
  const s = area.width / (zoom * TILE_SIZE);
  const cx = area.x + area.width / 2;
  const cy = area.y + area.height / 2;
  const f = northUp ? { x: 0, y: 1 } : headingToVector(pose.heading);
  const r = { x: f.y, y: -f.x };
  return {
    scale: s,
    centre: { x: cx, y: cy },
    toScreen(wx: number, wy: number): { x: number; y: number } {
      const dx = wx - pose.x;
      const dy = wy - pose.y;
      return { x: cx + (dx * r.x + dy * r.y) * s, y: cy - (dx * f.x + dy * f.y) * s };
    },
    toWorld(sx: number, sy: number): { x: number; y: number } {
      const a = (sx - cx) / s;
      const b = (cy - sy) / s;
      return { x: pose.x + r.x * a + f.x * b, y: pose.y + r.y * a + f.y * b };
    },
  };
}

/** The local map: tiles (or a mine's overhead plan), roads, fog underground, the party's arrow. */
export function drawLocalMap(
  ctx: CanvasRenderingContext2D,
  font: Font,
  panel: Rect,
  scale: number,
  colors: MapColors,
  pose: PartyPose,
  zone: number,
  tiles: readonly (readonly [number, number])[],
  overhead: readonly OverheadPolygon[] | undefined,
  extras: MapExtras | undefined,
  view: LocalMapView,
): void {
  ctx.fillStyle = colors.backdrop;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = colors.panel;
  ctx.fillRect(panel.x, panel.y, panel.width, panel.height);
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 2 * scale;
  ctx.strokeRect(panel.x, panel.y, panel.width, panel.height);
  const pad = 12 * scale;
  const titleY = panel.y + pad;
  const top = titleY + 14 * scale;
  const area: Rect = {
    x: panel.x + pad,
    y: top,
    width: panel.width - 2 * pad,
    height: panel.y + panel.height - pad - 12 * scale - top,
  };
  text(
    ctx,
    font,
    `Zone ${zone}   facing ${compassPoint(pose.heading)}   ${view.northUp ? 'north up' : 'turning'}`,
    panel.x + pad,
    titleY,
    scale,
    colors.text,
  );

  const t = mapTransform(pose, view.northUp, area, view.zoom);
  ctx.save();
  ctx.beginPath();
  ctx.rect(area.x, area.y, area.width, area.height);
  ctx.clip();
  ctx.fillStyle = '#120c05';
  ctx.fillRect(area.x, area.y, area.width, area.height);
  const poly = (pts: readonly { x: number; y: number }[]) => {
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
  };
  if (overhead?.length) {
    for (const o of overhead) {
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i < o.points.length; i += 2) pts.push(t.toScreen(o.points[i]!, o.points[i + 1]!));
      poly(pts);
      ctx.fillStyle = o.fill;
      ctx.fill();
    }
  } else {
    for (const [tx, ty] of tiles) {
      const x0 = tx * TILE_SIZE;
      const y0 = ty * TILE_SIZE;
      poly([
        t.toScreen(x0, y0),
        t.toScreen(x0 + TILE_SIZE, y0),
        t.toScreen(x0 + TILE_SIZE, y0 + TILE_SIZE),
        t.toScreen(x0, y0 + TILE_SIZE),
      ]);
      ctx.fillStyle = colors.tile;
      ctx.fill();
    }
  }
  // Roads, and the dark of the unexplored, sampled in screen-space blocks.
  const step = Math.max(2, Math.round(2 * scale));
  if (extras?.roads || extras?.explored) {
    for (let sy = area.y; sy < area.y + area.height; sy += step) {
      for (let sx = area.x; sx < area.x + area.width; sx += step) {
        const w = t.toWorld(sx + step / 2, sy + step / 2);
        if (extras.explored && !extras.explored(w.x, w.y)) {
          ctx.fillStyle = '#050302';
          ctx.fillRect(sx, sy, step, step);
        } else if (extras.roads?.get(w.x, w.y)) {
          ctx.fillStyle = '#c8ab72';
          ctx.fillRect(sx, sy, step, step);
        }
      }
    }
  }
  // The party: an arrow at the centre.
  const size = 7 * scale;
  const dir = view.northUp
    ? (() => {
        const v = headingToVector(pose.heading);
        return { x: v.x, y: -v.y };
      })()
    : { x: 0, y: -1 };
  const px = -dir.y;
  const py = dir.x;
  const { x: cx, y: cy } = t.centre;
  ctx.beginPath();
  ctx.moveTo(cx + dir.x * size, cy + dir.y * size);
  ctx.lineTo(cx - dir.x * size * 0.7 + px * size * 0.7, cy - dir.y * size * 0.7 + py * size * 0.7);
  ctx.lineTo(cx - dir.x * size * 0.3, cy - dir.y * size * 0.3);
  ctx.lineTo(cx - dir.x * size * 0.7 - px * size * 0.7, cy - dir.y * size * 0.7 - py * size * 0.7);
  ctx.closePath();
  ctx.fillStyle = colors.arrow;
  ctx.fill();
  ctx.strokeStyle = colors.arrowEdge;
  ctx.lineWidth = Math.max(1, scale);
  ctx.stroke();
  ctx.restore();
  const hint = `+/- zoom   N: ${view.northUp ? 'turn with party' : 'north up'}   ${extras?.full ? 'F: full map   ' : ''}Tab: close`;
  text(
    ctx,
    font,
    hint,
    panel.x + panel.width - measureString(font, hint) * scale - pad,
    panel.y + panel.height - pad,
    scale,
    colors.text,
  );
}

/** Where the full-map image sits on screen. */
export function fullMapRect(panel: Rect, image: { width: number; height: number }, scale: number): Rect {
  const pad = 12 * scale;
  const top = 14 * scale;
  const k = Math.min((panel.width - 2 * pad) / image.width, (panel.height - 2 * pad - 2 * top) / image.height);
  const w = image.width * k;
  const h = image.height * k;
  return {
    x: panel.x + (panel.width - w) / 2,
    y: panel.y + pad + top + (panel.height - 2 * pad - 2 * top - h) / 2,
    width: w,
    height: h,
  };
}

/** The town under a pointer on the full map (within a few pixels), if any. */
export function townAt(full: FullMap, rect: Rect, x: number, y: number, reach: number): Town | undefined {
  const k = rect.width / full.image.width;
  let best: Town | undefined;
  let bestD = reach;
  for (const t of full.towns) {
    const d = Math.hypot(rect.x + t.x * k - x, rect.y + t.y * k - y);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

/** The full map of the kingdom: cities white, towns brown, the name under the pointer, the party flashing. */
export function drawFullMap(
  ctx: CanvasRenderingContext2D,
  font: Font,
  panel: Rect,
  scale: number,
  colors: MapColors,
  full: FullMap,
  view: LocalMapView,
  now: number,
): void {
  ctx.fillStyle = colors.backdrop;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = colors.panel;
  ctx.fillRect(panel.x, panel.y, panel.width, panel.height);
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 2 * scale;
  ctx.strokeRect(panel.x, panel.y, panel.width, panel.height);
  const pad = 12 * scale;
  const r = fullMapRect(panel, full.image, scale);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(full.image, r.x, r.y, r.width, r.height);
  const k = r.width / full.image.width;
  for (const t of full.towns) {
    ctx.fillStyle = CITIES.has(t.name) ? '#ffffff' : '#8a5a2b';
    const d = (CITIES.has(t.name) ? 3 : 2.4) * scale;
    ctx.beginPath();
    ctx.arc(r.x + t.x * k, r.y + t.y * k, d, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = Math.max(1, scale / 2);
    ctx.stroke();
  }
  if (full.party) {
    // Flashes between red and yellow, so it is always there to find.
    ctx.fillStyle = Math.floor(now / 400) % 2 === 0 ? '#ff3a1e' : '#ffe14a';
    ctx.fillRect(r.x + full.party.x * k - 3 * scale, r.y + full.party.y * k - 3 * scale, 6 * scale, 6 * scale);
  }
  const over = view.hover && townAt(full, r, view.hover.x, view.hover.y, 8 * scale);
  text(ctx, font, over ? over.name : 'The Kingdom of the Isles', panel.x + pad, panel.y + pad, scale, colors.text);
  const hint = 'F: local map   Tab: close';
  text(
    ctx,
    font,
    hint,
    panel.x + panel.width - measureString(font, hint) * scale - pad,
    panel.y + panel.height - pad,
    scale,
    colors.text,
  );
}
