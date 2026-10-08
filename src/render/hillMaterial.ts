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
import { SLOPE_START, TERRAIN_MACRO_SCALE, TERRAIN_PATCH_SCALE } from './terrainMaterial';

/** Rock colours (linear): dark weathered stone, lighter grey-brown faces, and pale lichen. */
const ROCK_LOW = vec3(0.1, 0.09, 0.075);
const ROCK_HIGH = vec3(0.26, 0.235, 0.205);
const LICHEN = vec3(0.3, 0.3, 0.2);
/** Exponent applied to the palette colour (< 1 brightens dark colours most). */
export const HILL_GAMMA = 0.55;
/** Fraction of the albedo added as unlit bounce light. */
export const HILL_BOUNCE = 0.35;
export const HILL_ROCK_ALTITUDE = [10, 28] as const;
/** Height (render units) of the fine shader relief; the mesh carries the large shapes (hillDetail.ts). */
export const HILL_BUMP = 0.28;

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
 * Rocky hills: bare, banded stone everywhere, with grass (the original palette colour, so the
 * landscape keeps its look from a distance) surviving only on gentle, low ground and in hollows.
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

    // Grass only where it could hold on: gentle, low ground, in patches. Everything else is rock.
    const slope = float(1).sub(normalWorld.y.abs());
    const gentle = float(1).sub(smoothstep(SLOPE_START * 0.5, SLOPE_START + 0.05, slope));
    const low = float(1).sub(smoothstep(HILL_ROCK_ALTITUDE[0] * 0.3, HILL_ROCK_ALTITUDE[0], positionWorld.y));
    const grassPatch = smoothstep(0.35, 0.65, macro.add(patch.mul(0.25)));
    const rockAmt = float(1).sub(gentle.mul(grassPatch).mul(low.mul(0.6).add(0.4)).mul(0.9));
    const strata = mx_noise_float(vec3(positionWorld.x.mul(0.5), positionWorld.y.mul(1.4), positionWorld.z.mul(0.5)))
      .mul(0.5)
      .add(0.5);
    const crack = mx_noise_float(positionWorld.mul(0.35)).mul(0.5).add(0.5);
    const bands = mx_noise_float(vec3(positionWorld.x.mul(0.05), positionWorld.y.mul(2.2), positionWorld.z.mul(0.05)))
      .mul(0.5)
      .add(0.5);
    const stone = mix(ROCK_LOW, ROCK_HIGH, mx_noise_float(p.mul(0.4)).mul(0.5).add(0.5).mul(bands.mul(0.6).add(0.4)))
      .mul(strata.mul(0.5).add(0.7))
      .mul(crack.mul(0.4).add(0.8));
    // Lichen and a little of the hill's own colour on the upward faces of the rock.
    const lichen = smoothstep(0.55, 0.8, mx_noise_float(positionWorld.mul(0.9).add(2.2)).mul(0.5).add(0.5)).mul(
      normalWorld.y.max(0),
    );
    const rock = mix(
      mix(stone, LICHEN.mul(stone.length().add(0.4)), lichen.mul(0.5)),
      lit,
      normalWorld.y.max(0).mul(0.15),
    );
    return mix(lit, rock, rockAmt);
  })();
  material.colorNode = albedo;
  material.normalNode = bumpedNormal(relief());
  // The scene's ambient light is weak, so slopes facing away from the sun would go black: fake some bounce light.
  material.emissiveNode = albedo.mul(HILL_BOUNCE);
  return material;
}
