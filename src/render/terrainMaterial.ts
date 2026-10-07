import * as THREE from 'three/webgpu';
import { Fn, float, mix, mx_noise_float, normalWorld, positionWorld, smoothstep, texture, uv, vec2, vec3 } from 'three/tsl';

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
