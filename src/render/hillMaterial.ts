import * as THREE from 'three/webgpu';
import {
  Fn,
  abs,
  float,
  mix,
  mx_noise_float,
  normalWorld,
  positionWorld,
  pow,
  smoothstep,
  vec3,
  vertexColor,
} from 'three/tsl';
import { bumpedNormal } from './bump';
import { SLOPE_END, SLOPE_START, TERRAIN_MACRO_SCALE, TERRAIN_PATCH_SCALE } from './terrainMaterial';

/** Rock colour (linear) the steep and high parts of hills fade towards. */
const ROCK_LOW = vec3(0.12, 0.105, 0.085);
const ROCK_HIGH = vec3(0.22, 0.2, 0.18);
/** World heights (render units) where hills start and finish turning to bare rock. */
/** Exponent applied to the palette colour (< 1 brightens dark colours most). */
export const HILL_GAMMA = 0.55;
/** Fraction of the albedo added as unlit bounce light. */
export const HILL_BOUNCE = 0.35;
export const HILL_ROCK_ALTITUDE = [10, 28] as const;
/** Height (render units) of the fine shader relief; the mesh carries the large shapes (hillDetail.ts). */
export const HILL_BUMP = 0.18;

/** Small-scale relief: lumps, gullies and rocky grain, in world space so it never swims. */
const relief = Fn(() => {
  const p = positionWorld;
  const lumps = mx_noise_float(p.mul(0.32)).mul(0.6);
  const grain = mx_noise_float(p.mul(1.3).add(11.1)).mul(0.28);
  const fine = mx_noise_float(p.mul(4.1).add(3.7)).mul(0.12);
  const gully = float(1)
    .sub(abs(mx_noise_float(vec3(p.x.mul(0.18), p.y.mul(0.5), p.z.mul(0.18)).add(5.5))))
    .pow(3)
    .mul(-0.5);
  return lumps.add(grain).add(fine).add(gully).mul(HILL_BUMP);
});

/**
 * Stylised hills: the original palette colour per face (kept for recognisability), lifted by
 * low-frequency noise, with steep or high ground blending to mottled rock. Used with smooth
 * normals, so the facets of the low-poly model read as rolling slopes rather than crystals.
 */
export function createHillMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0, side: THREE.DoubleSide });
  const albedo = Fn(() => {
    const p = positionWorld.xz;
    const base = vertexColor().rgb;
    const macro = mx_noise_float(p.mul(TERRAIN_MACRO_SCALE)).mul(0.5).add(0.5);
    const patch = mx_noise_float(p.mul(TERRAIN_PATCH_SCALE).add(7.3));
    const tint = vec3(1.0, 1.0, 1.0).add(vec3(0.1, 0.05, -0.08).mul(patch));
    // The VGA palette greens are only ~0.02 linear, which goes black in shade: a gamma lift keeps the hue
    // and the lighter/darker faces but brings them near the ground texture's brightness.
    const lit = pow(base, vec3(HILL_GAMMA))
      .mul(tint)
      .mul(float(1.1).add(patch.mul(0.2)));

    const slope = float(1).sub(normalWorld.y.abs());
    const steep = smoothstep(SLOPE_START + 0.1, SLOPE_END, slope);
    const high = smoothstep(HILL_ROCK_ALTITUDE[0], HILL_ROCK_ALTITUDE[1], positionWorld.y);
    const rockAmt = steep
      .add(high.mul(0.7))
      .min(1)
      .mul(smoothstep(0.2, 0.7, macro.add(steep.mul(0.4))));
    const strata = mx_noise_float(vec3(positionWorld.x.mul(0.5), positionWorld.y.mul(1.4), positionWorld.z.mul(0.5)))
      .mul(0.5)
      .add(0.5);
    const crack = mx_noise_float(positionWorld.mul(0.35)).mul(0.5).add(0.5);
    const rock = mix(ROCK_LOW, ROCK_HIGH, mx_noise_float(p.mul(0.4)).mul(0.5).add(0.5))
      .mul(strata.mul(0.5).add(0.7))
      .mul(crack.mul(0.4).add(0.8));
    return mix(lit, rock, rockAmt);
  })();
  material.colorNode = albedo;
  material.normalNode = bumpedNormal(relief());
  // The scene's ambient light is weak, so slopes facing away from the sun would go black: fake some bounce light.
  material.emissiveNode = albedo.mul(HILL_BOUNCE);
  return material;
}
