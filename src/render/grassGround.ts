import { Terrain } from '../formats/scx';
import { EF_2D_OBJECT } from '../formats/tbl';
import { angleToRadians } from '../formats/world';
import type { HeightField } from '../world/heightField';
import type { ZoneData } from '../world/zone';
import { buildGroundMask, type GroundSampler } from './grassMath';
import { classifyFace, WORLD_SCALE } from './zoneScene';

/** Placed triangles (BaK coordinates, 9 numbers each) of ground-terrain faces, of road and path faces, and of every other terrain-model face. */
type GroundTriangles = { ground: number[]; cover: number[]; road: number[] };
const triangleCache = new WeakMap<ZoneData, GroundTriangles>();

function collectGroundTriangles(zone: ZoneData): GroundTriangles {
  const cached = triangleCache.get(zone);
  if (cached) return cached;
  const ground: number[] = [];
  const cover: number[] = [];
  const road: number[] = [];
  for (const item of zone.items) {
    const model = zone.table.models[item.type];
    if (!model || model.sprite || model.flags & EF_2D_OBJECT) continue;
    const yaw = angleToRadians(item.zRot);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const v = model.vertices;
    const world = (i: number) => {
      const vx = v[i * 3]!;
      const vy = v[i * 3 + 1]!;
      return [item.x + vx * cos - vy * sin, item.y + vx * sin + vy * cos, item.z + v[i * 3 + 2]!] as const;
    };
    for (const face of model.faces) {
      if (face.indices.length < 3) continue;
      const m = classifyFace(model, face);
      const out = m.kind === 'terrain' && m.strip === Terrain.Ground ? ground : cover;
      const isRoad = m.kind === 'terrain' && (m.strip === Terrain.Road || m.strip === Terrain.Path);
      const loop = face.indices.map(world);
      for (let k = 1; k + 1 < loop.length; k++) {
        out.push(...loop[0]!, ...loop[k]!, ...loop[k + 1]!);
        if (isRoad) road.push(...loop[0]!, ...loop[k]!, ...loop[k + 1]!);
      }
    }
  }
  const result = { ground, cover, road };
  triangleCache.set(zone, result);
  return result;
}

/** Distance (BaK units) at which a road counts as adjacent, probed in 8 directions. */
const VERGE_REACH = 160;
const VERGE_PROBES = Array.from({ length: 8 }, (_, i) => [Math.cos((i * Math.PI) / 4) * VERGE_REACH, Math.sin((i * Math.PI) / 4) * VERGE_REACH] as const);

/** Average colour of the zone's Ground terrain strip, 0..1 sRGB. */
function groundColor(zone: ZoneData): [number, number, number] {
  const strip = zone.terrain[Terrain.Ground];
  if (!strip || !strip.pixels.length) return [0.3, 0.45, 0.2];
  const sum = [0, 0, 0];
  let n = 0;
  for (const p of strip.pixels) {
    if (p === 0) continue;
    for (let c = 0; c < 3; c++) sum[c]! += zone.palette[p * 4 + c]!;
    n++;
  }
  return n ? [sum[0]! / n / 255, sum[1]! / n / 255, sum[2]! / n / 255] : [0.3, 0.45, 0.2];
}

/**
 * Ground sampler for `createGrass`: render-space (x, z) -> ground height, or null off Ground-terrain
 * areas (roads, paths, rivers, fields, anything built over it). Carries the ground palette colour.
 */
export function createGroundSampler(zone: ZoneData, heightField: HeightField): GroundSampler {
  const { ground, cover, road } = collectGroundTriangles(zone);
  const mask = buildGroundMask(ground, cover);
  const roadMask = buildGroundMask(road, []);
  // A road within VERGE_REACH world units (checked at 8 compass points) makes the grass verge.
  const verge = (x: number, z: number): boolean => {
    const bx = x * WORLD_SCALE;
    const by = -z * WORLD_SCALE;
    for (const [dx, dy] of VERGE_PROBES) if (roadMask.get(bx + dx, by + dy)) return true;
    return false;
  };
  const sample: GroundSampler = (x, z) => {
    const bx = x * WORLD_SCALE;
    const by = -z * WORLD_SCALE;
    return mask.get(bx, by) ? heightField.getHeight(bx, by) / WORLD_SCALE : null;
  };
  sample.color = groundColor(zone);
  if (road.length) sample.verge = verge;
  return sample;
}

/**
 * Render-space (x, z) points on the edge of roads and paths (road cells with grass beside them),
 * one per road-edge mask cell, for placing roadside stones.
 */
export function roadEdgePoints(zone: ZoneData): [number, number][] {
  const { ground, cover, road } = collectGroundTriangles(zone);
  if (!road.length) return [];
  const groundMask = buildGroundMask(ground, cover);
  const roadMask = buildGroundMask(road, []);
  const out: [number, number][] = [];
  roadMask.forEachSet((x, y) => {
    if (groundMask.get(x + 100, y) || groundMask.get(x - 100, y) || groundMask.get(x, y + 100) || groundMask.get(x, y - 100)) out.push([x / WORLD_SCALE, -y / WORLD_SCALE]);
  });
  return out;
}
