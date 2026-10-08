import * as THREE from 'three/webgpu';
import {
  Fn,
  float,
  mix,
  mx_noise_float,
  normalWorld,
  positionWorld,
  smoothstep,
  step,
  texture,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
import { bumpedNormal } from './bump';

/** Noise scales in world units (1 unit = 100 game units): macro hides tiling, patches add colour drift. */
export const TERRAIN_MACRO_SCALE = 0.035;
export const TERRAIN_PATCH_SCALE = 0.11;
/** Slope-based darkening: faces steeper than SLOPE_START (1 − normal.y) fade towards SLOPE_DARKEN. */
export const SLOPE_START = 0.12;
export const SLOPE_END = 0.6;
export const SLOPE_DARKEN = 0.4;

/**
 * Stylised terrain: the original per-terrain palette texture, broken up by cheap procedural layers so
 * the recognisable colours survive but the repeat pattern does not. All TSL, no custom shaders.
 */
export function createTerrainMaterial(map: THREE.Texture, strip: number): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0, side: THREE.DoubleSide });
  const seed = vec2(strip * 17.3, strip * 5.1);

  material.colorNode = Fn(() => {
    const p = positionWorld.xz.add(seed);
    const base = texture(map, uv()).rgb;
    // A second, rotated and rescaled sample, mixed in by macro noise, de-correlates the repeat.
    const uv2 = vec2(uv().x.mul(0.37).add(uv().y.mul(0.19)), uv().y.mul(0.37).sub(uv().x.mul(0.19)));
    const alt = texture(map, uv2).rgb;
    const macro = mx_noise_float(p.mul(TERRAIN_MACRO_SCALE)).mul(0.5).add(0.5);
    const mixed = mix(base, alt, smoothstep(0.35, 0.65, macro).mul(0.6));

    // Low-frequency patches: brightness drift plus a warm/cool tint.
    const patch = mx_noise_float(p.mul(TERRAIN_PATCH_SCALE).add(31.7));
    const tint = vec3(1.0, 1.0, 1.0).add(vec3(0.07, 0.03, -0.06).mul(patch));
    const shaded = mixed.mul(tint).mul(float(1).add(patch.mul(0.14)));

    // Steep faces read darker (cliff/bank shading); flat ground keeps the palette colour.
    const slope = float(1).sub(normalWorld.y.abs());
    const rock = smoothstep(SLOPE_START, SLOPE_END, slope).mul(SLOPE_DARKEN);
    return shaded.mul(float(1).sub(rock));
  })();

  return material;
}

/** Grass colours (linear) the ground drifts towards: sun-dried straw and dark, lush clover. */
const DRY_GRASS = vec3(0.24, 0.2, 0.065);
const LUSH_GRASS = vec3(0.03, 0.1, 0.02);
const FLOWER_WHITE = vec3(0.7, 0.68, 0.6);
const FLOWER_YELLOW = vec3(0.65, 0.5, 0.08);

/**
 * Open grassland. The original ground strip is a tiny pixel texture that tiles into a visible
 * checkerboard, so only its average colour is kept (a coarse mip level). Everything else is
 * procedural and smooth: patches of dry and lush grass, a fine blade-like grain, scattered
 * flowers and a bumpy surface, all in world space so nothing swims or repeats.
 */
export function createGrassGroundMaterial(map: THREE.Texture): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0, side: THREE.DoubleSide });
  const p = positionWorld.xz;
  // Blade grain: noise stretched a little along a slowly turning direction, fine and coarse.
  const turn = mx_noise_float(p.mul(0.07)).mul(1.5);
  const along = vec2(p.x.mul(turn.cos()).add(p.y.mul(turn.sin())), p.y.mul(turn.cos()).sub(p.x.mul(turn.sin())));
  // Kept to a few cycles per unit: finer noise only shimmers into speckle at a distance.
  const blades = mx_noise_float(vec2(along.x.mul(4.0), along.y.mul(1.2)))
    .mul(0.6)
    .add(mx_noise_float(p.mul(2.2).add(9.9)).mul(0.4));

  material.colorNode = Fn(() => {
    const base = texture(map, uv()).level(float(8)).rgb;
    const macro = mx_noise_float(p.mul(TERRAIN_MACRO_SCALE)).mul(0.5).add(0.5);
    const patch = mx_noise_float(p.mul(TERRAIN_PATCH_SCALE).add(31.7)).mul(0.5).add(0.5);
    const small = mx_noise_float(p.mul(0.55).add(4.4)).mul(0.5).add(0.5);
    // Dry, sunny patches and dark lush hollows, at two scales so the meadow never looks uniform.
    const dry = smoothstep(0.55, 0.85, macro.mul(0.6).add(small.mul(0.4)));
    const lush = smoothstep(0.6, 0.9, float(1).sub(patch).mul(0.7).add(small.mul(0.3)));
    // The VGA ground green is dark in linear light: lift it towards the grass blades' brightness.
    let grass = base.mul(1.45);
    grass = mix(grass, DRY_GRASS, dry.mul(0.7));
    grass = mix(grass, LUSH_GRASS, lush.mul(0.45));
    grass = grass.mul(float(0.9).add(blades.mul(0.2)));
    // Flowers: rare specks in clusters, white daisies and yellow buttercups.
    const cluster = smoothstep(0.55, 0.8, mx_noise_float(p.mul(0.25).add(17.0)).mul(0.5).add(0.5));
    const speck = smoothstep(0.8, 0.88, mx_noise_float(p.mul(6.0).add(2.7)).mul(0.5).add(0.5)).mul(cluster);
    const flower = mix(FLOWER_WHITE, FLOWER_YELLOW, step(0.5, mx_noise_float(p.mul(3.1)).mul(0.5).add(0.5)));
    grass = mix(grass, flower, speck.mul(0.8));
    // Steep banks read darker, as on other terrain.
    const slope = float(1).sub(normalWorld.y.abs());
    return grass.mul(float(1).sub(smoothstep(SLOPE_START, SLOPE_END, slope).mul(SLOPE_DARKEN)));
  })();
  // Gentle lumps only: bumping the fine grain flickers pixel to pixel (screen-space derivatives).
  material.normalNode = bumpedNormal(mx_noise_float(p.mul(0.6)).mul(0.12));
  return material;
}
