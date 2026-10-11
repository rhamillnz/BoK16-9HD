import type { CollisionPolygon } from './collision';

/**
 * Props the original draws as flat sprites with no collision outline, so the party walked through them. With
 * their HD models standing in the world (a brown dirt mound, standing stones) that reads as a bug: they get a
 * solid footprint instead.
 */
export const SOLID_PROPS = /^(dirtpile|tstone\d)$/;

/** Share of the model's footprint that blocks, so the party can still brush past its edges. */
export const FOOTPRINT_SHRINK = 0.8;

/**
 * An octagon filling the axis-aligned footprint `minX..maxX`, `minY..maxY` (BaK units), shrunk around its
 * centre by `shrink`.
 */
export function footprintPolygon(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  shrink = FOOTPRINT_SHRINK,
): CollisionPolygon {
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rx = ((maxX - minX) / 2) * shrink;
  const ry = ((maxY - minY) / 2) * shrink;
  const points: number[] = [];
  for (let k = 0; k < 8; k++) {
    const a = ((k + 0.5) / 8) * Math.PI * 2;
    points.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
  }
  return { points, minX: cx - rx, minY: cy - ry, maxX: cx + rx, maxY: cy + ry };
}
