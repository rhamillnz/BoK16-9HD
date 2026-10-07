import * as THREE from 'three/webgpu';
import { Fn, attribute, cameraPosition, cos, float, mix, positionLocal, sin, smoothstep, time, transformNormalToView, uniform, vec3 } from 'three/tsl';
import { CLUMP_HEIGHT, GRASS_PRESETS, cellInView, cellsAround, lodKeep, scatterCell, type GrassQuality, type GrassSettings, type GroundSampler } from './grassMath';

/**
 * Stylised GPU-instanced grass: clumps of tapered blades scattered on Ground-terrain areas in a ring of
 * cells around the camera. The ring streams as the camera moves, thins out with distance, is culled to the
 * view cone, and the blades sway with a TSL wind. World units: 1 unit = 100 BaK units.
 *
 * `?grass=off|low|medium|high` overrides the quality from the URL.
 */

export interface Grass {
  readonly mesh: THREE.Mesh;
  quality: GrassQuality | 'off';
  /** Instances drawn this frame. */
  readonly instances: number;
  setQuality(q: GrassQuality | 'off'): void;
  dispose(): void;
}

export interface GrassOptions {
  quality?: GrassQuality | 'off';
  /** Base colour (0..1 sRGB); defaults to the sampler's `color`. */
  color?: [number, number, number];
}

const ENTRY = 8; // floats per scattered clump: x, y, z, yaw, scale, phase, tint, lodKey
const BLADES = 5;
const REBUILD_HEADING = THREE.MathUtils.degToRad(12);

