import * as THREE from 'three/webgpu';
import {
  Fn,
  abs,
  float,
  mix,
  mx_noise_float,
  normalWorld,
  positionLocal,
  positionWorld,
  smoothstep,
  vec3,
} from 'three/tsl';
import { SCATTER_BUSHES, SCATTER_ROCKS } from './scatter';
import { bumpedNormal } from './bump';

/** Stone colours (linear), close to the hill rock in hillMaterial.ts: weathered grey-brown with pale lichen. */
const STONE_DARK = vec3(0.13, 0.115, 0.095);
const STONE_LIGHT = vec3(0.3, 0.27, 0.235);
const LICHEN = vec3(0.3, 0.32, 0.2);
/** Fraction of the albedo added as unlit bounce light, so shaded faces never go black. */
const BOUNCE = 0.4;

const isScatterRock = (name: string): boolean => (SCATTER_ROCKS as readonly string[]).includes(name);

/** One shared material for every scattered boulder: banded grey-brown stone, lichen on top faces and rims. */
let shared: THREE.MeshStandardNodeMaterial | undefined;
export function scatterRockMaterial(): THREE.MeshStandardNodeMaterial {
  if (shared) return shared;
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
  const albedo = Fn(() => {
    const p = positionWorld;
    const band = mx_noise_float(vec3(p.x.mul(0.9), p.y.mul(2.6), p.z.mul(0.9)))
      .mul(0.5)
      .add(0.5);
    const blotch = mx_noise_float(p.mul(2.4).add(4.2)).mul(0.5).add(0.5);
    const stone = mix(STONE_DARK, STONE_LIGHT, band.mul(0.6).add(blotch.mul(0.4)));
    // Lichen: patchy, favouring upward-facing surfaces.
    const up = smoothstep(0.35, 0.9, normalWorld.y);
    const patches = smoothstep(0.45, 0.7, mx_noise_float(p.mul(3.1).add(9.7)).mul(0.5).add(0.5));
    return mix(stone, LICHEN, up.mul(patches).mul(0.7));
  })();
  material.colorNode = albedo;
  material.emissiveNode = albedo.mul(BOUNCE);
  const lumps = mx_noise_float(positionLocal.mul(4.0))
    .mul(0.5)
    .add(abs(mx_noise_float(positionLocal.mul(9.0))).mul(0.25));
  material.normalNode = bumpedNormal(lumps.mul(float(0.06)));
  shared = material;
  return material;
}

/** Share of the foliage colour added as unlit bounce light (the kit's bush materials go near-black in shade). */
const FOLIAGE_BOUNCE = 0.45;
const foliageCache = new Map<THREE.Material, THREE.Material>();

/** A copy of a foliage material that also glows with its own colour, so shaded plants stay green. */
function foliageMaterial(src: THREE.Material): THREE.Material {
  let out = foliageCache.get(src);
  if (out) return out;
  const m = (src as THREE.MeshStandardMaterial).clone();
  m.emissive = new THREE.Color(FOLIAGE_BOUNCE, FOLIAGE_BOUNCE, FOLIAGE_BOUNCE);
  m.emissiveMap = m.map;
  if (!m.map) m.emissive.copy(m.color).multiplyScalar(FOLIAGE_BOUNCE);
  foliageCache.set(src, (out = m));
  return out;
}

/** Scatter models drawn with their own look: boulders get the stone material, bushes a bounce-lit copy of theirs. */
export function applyScatterRockMaterial(name: string, meshes: readonly THREE.Mesh[]): void {
  if (isScatterRock(name)) {
    for (const mesh of meshes) mesh.material = scatterRockMaterial();
  } else if ((SCATTER_BUSHES as readonly string[]).includes(name)) {
    for (const mesh of meshes) {
      if (!Array.isArray(mesh.material)) mesh.material = foliageMaterial(mesh.material);
    }
  }
}
