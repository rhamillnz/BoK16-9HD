import type { ZoneData } from './zone';
import { angleToRadians } from '../formats/world';
import { isUndergroundZone } from './underground';

/**
 * Overhead map of a mine, drawn from the `_ug` models in ZxxM.TBL (see docs/formats/zones-and-models.md).
 * Each placed item is looked up in the overhead table (same model indices as the normal table), its faces
 * are flattened onto the ground plane and kept as coloured polygons in BaK world units (x east, y north).
 */
export interface OverheadPolygon {
  /** Flattened [x, y, x, y, ...] in BaK world units. */
  points: number[];
  /** CSS colour from the zone palette. */
  fill: string;
  /** Height of the item, used to draw higher pieces last. */
  z: number;
}

/** Faces whose colour is a texture sub-index rather than a palette entry are drawn in this stone grey. */
const TEXTURED_FILL = '#6a6258';
/** Material flags whose colour byte indexes a texture (same set the 3D scene treats as textured). */
const TEXTURED_MATERIALS = new Set([0x90, 0x91, 0xd1, 0x11, 0xc1]);

export function overheadPolygons(
  data: Pick<ZoneData, 'zone' | 'items' | 'overheadTable' | 'palette'>,
): OverheadPolygon[] | undefined {
  if (!isUndergroundZone(data.zone) || !data.overheadTable) return undefined;
  const { models } = data.overheadTable;
  const { palette } = data;
  const out: OverheadPolygon[] = [];
  for (const item of data.items) {
    const model = models[item.type];
    if (!model || model.sprite || model.faces.length === 0) continue;
    const yaw = angleToRadians(item.zRot);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const v = model.vertices;
    for (const face of model.faces) {
      if (face.indices.length < 3) continue;
      const points: number[] = [];
      for (const i of face.indices) {
        const vx = v[i * 3];
        const vy = v[i * 3 + 1];
        if (vx === undefined || vy === undefined) {
          points.length = 0;
          break;
        }
        points.push(item.x + vx * cos - vy * sin, item.y + vx * sin + vy * cos);
      }
      if (points.length < 6) continue;
      const textured = TEXTURED_MATERIALS.has(face.material);
      const p = face.color * 4;
      const fill =
        textured || palette[p + 3] === 0 ? TEXTURED_FILL : `rgb(${palette[p]},${palette[p + 1]},${palette[p + 2]})`;
      out.push({ points, fill, z: item.z });
    }
  }
  out.sort((a, b) => a.z - b.z);
  return out;
}

/** Tiles (x, y) the polygons touch, for fitting the map view. */
export function overheadTiles(polys: readonly OverheadPolygon[], tileSize: number): [number, number][] {
  const seen = new Set<number>();
  const tiles: [number, number][] = [];
  for (const poly of polys) {
    for (let i = 0; i < poly.points.length; i += 2) {
      const tx = Math.floor(poly.points[i]! / tileSize);
      const ty = Math.floor(poly.points[i + 1]! / tileSize);
      const key = tx * 1000 + ty;
      if (tx < 0 || ty < 0 || seen.has(key)) continue;
      seen.add(key);
      tiles.push([tx, ty]);
    }
  }
  return tiles;
}
