import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

/**
 * The current sky, shared with materials that reflect it (water). sky.ts copies its values here
 * whenever the time of day changes; the defaults are a clear midday.
 */
export const skyLight = {
  zenith: uniform(new THREE.Color(0.25, 0.45, 0.8)),
  horizon: uniform(new THREE.Color(0.6, 0.7, 0.82)),
  /** Unit vector towards the sun (render space, y up). */
  sunDir: uniform(new THREE.Vector3(0.3, 0.8, 0.5).normalize()),
  sunColor: uniform(new THREE.Color(1, 0.95, 0.85)),
  /** 0 at night, 1 in daylight. */
  sunVis: uniform(1),
};
