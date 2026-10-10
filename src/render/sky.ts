import * as THREE from 'three/webgpu';
import { skyLight } from './skyUniforms';
import {
  Fn,
  cameraPosition,
  clamp,
  dot,
  float,
  fog as fogNode,
  rangeFogFactor,
  floor,
  fract,
  length,
  hash,
  If,
  mix,
  mx_fractal_noise_float,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  saturate,
  smoothstep,
  step,
  time,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import { computeSkyState, type Rgb, type Vec3 } from './skyMath';
import { MINE_LOOK, outdoorMagicStrength, torchFlicker } from '../world/underground';

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
  /** Re-centre the shadow frustum on a render-space point (the party); call every frame. */
  followShadow(x: number, y: number, z: number): void;
  /** Turn sun/moon shadows on or off (graphics quality). */
  setShadows(enabled: boolean): void;
  /** Underground: no sky or sun, black cave fog, a faint ambient and a flickering lantern on the party. */
  setUnderground(enabled: boolean): void;
  /** Underground: an active light spell widens and brightens the lantern. */
  setMagicLight(on: boolean): void;
}

/** Dome radius in world units (fits inside any sensible camera far plane). */
export const DOME_RADIUS = 5_000;
/** Fog range in world units (20 000–120 000 game units). */
export const FOG_NEAR = 200;
export const FOG_FAR = 1_200;
/** How far from the origin the key light is placed; only its direction matters. */
const LIGHT_DISTANCE = 500;

