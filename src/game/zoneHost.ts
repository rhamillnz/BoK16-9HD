import * as THREE from 'three/webgpu';
import type { ResourceArchive } from '../formats/archive';
import { createGrass, type Grass } from '../render/grass';
import { createGroundSampler } from '../render/grassGround';
import { prepareZoneOverrides } from '../render/zoneOverrides';
import { buildZoneScene, collectTerrainTriangles, type ZoneScene } from '../render/zoneScene';
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

export async function loadZoneScene(archive: ResourceArchive, zone: number, parent: THREE.Scene): Promise<LoadedZone> {
  const data = loadZone(archive, zone);
  const scene = buildZoneScene(data, await prepareZoneOverrides(data));
  const heightField = buildHeightField(collectTerrainTriangles(data));
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
