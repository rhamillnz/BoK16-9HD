import * as THREE from 'three/webgpu';
import { zonePrefix } from '../formats/tbl';
import type { ModelTable } from '../formats/tbl';
import { angleToRadians, type WorldItem } from '../formats/world';
import type { Group } from 'three/webgpu';

/** Render units per BaK unit: 1 render unit = 100 BaK units. */
const WORLD_SCALE = 100;

/** Resolved replacements for one zone, ready for `buildZoneScene`. */
export interface ZoneOverridePlan {
  /** Loaded override scenes (manifest transform applied) by lowercase model name. */
  models: Map<string, Group>;
  /** Upscaled replacements for slot images, by slot image index. */
  slotTextures: Map<number, THREE.Texture>;
}

/** URL of the upscaled replacement for slot image `index` of `zone` (served from art/reference in dev). */
export function slotTextureUrl(zone: number, index: number): string {
  return `/art/${zonePrefix(zone)}/slots-4x/${index}.png`;
}

/** Lowercase names of models that have an override and are used by at least one item. */
export function overriddenModelNames(
  items: readonly WorldItem[],
  table: ModelTable,
  has: (name: string) => boolean,
): Set<string> {
  const names = new Set<string>();
  for (const item of items) {
    const model = table.models[item.type];
    if (model && has(model.name)) names.add(model.name.toLowerCase());
  }
  return names;
}

/**
 * Placement of an override model: it is authored in render units with its origin at the
 * original model's placement point, so it only needs the item's position and yaw.
 */
export function placementMatrix(item: WorldItem, out = new THREE.Matrix4()): THREE.Matrix4 {
  const pos = new THREE.Vector3(item.x / WORLD_SCALE, item.z / WORLD_SCALE, -item.y / WORLD_SCALE);
  const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angleToRadians(item.zRot));
  return out.compose(pos, quat, new THREE.Vector3(1, 1, 1));
}

/** One InstancedMesh per mesh node of the override scene, instanced over `placements`. */
export function buildOverrideMeshes(name: string, scene: Group, placements: readonly THREE.Matrix4[]): THREE.InstancedMesh[] {
  scene.updateMatrixWorld(true);
  const out: THREE.InstancedMesh[] = [];
  const m = new THREE.Matrix4();
  scene.traverse((obj) => {
    const src = obj as THREE.Mesh;
    if (!src.isMesh) return;
    const mesh = new THREE.InstancedMesh(src.geometry, src.material, placements.length);
    mesh.name = `override:${name}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    placements.forEach((p, i) => mesh.setMatrixAt(i, m.multiplyMatrices(p, src.matrixWorld)));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    out.push(mesh);
  });
  return out;
}
