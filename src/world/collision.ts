import type { ModelClip } from '../formats/tbl';
import { angleToRadians, type WorldItem } from '../formats/world';

/**
 * 2D collision built from model clips (docs/formats/zones-and-models.md §1.5).
 * Everything here is in BaK world units on the ground plane: x east, y north.
 */

export interface Vec2 {
  x: number;
  y: number;
}

/** Closed polygon in world space. `points` is flattened [x, y, ...]. */
export interface CollisionPolygon {
  points: number[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ClipPlacementOptions {
  /** Also emit polygons for walkable clips, which normally do not block movement. */
  includeWalkable?: boolean;
}

function makePolygon(points: number[]): CollisionPolygon {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    minX = Math.min(minX, points[i]!);
    maxX = Math.max(maxX, points[i]!);
    minY = Math.min(minY, points[i + 1]!);
    maxY = Math.max(maxY, points[i + 1]!);
  }
  return { points, minX, minY, maxX, maxY };
}

/**
 * Transforms one clip into world-space polygons for a placed item. The yaw (`zRot`) turns
 * counter-clockwise seen from above, matching the ToGlAngle conversion in §4.2–4.3.
 * A clip with no elements falls back to its bounding rectangle (±radiusX, ±radiusY).
 */
export function placeClip(clip: ModelClip, item: Pick<WorldItem, 'x' | 'y' | 'zRot'>, scale = 1): CollisionPolygon[] {
  const a = angleToRadians(item.zRot);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  // Clip points are stored unscaled, like model vertices; `scale` is the model's 2^scale factor.
  const xf = (pts: number[]) => {
    const out: number[] = [];
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i]! * scale;
      const y = pts[i + 1]! * scale;
      out.push(item.x + x * cos - y * sin, item.y + x * sin + y * cos);
    }
    return out;
  };
  const polys = clip.elements.filter((e) => e.points.length >= 6).map((e) => makePolygon(xf(e.points)));
  if (polys.length > 0) return polys;
  if (clip.elements.length === 0 && (clip.radiusX > 0 || clip.radiusY > 0)) {
    const { radiusX: rx, radiusY: ry } = clip;
    return [makePolygon(xf([-rx, -ry, rx, -ry, rx, ry, -rx, ry]))];
  }
  return [];
}

/** Places every item's clip. Items with type 0 (tile centre) or no clip are skipped. */
export function buildCollisionPolygons(
  items: readonly WorldItem[],
  clips: readonly (ModelClip | undefined)[],
  options: ClipPlacementOptions = {},
  /** Per-model 2^scale factors, indexed like `clips`; defaults to 1. */
  scales: readonly number[] = [],
): CollisionPolygon[] {
  const out: CollisionPolygon[] = [];
  for (const item of items) {
    if (item.type === 0) continue;
    const clip = clips[item.type];
    if (!clip || (clip.walkable && !options.includeWalkable)) continue;
    out.push(...placeClip(clip, item, scales[item.type] ?? 1));
  }
  return out;
}

export function pointInPolygon(poly: CollisionPolygon, x: number, y: number): boolean {
  const p = poly.points;
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i]!;
    const yi = p[i + 1]!;
    const xj = p[j]!;
    const yj = p[j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Closest point on the polygon outline to (x, y). */
function closestOnOutline(poly: CollisionPolygon, x: number, y: number): { x: number; y: number; d2: number } {
  const p = poly.points;
  let best = { x: p[0]!, y: p[1]!, d2: Infinity };
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const ax = p[j]!;
    const ay = p[j + 1]!;
    const ex = p[i]! - ax;
    const ey = p[i + 1]! - ay;
    const len2 = ex * ex + ey * ey;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / len2));
    const cx = ax + ex * t;
    const cy = ay + ey * t;
    const d2 = (x - cx) ** 2 + (y - cy) ** 2;
    if (d2 < best.d2) best = { x: cx, y: cy, d2 };
  }
  return best;
}

const EPSILON = 1e-3;

/** Pushes a circle out of one polygon. Returns the new centre, or undefined if not overlapping. */
export function resolveCircleVsPolygon(poly: CollisionPolygon, x: number, y: number, radius: number): Vec2 | undefined {
  if (x + radius < poly.minX || x - radius > poly.maxX || y + radius < poly.minY || y - radius > poly.maxY) {
    return undefined;
  }
  const c = closestOnOutline(poly, x, y);
  const dist = Math.sqrt(c.d2);
  const inside = pointInPolygon(poly, x, y);
  if (!inside && dist >= radius) return undefined;
  let nx: number;
  let ny: number;
  let push: number;
  if (inside) {
    // Centre is inside: leave through the nearest edge point.
    nx = dist > 0 ? c.x - x : 1;
    ny = dist > 0 ? c.y - y : 0;
    push = dist + radius;
  } else {
    nx = x - c.x;
    ny = y - c.y;
    push = radius - dist;
  }
  const n = Math.hypot(nx, ny) || 1;
  const s = (push + EPSILON) / n;
  return { x: x + nx * s, y: y + ny * s };
}

/**
 * Moves a circle from `from` by `delta`, sliding along any polygons in the way. The move is
 * split into steps of at most half a radius so fast movement cannot tunnel through thin walls.
 */
export function slideMove(from: Vec2, delta: Vec2, radius: number, polygons: readonly CollisionPolygon[]): Vec2 {
  const dist = Math.hypot(delta.x, delta.y);
  const steps = Math.max(1, Math.ceil(dist / Math.max(radius * 0.5, EPSILON)));

  const searchRadius = radius + dist;
  const minX = from.x - searchRadius;
  const maxX = from.x + searchRadius;
  const minY = from.y - searchRadius;
  const maxY = from.y + searchRadius;
  const nearPolys = polygons.filter((p) => p.maxX >= minX && p.minX <= maxX && p.maxY >= minY && p.minY <= maxY);

  let x = from.x;
  let y = from.y;
  for (let s = 0; s < steps; s++) {
    x += delta.x / steps;
    y += delta.y / steps;
    // Pushing out of one polygon can push into a neighbour, so iterate a few times.
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      for (const poly of nearPolys) {
        const r = resolveCircleVsPolygon(poly, x, y, radius);
        if (r) {
          x = r.x;
          y = r.y;
          moved = true;
        }
      }
      if (!moved) break;
    }
  }
  return { x, y };
}
