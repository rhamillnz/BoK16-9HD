import * as THREE from 'three/webgpu';
import {
  Fn,
  abs,
  attribute,
  float,
  max,
  mix,
  mx_noise_float,
  normalWorld,
  positionWorld,
  smoothstep,
  step,
  texture,
  uv,
  vec3,
} from 'three/tsl';
import { bumpedNormal } from './bump';

/**
 * Dusty cart track: packed earth in the original road colour, two wheel ruts worn into it, a
 * grassy hump between them and soft, wavy edges that fade into the grass. Everything is
 * procedural (TSL); the position across the strip comes from the `roadAcross` vertex attribute
 * (0 on one edge, 1 on the other; see `stripAcross` in zoneScene.ts). Ruts are symmetric about
 * the middle, so neighbouring pieces match whichever way round they were built.
 *
 * World units: 1 = 100 game units; roads are ~18 wide, footpaths ~9.
 */
export interface RoadStyle {
  /** Wheel ruts (cart roads); footpaths get one worn line down the middle instead. */
  ruts: boolean;
  /** Rut centre, as a distance from the middle of the strip (fraction of its width). */
  rutOffset: number;
  /** Rut half-width (fraction of the strip's width). */
  rutWidth: number;
  /** How far in from the edge the surface fades into the grass (fraction of the width). */
  edgeFade: number;
}

export const ROAD_STYLE: RoadStyle = { ruts: true, rutOffset: 0.17, rutWidth: 0.055, edgeFade: 0.13 };
export const PATH_STYLE: RoadStyle = { ruts: false, rutOffset: 0, rutWidth: 0.12, edgeFade: 0.18 };

/** Bump height (render units) of the ruts and the lumpy surface. */
const RUT_DEPTH = 0.12;

export function createRoadMaterial(map: THREE.Texture, style: RoadStyle): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
    transparent: true,
  });
  const p = positionWorld.xz;

  // Across the strip: wobbled a little in world space so the track meanders instead of ruling straight lines.
  const raw = attribute('roadAcross', 'float');
  const known = step(-0.5, raw);
  const across = mix(float(0.5), raw, known).add(mx_noise_float(p.mul(0.05)).mul(0.05));
  const fromMiddle = abs(across.sub(0.5));

  // Wheel ruts (or the footpath's worn centre line), 1 in the groove.
  const rutAt = style.ruts ? abs(fromMiddle.sub(style.rutOffset)) : fromMiddle;
  const rut = float(1)
    .sub(smoothstep(style.rutWidth * 0.35, style.rutWidth, rutAt.add(mx_noise_float(p.mul(1.7)).mul(0.008))))
    .mul(known);
  // Grass and weeds on the crown between the ruts, patchy along the road.
  const crown = style.ruts
    ? float(1).sub(smoothstep(style.rutOffset - style.rutWidth * 2.2, style.rutOffset - style.rutWidth, fromMiddle))
    : float(0);
  const weeds = crown.mul(smoothstep(0.1, 0.6, mx_noise_float(p.mul(0.9).add(3.3)).mul(0.5).add(0.5))).mul(known);

  material.colorNode = Fn(() => {
    // The original road colour, averaged by sampling the tileable texture coarsely.
    const orig = texture(map, uv().mul(0.25))
      .rgb.add(texture(map, uv().mul(0.25).add(0.5)).rgb)
      .mul(0.5);
    const blotch = mx_noise_float(p.mul(0.3)).mul(0.5).add(0.5);
    const grit = mx_noise_float(p.mul(11.0)).mul(0.5).add(0.5);
    // Dust: the same earth colour the road had before (original texture pulled towards dusty
    // brown), lighter where dry and patchy, with fine grit.
    const earth = mix(orig.mul(vec3(1.0, 0.92, 0.8)), vec3(0.3, 0.23, 0.15), 0.45);
    const dust = earth.mul(float(0.88).add(blotch.mul(0.3))).mul(float(0.9).add(grit.mul(0.2)));
    // Ruts are packed and a little damp: darker; the churned dust beside them is lighter.
    const groove = earth.mul(vec3(0.52, 0.48, 0.45));
    const rim = float(1)
      .sub(smoothstep(0, style.rutWidth * 0.8, abs(rutAt.sub(style.rutWidth * 1.4))))
      .mul(known)
      .mul(style.ruts ? 1 : 0);
    const grass = vec3(0.05, 0.09, 0.025).mul(float(0.8).add(blotch.mul(0.4)));
    const surface = mix(mix(dust.mul(float(1).add(rim.mul(0.18))), groove, rut), grass, weeds.mul(0.75));
    // Banks and slopes darken a little, like the rest of the terrain.
    const slope = float(1).sub(normalWorld.y.abs());
    return surface.mul(float(1).sub(smoothstep(0.12, 0.6, slope).mul(0.35)));
  })();

  // Ruts sink in, the crown and the dust are lumpy: bump only, the strip itself stays flat.
  const lumps = mx_noise_float(p.mul(2.3))
    .mul(0.25)
    .add(mx_noise_float(p.mul(7.0)).mul(0.1));
  material.normalNode = bumpedNormal(lumps.sub(rut).add(weeds.mul(0.3)).mul(RUT_DEPTH));

  // Soft, wavy edges into the grass instead of a hard polygon outline.
  const edge = fromMiddle.add(mx_noise_float(p.mul(0.45).add(9.1)).mul(0.04));
  const opacity = float(1).sub(smoothstep(float(0.5 - style.edgeFade), float(0.5), edge));
  material.opacityNode = max(opacity, float(1).sub(known));
  material.depthWrite = false;
  return material;
}
