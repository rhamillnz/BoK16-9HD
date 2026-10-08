import * as THREE from 'three/webgpu';
import type { ResourceArchive } from '../formats/archive';
import { createGrass, type Grass } from '../render/grass';
import { createGroundSampler, roadEdgePoints } from '../render/grassGround';
import { buildOverrideMeshes } from '../render/overrideResolve';
import { DEFAULT_ROAD_STONES, ROAD_STONE_CHUNK, ROAD_STONE_FAR, roadStonePlacements } from '../render/roadStones';
import { prepareZoneOverrides, type ZoneOverridePlan } from '../render/zoneOverrides';
import { WORLD_SCALE, buildZoneScene, collectTerrainTriangles, type ZoneScene } from '../render/zoneScene';
import { buildHeightField, type HeightField } from '../world/heightField';
import { isUndergroundZone } from '../world/underground';
import { loadZone, type ZoneData } from '../world/zone';

/** One loaded outdoor zone: its data, the scene group, the ground height lookup and its grass. */
export interface LoadedZone {
  zone: number;
  data: ZoneData;
  scene: ZoneScene;
  heightField: HeightField;
  grass: Grass;
  info: string;
}

function noGrass(): Grass {
  return { mesh: new THREE.Mesh(), quality: 'off', instances: 0, setQuality: () => {}, dispose: () => {} };
}

/** Stones lying along road and path edges, instanced from the zone's loaded stone models. */
function addRoadStones(scene: ZoneScene, data: ZoneData, overrides: ZoneOverridePlan, heightField: HeightField): void {
  const available = new Set(overrides.models.keys());
  const height = (x: number, z: number) => heightField.getHeight(x * WORLD_SCALE, -z * WORLD_SCALE) / WORLD_SCALE;
  // One group per model and ground chunk, so each chunk is frustum- and distance-culled on its own.
  const groups = new Map<string, { name: string; cx: number; cz: number; matrices: THREE.Matrix4[] }>();
  for (const p of roadStonePlacements(roadEdgePoints(data), height, available, {
    ...DEFAULT_ROAD_STONES,
    seed: data.zone,
  })) {
    const cx = Math.floor(p.matrix.elements[12]! / ROAD_STONE_CHUNK);
    const cz = Math.floor(p.matrix.elements[14]! / ROAD_STONE_CHUNK);
    const key = `${p.name}|${cx}|${cz}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { name: p.name, cx, cz, matrices: [] }));
    g.matrices.push(p.matrix);
  }
  for (const g of groups.values()) {
    for (const mesh of buildOverrideMeshes(g.name, overrides.models.get(g.name)!, g.matrices)) {
      mesh.castShadow = false;
      mesh.userData.chunk = {
        x: (g.cx + 0.5) * ROAD_STONE_CHUNK,
        z: (g.cz + 0.5) * ROAD_STONE_CHUNK,
        r: ROAD_STONE_CHUNK * 0.75,
        far: ROAD_STONE_FAR,
      };
      scene.group.add(mesh);
      scene.stats.drawCalls++;
    }
  }
}

export async function loadZoneScene(archive: ResourceArchive, zone: number, parent: THREE.Scene): Promise<LoadedZone> {
  const data = loadZone(archive, zone);
  const overrides = await prepareZoneOverrides(data);
  const scene = buildZoneScene(data, overrides);
  const heightField = buildHeightField(collectTerrainTriangles(data));
  if (!isUndergroundZone(zone)) addRoadStones(scene, data, overrides, heightField);
  // No grass underground: an inert stand-in keeps the quality switch and disposal calls harmless.
  const grass = isUndergroundZone(zone) ? noGrass() : createGrass(parent, createGroundSampler(data, heightField));
  const info = `zone ${zone}: ${scene.stats.meshItems} meshes, ${scene.stats.sprites} sprites, ${Math.round(scene.stats.triangles / 1000)}k tris, ${scene.collision.length} colliders`;
  return { zone, data, scene, heightField, grass, info };
}

/** Free the GPU resources of a zone group that is no longer shown. */
export function disposeGroup(group: THREE.Object3D): void {
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const m of materials) {
      (m as THREE.MeshBasicMaterial).map?.dispose();
      m.dispose();
    }
  });
}

/**
 * Owns the zone currently in the scene and swaps it for another on a zone transition.
 * Callers read `current` each frame, so ground height and collision follow the swap.
 */
export class ZoneHost {
  private constructor(
    private readonly scene: THREE.Scene,
    private readonly archive: ResourceArchive,
    public current: LoadedZone,
  ) {}

  static async create(scene: THREE.Scene, archive: ResourceArchive, zone: number): Promise<ZoneHost> {
    const current = await loadZoneScene(archive, zone, scene);
    scene.add(current.scene.group);
    return new ZoneHost(scene, archive, current);
  }

  /** Ground height at a BaK position in the current zone. */
  getHeight = (x: number, y: number): number => this.current.heightField.getHeight(x, y);

  /** Replace the current zone's scene (and its grass) with `zone` and return it. */
  async switchTo(zone: number): Promise<LoadedZone> {
    const old = this.current;
    const next = await loadZoneScene(this.archive, zone, this.scene);
    this.scene.remove(old.scene.group);
    disposeGroup(old.scene.group);
    old.grass.dispose();
    this.scene.add(next.scene.group);
    this.current = next;
    return next;
  }
}