/** One clump: a fan of tapered blades (3 tris each) of unit height, root at the origin. */
function clumpGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let b = 0; b < BLADES; b++) {
    const a = (b / BLADES) * Math.PI * 2 + b * 0.7;
    const r = 0.05 + 0.05 * ((b * 37) % 5) / 4;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const lean = 0.12 + 0.08 * (b % 3);
    const h = 0.7 + 0.3 * ((b * 53) % 7) / 6;
    const w = 0.045;
    const dx = Math.cos(a + 1.2);
    const dz = Math.sin(a + 1.2);
    const lx = Math.cos(a) * lean;
    const lz = Math.sin(a) * lean;
    const base = pos.length / 3;
    const v = (t: number, side: number, width: number) => pos.push(cx + dx * side * width + lx * t * t, t * h, cz + dz * side * width + lz * t * t);
    v(0, -1, w);
    v(0, 1, w);
    v(0.5, -1, w * 0.7);
    v(0.5, 1, w * 0.7);
    v(1, 0, 0);
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export function createGrass(scene: THREE.Scene, sampleGround: GroundSampler, options: GrassOptions = {}): Grass {
  const urlQuality = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('grass') : null;
  let quality: GrassQuality | 'off' = urlQuality === 'off' || urlQuality === 'low' || urlQuality === 'medium' || urlQuality === 'high' ? urlQuality : (options.quality ?? 'medium');
  const base = options.color ?? sampleGround.color ?? [0.3, 0.45, 0.2];

  // Stylised palette from the ground colour: dark saturated roots, lighter warm tips.
  const root = new THREE.Color().setRGB(base[0] * 0.45, base[1] * 0.62, base[2] * 0.35, THREE.SRGBColorSpace);
  const tip = new THREE.Color().setRGB(Math.min(1, base[0] * 1.15 + 0.1), Math.min(1, base[1] * 1.3 + 0.06), base[2] * 0.75, THREE.SRGBColorSpace);
  const uRoot = uniform(root);
  const uTip = uniform(tip);
  const uRadius = uniform(1); // fade-out distance in world units
  const uHeight = uniform(CLUMP_HEIGHT);

  const geometry = clumpGeometry() as THREE.InstancedBufferGeometry;
  const capacity = Math.max(...Object.values(GRASS_PRESETS).map((p) => p.maxInstances));
  const offsets = new Float32Array(capacity * 4); // x, y, z, yaw
  const params = new Float32Array(capacity * 4); // scale, phase, tint, 0
  const offsetAttr = new THREE.InstancedBufferAttribute(offsets, 4);
  const paramAttr = new THREE.InstancedBufferAttribute(params, 4);
  offsetAttr.setUsage(THREE.DynamicDrawUsage);
  paramAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aOffset', offsetAttr);
  geometry.setAttribute('aParams', paramAttr);
  geometry.instanceCount = 0;

  const aOffset = attribute<'vec4'>('aOffset', 'vec4');
  const aParams = attribute<'vec4'>('aParams', 'vec4');
  const material = new THREE.MeshLambertNodeMaterial({ side: THREE.DoubleSide });
  const tNode = positionLocal.y; // blades are unit height
  material.positionNode = Fn(() => {
    const centre = aOffset.xyz;
    // Fade clumps to nothing at the ring edge so streaming never pops.
    const dist = centre.xz.sub(cameraPosition.xz).length();
    const fade = float(1).sub(smoothstep(uRadius.mul(0.7), uRadius, dist));
    const s = aParams.x.mul(fade).mul(uHeight);
    const c = cos(aOffset.w);
    const sn = sin(aOffset.w);
    const x = positionLocal.x.mul(c).sub(positionLocal.z.mul(sn)).mul(s.mul(1.4));
    const z = positionLocal.x.mul(sn).add(positionLocal.z.mul(c)).mul(s.mul(1.4));
    const y = positionLocal.y.mul(s);
    // Wind: a slow travelling swell plus a faster flutter, strongest at the tips.
    const swell = sin(time.mul(1.5).add(centre.x.mul(0.35)).add(centre.z.mul(0.25)).add(aParams.y));
    const flutter = sin(time.mul(3.4).add(centre.x.mul(1.1)).add(aParams.y.mul(2)));
    const sway = swell.mul(0.6).add(flutter.mul(0.18)).mul(tNode.mul(tNode)).mul(s).mul(0.45);
    return centre.add(vec3(x.add(sway), y, z.add(sway.mul(0.4))));
  })();
  // Soft stylised shading: every blade is lit as if facing up, regardless of side.
  material.normalNode = transformNormalToView(vec3(0, 1, 0));
  material.colorNode = Fn(() => {
    const t = tNode.clamp(0, 1);
    const varied = mix(uRoot, uTip, t.mul(0.9).add(aParams.z.mul(0.2)));
    return varied.mul(aParams.z.mul(0.3).add(0.85));
  })();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'grass';
  mesh.frustumCulled = false; // vertices live far from the origin-centred bounds
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  scene.add(mesh);

  const cache = new Map<string, Float32Array>();
  let settings: GrassSettings = GRASS_PRESETS[quality === 'off' ? 'medium' : quality];
  let builtX = NaN;
  let builtZ = NaN;
  let builtHeading = NaN;
  let dirty = true;
  let drawn = 0;

  const rebuild = (cam: THREE.Camera) => {
    const camX = cam.position.x;
    const camZ = cam.position.z;
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const persp = cam as THREE.PerspectiveCamera;
    const vfov = THREE.MathUtils.degToRad(persp.fov ?? 60);
    const halfFov = Math.atan(Math.tan(vfov / 2) * (persp.aspect ?? 16 / 9)) + REBUILD_HEADING;
    uRadius.value = settings.radius * settings.cellSize;
    if (cache.size > 4 * (2 * settings.radius + 1) ** 2) cache.clear();

    let n = 0;
    for (const [cx, cz, d] of cellsAround(camX, camZ, settings.cellSize, settings.radius)) {
      if (!cellInView(cx, cz, settings.cellSize, camX, camZ, dir.x, dir.z, halfFov)) continue;
      const key = `${cx},${cz}`;
      let clumps = cache.get(key);
      if (!clumps) cache.set(key, (clumps = scatterCell(cx, cz, settings.cellSize, settings.density, sampleGround)));
      const keep = lodKeep(d, settings.radius, settings.farKeep);
      for (let i = 0; i < clumps.length && n < settings.maxInstances; i += ENTRY) {
        if (clumps[i + 7]! > keep) continue;
        offsets.set([clumps[i]!, clumps[i + 1]!, clumps[i + 2]!, clumps[i + 3]!], n * 4);
        params.set([clumps[i + 4]!, clumps[i + 5]!, clumps[i + 6]!, 0], n * 4);
        n++;
      }
    }
    geometry.instanceCount = n;
    drawn = n;
    offsetAttr.needsUpdate = true;
    paramAttr.needsUpdate = true;
    builtX = camX;
    builtZ = camZ;
    builtHeading = Math.atan2(dir.x, dir.z);
    dirty = false;
  };

  // Streams with the camera: the render loop calls this just before the grass draws, so no per-frame hook is needed.
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    if (quality === 'off') return;
    const look = camera.getWorldDirection(new THREE.Vector3());
    const heading = Math.atan2(look.x, look.z);
    const dh = Math.abs(Math.atan2(Math.sin(heading - builtHeading), Math.cos(heading - builtHeading)));
    const moved = Math.hypot(camera.position.x - builtX, camera.position.z - builtZ);
    if (dirty || !(moved < settings.cellSize * 0.5) || !(dh < REBUILD_HEADING)) rebuild(camera);
  };

  const grass: Grass = {
    mesh,
    get quality() {
      return quality;
    },
    set quality(q) {
      grass.setQuality(q);
    },
    get instances() {
      return drawn;
    },
    setQuality(q) {
      quality = q;
      mesh.visible = q !== 'off';
      if (q !== 'off') {
        settings = GRASS_PRESETS[q];
        cache.clear();
        dirty = true;
      }
    },
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
      cache.clear();
    },
  };
  grass.setQuality(quality);
  return grass;
}
