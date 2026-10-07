import * as THREE from 'three/webgpu';
import {
  Fn,
  float,
  mix,
  mx_noise_float,
  mx_worley_noise_vec2,
  normalWorld,
  positionWorld,
  smoothstep,
  texture,
  uv,
  vec2,
  vec3,
} from 'three/tsl';

/**
 * Stylised medieval road: packed earth with worn patches of cobblestones. Everything is
 * procedural in world space (TSL), tinted by the original road texture so the colour stays
 * recognisably Krondor's. `cobbles` is the fraction of the surface paved (roads ~0.6,
 * footpaths ~0.15, which mostly read as packed dirt and gravel).
 *
 * World units: 1 = 100 game units, so a cobble scale of 2.2 gives stones ~45 game units wide.
 */
export interface RoadStyle {
  cobbles: number;
  /** Stone cells per world unit. */
  stoneScale: number;
}

export const ROAD_STYLE: RoadStyle = { cobbles: 0.45, stoneScale: 1.5 };
export const PATH_STYLE: RoadStyle = { cobbles: 0.12, stoneScale: 2.4 };

export function createRoadMaterial(map: THREE.Texture, style: RoadStyle): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0, side: THREE.DoubleSide });

  material.colorNode = Fn(() => {
    const p = positionWorld.xz;
    // Original road colour, averaged by sampling the tileable texture coarsely.
    const orig = texture(map, uv().mul(0.25)).rgb.add(texture(map, uv().mul(0.25).add(0.5)).rgb).mul(0.5);

    // Packed earth: warm brown with soft blotches and fine grit.
    const blotch = mx_noise_float(p.mul(0.35)).mul(0.5).add(0.5);
    const grit = mx_noise_float(p.mul(9.0)).mul(0.5).add(0.5);
    const earthBase = mix(orig.mul(vec3(1.0, 0.92, 0.8)), vec3(0.3, 0.23, 0.15), 0.45);
    const earth = earthBase.mul(float(0.82).add(blotch.mul(0.3))).mul(float(0.92).add(grit.mul(0.16)));

    // Cobblestones: Worley cells; F2 - F1 is small near cell borders (the mortar lines).
    const w = mx_worley_noise_vec2(p.mul(style.stoneScale));
    const border = w.y.sub(w.x);
    const stoneInterior = smoothstep(0.04, 0.16, border);
    // Domed stones: lighter in the middle, darker towards the edge.
    const dome = float(1).sub(w.x.mul(0.55));
    const stoneTone = mx_noise_float(p.mul(style.stoneScale).mul(1.7).add(13.1)).mul(0.5).add(0.5);
    const stoneColour = mix(vec3(0.34, 0.32, 0.29), vec3(0.46, 0.42, 0.36), stoneTone).mul(dome).mul(mix(vec3(1), orig.mul(1.6), 0.25));
    const mortar = earth.mul(0.55);
    const cobble = mix(mortar, stoneColour, stoneInterior);

    // Where the road is paved: noisy coverage, with worn gaps showing the earth beneath.
    const cover = mx_noise_float(p.mul(0.18).add(vec2(41.0, 7.0))).mul(0.5).add(0.5);
    const paved = smoothstep(float(1).sub(style.cobbles).sub(0.12), float(1).sub(style.cobbles).add(0.12), cover);
    const surface = mix(earth, cobble, paved);

    // Banks and slopes darken a little, like the rest of the terrain.
    const slope = float(1).sub(normalWorld.y.abs());
    return surface.mul(float(1).sub(smoothstep(0.12, 0.6, slope).mul(0.35)));
  })();

  return material;
}
