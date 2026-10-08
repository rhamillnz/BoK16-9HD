import * as THREE from 'three/webgpu';
import {
  Fn,
  cameraPosition,
  dot,
  float,
  max,
  mix,
  mx_noise_float,
  normalize,
  positionWorld,
  pow,
  reflect,
  smoothstep,
  texture,
  time,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
import { bumpedNormal } from './bump';
import { skyLight } from './skyUniforms';

/** Ripple height (render units): small, the water is calm river water. */
const RIPPLE = 0.05;

/**
 * Rivers and lakes: the original river colour as the deep tint, under moving ripples that reflect
 * the current sky (stronger at grazing angles, Fresnel) and catch the sun as a glint. All
 * procedural (TSL); the sky colours come from skyUniforms.ts, so dawn, dusk and night show in it.
 */
export function createWaterMaterial(map: THREE.Texture): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.18, metalness: 0, side: THREE.DoubleSide });
  const p = positionWorld.xz;

  // Two ripple layers drifting in different directions, plus a slow swell.
  const ripples = Fn(() => {
    const a = mx_noise_float(p.mul(0.9).add(vec2(time.mul(0.12), time.mul(0.05))));
    const b = mx_noise_float(
      p
        .mul(1.7)
        .sub(vec2(time.mul(0.07), time.mul(-0.1)))
        .add(13.3),
    );
    const swell = mx_noise_float(p.mul(0.2).add(vec2(time.mul(0.03), 0)));
    return a.mul(0.5).add(b.mul(0.3)).add(swell.mul(0.6)).mul(RIPPLE);
  })();
  const normal = bumpedNormal(ripples);
  material.normalNode = normal;

  // Original river colour, averaged (coarse mip), darkened into deep water.
  const orig = texture(map, uv()).level(float(6)).rgb;
  const deep = mix(vec3(0.01, 0.035, 0.05), orig.mul(0.35), 0.5);
  material.colorNode = deep;

  // Sky reflection and sun glint, added as light the water gives back (the scene has no env map).
  material.emissiveNode = Fn(() => {
    const view = normalize(positionWorld.sub(cameraPosition));
    // A world-space ripple normal for the reflection (the bumped normal above is in view space).
    const tilt = vec3(
      mx_noise_float(p.mul(0.9).add(vec2(time.mul(0.12), time.mul(0.05)))).mul(0.06),
      1,
      mx_noise_float(
        p
          .mul(1.7)
          .sub(vec2(time.mul(0.07), time.mul(-0.1)))
          .add(13.3),
      ).mul(0.06),
    );
    const n = normalize(tilt);
    const r = reflect(view, n);
    const facing = max(dot(view.negate(), n), 0);
    const fresnel = float(0.02).add(float(0.98).mul(pow(float(1).sub(facing), 5)));
    const skyColour = mix(skyLight.horizon, skyLight.zenith, smoothstep(0, 0.6, max(r.y, 0)));
    const glint = pow(max(dot(r, skyLight.sunDir), 0), 220)
      .mul(skyLight.sunVis)
      .mul(6);
    return skyColour.mul(fresnel.mul(0.9).add(0.08)).add(skyLight.sunColor.mul(glint));
  })();
  return material;
}
