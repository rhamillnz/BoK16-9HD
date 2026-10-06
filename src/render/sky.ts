import * as THREE from 'three/webgpu';
import {
  Fn,
  cameraPosition,
  clamp,
  dot,
  float,
  floor,
  fract,
  length,
  hash,
  mix,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  saturate,
  smoothstep,
  step,
  uniform,
  vec3,
} from 'three/tsl';
import { computeSkyState, type Rgb, type Vec3 } from './skyMath';

/**
 * Time-of-day sky: gradient dome (follows the camera), sun + moon discs, stars,
 * a DirectionalLight key light (sun by day, moon by night), a HemisphereLight and
 * fog tracking the horizon colour.
 *
 * World units: 1 unit = 100 game units. Y up, north = −Z, east = +X.
 * The camera far plane must be larger than DOME_RADIUS.
 */

export interface Sky {
  /** Apply the lighting, fog and dome for a time of day (minutes since midnight). */
  update(minutesSinceMidnight: number): void;
}

/** Dome radius in world units (fits inside any sensible camera far plane). */
export const DOME_RADIUS = 5_000;
/** Fog range in world units (20 000–120 000 game units). */
export const FOG_NEAR = 200;
export const FOG_FAR = 1_200;
/** How far from the origin the key light is placed; only its direction matters. */
const LIGHT_DISTANCE = 500;

/** Angular radius of the sun/moon discs in radians (exaggerated for readability). */
const SUN_RADIUS = 0.035;
const MOON_RADIUS = 0.03;

const setColor = (target: THREE.Color, rgb: Rgb) => target.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);

export function createSky(scene: THREE.Scene): Sky {
  // --- lights and fog -------------------------------------------------------
  const key = new THREE.DirectionalLight(0xffffff, 1);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
  const fog = new THREE.Fog(0x000000, FOG_NEAR, FOG_FAR);
  scene.background = null; // the dome paints the whole view
  scene.fog = fog;
  scene.add(key, key.target, hemi);

  // --- dome -----------------------------------------------------------------
  const uZenith = uniform(new THREE.Color());
  const uHorizon = uniform(new THREE.Color());
  const uSunDir = uniform(new THREE.Vector3(0, 1, 0));
  const uMoonDir = uniform(new THREE.Vector3(0, -1, 0));
  const uSunColor = uniform(new THREE.Color(0xfff1d6));
  const uMoonColor = uniform(new THREE.Color(0x9bb4ff));
  const uSunVis = uniform(1);
  const uMoonVis = uniform(0);
  const uStars = uniform(0);

  const skyColor = Fn(() => {
    const dir = normalize(positionWorld.sub(cameraPosition));
    const h = dir.y;

    // Zenith/horizon gradient, darkened below the horizon so tilting down never shows a void.
    const up = pow(clamp(h, 0, 1), 0.5);
    const gradient = mix(uHorizon, uZenith, up);
    const belowT = float(1).sub(smoothstep(-0.35, 0, h));
    const col = mix(gradient, uHorizon.mul(0.5), belowT).toVar();

    // Sun: disc + tight glow + wide halo, tinted by the sunlight colour.
    const sd = dot(dir, uSunDir);
    const sunQ = float(1).sub(sd); // ≈ θ²/2
    const sunDisc = float(1).sub(smoothstep(SUN_RADIUS * SUN_RADIUS * 0.4, SUN_RADIUS * SUN_RADIUS * 0.6, sunQ));
    const sunGlow = pow(saturate(sd), 48).mul(0.6).add(pow(saturate(sd), 6).mul(0.08));
    col.addAssign(uSunColor.mul(sunDisc.mul(8).add(sunGlow)).mul(uSunVis));

    // Moon: pale disc with a faint halo.
    const md = dot(dir, uMoonDir);
    const moonQ = float(1).sub(md);
    const moonDisc = float(1).sub(smoothstep(MOON_RADIUS * MOON_RADIUS * 0.4, MOON_RADIUS * MOON_RADIUS * 0.6, moonQ));
    const moonGlow = pow(saturate(md), 96).mul(0.2);
    col.addAssign(uMoonColor.mul(moonDisc.mul(1.6).add(moonGlow)).mul(uMoonVis));

    // Stars: one hashed cell grid over the sphere, fading in with darkness and altitude.
    const cell = floor(dir.mul(220).add(512));
    const seed = cell.x.add(cell.y.mul(1031)).add(cell.z.mul(1049));
    const dot2 = float(1).sub(smoothstep(0.08, 0.28, length(fract(dir.mul(220)).sub(0.5))));
    const star = step(0.9965, hash(seed)).mul(hash(seed.add(7)).mul(0.6).add(0.4)).mul(dot2);
    const starMask = saturate(h.mul(3).add(0.2)).mul(uStars).mul(float(1).sub(moonDisc));
    col.addAssign(vec3(1).mul(star).mul(starMask));

    return col;
  });

  const material = new THREE.MeshBasicNodeMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  // Re-centre on the camera in the vertex stage so the dome never needs a per-frame matrix update.
  material.positionNode = positionLocal.mul(DOME_RADIUS).add(cameraPosition);
  material.colorNode = skyColor();

  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), material);
  dome.renderOrder = -1000;
  dome.frustumCulled = false;
  scene.add(dome);

  // --- per-update -----------------------------------------------------------
  const setVec = (target: THREE.Vector3, v: Vec3) => target.set(v[0], v[1], v[2]);

  return {
    update(minutes: number): void {
      const s = computeSkyState(minutes);

      setColor(key.color, s.keyColor);
      key.intensity = s.keyIntensity;
      key.position.set(s.keyDir[0], s.keyDir[1], s.keyDir[2]).multiplyScalar(LIGHT_DISTANCE);
      key.target.position.set(0, 0, 0);

      setColor(hemi.color, s.hemiSky);
      setColor(hemi.groundColor, s.hemiGround);
      hemi.intensity = s.hemiIntensity;

      setColor(fog.color, s.horizon);

      setColor(uZenith.value, s.zenith);
      setColor(uHorizon.value, s.horizon);
      setVec(uSunDir.value, s.sunDir);
      setVec(uMoonDir.value, s.moonDir);
      setColor(uSunColor.value, s.sunColor);
      uSunVis.value = s.sunVisibility;
      uMoonVis.value = s.moonVisibility;
      uStars.value = s.starAlpha;
    },
  };
}