/** Half-size of the shadow frustum in world units (~4 000 game units each way) and its map size. */
export const SHADOW_EXTENT = 40;
export const SHADOW_MAP_SIZE = 2048;

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

  // Underground lantern: a point light that follows the camera, only lit in mine zones.
  const torch = new THREE.PointLight(MINE_LOOK.torchColor, 0, MINE_LOOK.torchDistance, MINE_LOOK.torchDecay);
  // Always visible (intensity 0 when off): toggling visibility changes the light count and recompiles every lit material,
  // which left a mine zone loaded at start black.
  scene.add(torch);
  let underground = false;
  let magic = false;
  let sunVis = 1;
  let lastMinutes = 12 * 60;
  let shadowsWanted = true;

  // Sun shadows: an orthographic frustum that follows the party, snapped to shadow-map texels so
  // the shadows don't swim while walking. Soft edges come from the PCF radius.
  key.castShadow = true;
  key.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  const sc = key.shadow.camera;
  sc.left = sc.bottom = -SHADOW_EXTENT;
  sc.right = sc.top = SHADOW_EXTENT;
  sc.near = 1;
  sc.far = LIGHT_DISTANCE + 150;
  sc.updateProjectionMatrix();
  key.shadow.radius = 3;
  key.shadow.blurSamples = 12;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.05;
  const lightDir = new THREE.Vector3(0, 1, 0);
  const shadowRight = new THREE.Vector3();
  const shadowUp = new THREE.Vector3();

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
  // Clouds: lit and shaded colours, and the warm horizon glow near a low sun (colour times strength).
  const uCloudLit = uniform(new THREE.Color(1, 1, 1));
  const uCloudShade = uniform(new THREE.Color(0.5, 0.55, 0.65));
  const uGlow = uniform(new THREE.Color(0, 0, 0));
  // Fog follows the sky: the horizon colour plus the sunset glow towards the sun, per pixel by view azimuth.
  const uFogColor = uniform(new THREE.Color());
  const sunsetFog = fogNode(
    Fn(() => {
      const view = normalize(positionWorld.sub(cameraPosition));
      const flat = normalize(vec2(view.x, view.z).add(vec2(0.0001, 0)));
      const sunFlat = normalize(vec2(uSunDir.x, uSunDir.z).add(vec2(0.0001, 0)));
      const towards = pow(saturate(dot(flat, sunFlat)), 3);
      return uFogColor.mul(1).add(uGlow.mul(towards.mul(1.2).add(0.18)));
    })(),
    rangeFogFactor(FOG_NEAR, FOG_FAR),
  );
  scene.fogNode = sunsetFog;

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
    const sunGlow = pow(saturate(sd), 48)
      .mul(0.6)
      .add(pow(saturate(sd), 6).mul(0.08));
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
    const star = step(0.9965, hash(seed))
      .mul(hash(seed.add(7)).mul(0.6).add(0.4))
      .mul(dot2);
    const starMask = saturate(h.mul(3).add(0.2)).mul(uStars).mul(float(1).sub(moonDisc));
    col.addAssign(vec3(1).mul(star).mul(starMask));

    // Sunset glow: a warm band along the horizon, strongest towards the sun.
    const band = pow(float(1).sub(saturate(h.mul(2.2))), 3);
    const towardSun = pow(saturate(sd), 3).mul(1.2).add(0.18);
    col.addAssign(uGlow.mul(band).mul(towardSun));

    // Clouds: soft cumulus on a high plane (perspective-projected, so they shrink towards the horizon),
    // thickness from fractal noise, shaded by how much cloud lies towards the sun, drifting slowly.
    If(h.greaterThan(0.01), () => {
      const plane = dir.xz.div(h.add(0.2)).mul(0.8);
      const drift = vec3(time.mul(0.006), time.mul(0.002), time.mul(0.004));
      const p = vec3(plane.x, plane.y, 0).add(drift);
      const n = mx_fractal_noise_float(p, 4, 2, 0.5).mul(0.5).add(0.5);
      const towards = normalize(uSunDir.xz.add(vec2(0.001, 0)));
      const n2 = mx_fractal_noise_float(p.add(vec3(towards.x.mul(0.25), towards.y.mul(0.25), 0)), 2, 2, 0.5)
        .mul(0.5)
        .add(0.5);
      const cover = smoothstep(0.44, 0.62, n);
      const lit = saturate(float(0.62).sub(n2.sub(n).mul(3.2)));
      const edge = float(1).sub(cover);
      const cloudCol = mix(uCloudShade, uCloudLit, lit)
        .add(uGlow.mul(pow(saturate(sd), 2).mul(0.6).add(0.12)).mul(float(1).sub(saturate(h.mul(2)))))
        .add(uCloudLit.mul(pow(saturate(sd), 10).mul(edge.mul(0.8))));
      const alpha = cover.mul(smoothstep(0.01, 0.16, h)).mul(0.94);
      col.assign(mix(col, cloudCol, alpha));
      // The sun's glow bleeds through thin cloud.
      col.addAssign(uSunColor.mul(sunGlow).mul(uSunVis).mul(alpha).mul(0.5));
    });

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

  const applyUnderground = () => {
    key.intensity = 0;
    hemi.color.set(MINE_LOOK.hemiSky);
    hemi.groundColor.set(MINE_LOOK.hemiGround);
    hemi.intensity = MINE_LOOK.hemiIntensity;
    fog.color.set(MINE_LOOK.fogColor);
    fog.near = MINE_LOOK.fogNear;
    fog.far = MINE_LOOK.fogFar;
  };

  // Outdoors a light spell lights the party at night; the glow fades out as the sun comes up.
  const refreshOutdoorGlow = () => {
    if (underground) return;
    const k = magic ? outdoorMagicStrength(sunVis) : 0;
    // Stay visible while the spell lasts (intensity 0 by day): toggling visibility changes the light count and recompiles every lit material.
    torch.intensity = MINE_LOOK.outdoorIntensity * k;
    torch.distance = MINE_LOOK.outdoorDistance;
  };

  return {
    setShadows(enabled: boolean): void {
      shadowsWanted = enabled;
      key.castShadow = enabled && !underground;
    },

    setMagicLight(on: boolean): void {
      if (on === magic) return;
      magic = on;
      if (underground) torch.distance = MINE_LOOK.torchDistance * (on ? MINE_LOOK.magicReach : 1);
      else refreshOutdoorGlow();
    },

    setUnderground(enabled: boolean): void {
      if (enabled === underground) return;
      underground = enabled;
      dome.visible = !enabled;
      scene.fogNode = enabled ? null : sunsetFog;
      torch.intensity = enabled ? MINE_LOOK.torchIntensity : 0;
      key.castShadow = shadowsWanted && !enabled;
      if (enabled) {
        applyUnderground();
      } else {
        fog.near = FOG_NEAR;
        fog.far = FOG_FAR;
        this.update(lastMinutes);
      }
    },

    followShadow(x: number, y: number, z: number): void {
      if (underground) {
        torch.position.set(x, y, z);
        torch.intensity =
          MINE_LOOK.torchIntensity * (magic ? MINE_LOOK.magicBoost : 1) * torchFlicker(performance.now() / 1000);
        return;
      }
      if (magic && sunVis < 1) {
        torch.position.set(x, y + 2, z);
        torch.intensity =
          MINE_LOOK.outdoorIntensity * outdoorMagicStrength(sunVis) * torchFlicker(performance.now() / 1000);
      }
      // Snap the target to the shadow texel grid in light space.
      const texel = (2 * SHADOW_EXTENT) / SHADOW_MAP_SIZE;
      shadowRight.set(0, 1, 0).cross(lightDir);
      if (shadowRight.lengthSq() < 1e-6) shadowRight.set(1, 0, 0);
      shadowRight.normalize();
      shadowUp.crossVectors(lightDir, shadowRight);
      const px = x * shadowRight.x + y * shadowRight.y + z * shadowRight.z;
      const py = x * shadowUp.x + y * shadowUp.y + z * shadowUp.z;
      const pl = x * lightDir.x + y * lightDir.y + z * lightDir.z;
      const sx = Math.round(px / texel) * texel;
      const sy = Math.round(py / texel) * texel;
      key.target.position
        .set(0, 0, 0)
        .addScaledVector(shadowRight, sx)
        .addScaledVector(shadowUp, sy)
        .addScaledVector(lightDir, pl);
      key.position.copy(lightDir).multiplyScalar(LIGHT_DISTANCE).add(key.target.position);
      key.target.updateMatrixWorld();
    },
    update(minutes: number): void {
      lastMinutes = minutes;
      if (underground) return;
      const s = computeSkyState(minutes);

      setColor(key.color, s.keyColor);
      key.intensity = s.keyIntensity;
      lightDir.set(s.keyDir[0], s.keyDir[1], s.keyDir[2]).normalize();
      key.position.copy(lightDir).multiplyScalar(LIGHT_DISTANCE).add(key.target.position);

      setColor(hemi.color, s.hemiSky);
      setColor(hemi.groundColor, s.hemiGround);
      hemi.intensity = s.hemiIntensity;

      setColor(fog.color, s.horizon);
      setColor(uFogColor.value, s.horizon);

      setColor(uZenith.value, s.zenith);
      setColor(uHorizon.value, s.horizon);
      setVec(uSunDir.value, s.sunDir);
      setVec(uMoonDir.value, s.moonDir);
      setColor(uSunColor.value, s.sunColor);
      uSunVis.value = s.sunVisibility;
      uMoonVis.value = s.moonVisibility;
      skyLight.zenith.value.copy(uZenith.value);
      skyLight.horizon.value.copy(uHorizon.value);
      skyLight.sunDir.value.copy(uSunDir.value);
      skyLight.sunColor.value.copy(uSunColor.value);
      skyLight.sunVis.value = s.sunVisibility;
      uStars.value = s.starAlpha;

      // Cloud lighting: sunlit by day (warm at dusk through the sun colour), dim blue-grey at night.
      const day = s.sunVisibility;
      const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
      const tone = (i: number) =>
        lerp(s.horizon[i]! * 1.1 + 0.03, s.sunColor[i]!, 0.85 * day) + s.moonVisibility * 0.12 * (1 - day);
      uCloudLit.value.setRGB(tone(0), tone(1), tone(2), THREE.SRGBColorSpace);
      uCloudShade.value.setRGB(
        s.horizon[0]! * 0.55 + s.zenith[0]! * 0.3,
        s.horizon[1]! * 0.55 + s.zenith[1]! * 0.3,
        s.horizon[2]! * 0.55 + s.zenith[2]! * 0.3,
        THREE.SRGBColorSpace,
      );
      // Glow only while the sun is near the horizon (a little before sunrise to just after sunset times).
      const sunY = s.sunDir[1];
      const rise = Math.min(1, Math.max(0, (sunY + 0.22) / 0.24));
      const fall = 1 - Math.min(1, Math.max(0, (sunY - 0.06) / 0.36));
      const glow = rise * rise * (3 - 2 * rise) * (fall * fall * (3 - 2 * fall));
      uGlow.value.setRGB(
        lerp(s.sunColor[0]!, 1, 0.5) * glow,
        lerp(s.sunColor[1]!, 0.42, 0.55) * glow,
        lerp(s.sunColor[2]!, 0.16, 0.6) * glow,
        THREE.SRGBColorSpace,
      );
      skyLight.glow.value.copy(uGlow.value);

      sunVis = s.sunVisibility;
      refreshOutdoorGlow();
    },
  };
}
