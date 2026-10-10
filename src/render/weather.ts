import * as THREE from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  float,
  fract,
  normalize,
  positionGeometry,
  step,
  time,
  vec2,
  vec3,
} from 'three/tsl';
import { weatherLight } from './weatherUniforms';
import { WEATHER_PRESETS, easeWeather, scheduledWeather, type WeatherAmounts, type WeatherKind } from './weatherPlan';

/**
 * Weather: eases the shared amounts (weatherUniforms.ts) towards the current preset, and draws rain as
 * thin streaks in a box around the camera. The streaks are one static mesh whose vertex shader places
 * and animates every drop (falling, wrapped in world space around the camera), so there is no per-frame
 * CPU work beyond easing five numbers. Sky, fog and road read the uniforms.
 */

const DROPS = 7000;
/** Side of the box the drops fall in (render units) and its height. */
const BOX = 26;
const HEIGHT = 14;

function rainMesh(): THREE.Mesh {
  const positions = new Float32Array(DROPS * 4 * 3);
  const seeds = new Float32Array(DROPS * 4 * 3);
  const index = new Uint32Array(DROPS * 6);
  // Deterministic pseudo-random seeds: a fixed pattern so the rain looks the same every run.
  let s = 12345;
  const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < DROPS; i++) {
    const seed = [rnd(), rnd(), rnd()];
    // Corner: x -1/+1 across, y 0/1 along the streak.
    const corners = [-1, 0, 1, 0, -1, 1, 1, 1];
    for (let v = 0; v < 4; v++) {
      positions.set([corners[v * 2]!, corners[v * 2 + 1]!, 0], (i * 4 + v) * 3);
      seeds.set(seed, (i * 4 + v) * 3);
    }
    index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));

  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide,
  });
  const seed = attribute('seed', 'vec3');
  const corner = positionGeometry;
  // Fall position wraps through the box; x/z wrap in world space so drops stay put as the camera moves.
  const t = fract(time.mul(1.7).add(seed.y));
  const wrap = (u: THREE.Node<'float'>, c: THREE.Node<'float'>) =>
    c.add(
      fract(u.sub(c.div(BOX)))
        .sub(0.5)
        .mul(BOX),
    );
  const px = wrap(seed.x, cameraPosition.x).add(t.mul(-2.5)); // a little wind
  const pz = wrap(seed.z.mul(7.31).add(seed.x.mul(3.7)), cameraPosition.z);
  const py = cameraPosition.y.add(HEIGHT * 0.55).sub(t.mul(HEIGHT));
  // Only the first `rain` fraction of the drops is drawn (hashed by seed.z).
  const camDist = vec2(px.sub(cameraPosition.x), pz.sub(cameraPosition.z)).length();
  const on = step(seed.z, weatherLight.rain).mul(step(2.5, camDist));
  const away = normalize(vec2(px.sub(cameraPosition.x), pz.sub(cameraPosition.z)).add(vec2(0.0001, 0)));
  const right = vec2(away.y.negate(), away.x);
  const width = float(0.009).mul(on);
  const length = float(0.6).mul(on);
  material.positionNode = vec3(
    px.add(right.x.mul(corner.x).mul(width)).add(corner.y.mul(length).mul(0.1)),
    py.add(corner.y.mul(length)),
    pz.add(right.y.mul(corner.x).mul(width)),
  );
  material.colorNode = vec3(0.72, 0.78, 0.86);
  material.opacityNode = weatherLight.rain.mul(0.35).mul(float(1).sub(corner.y.mul(0.6)));

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.visible = false;
  return mesh;
}

export class Weather {
  private current: WeatherAmounts = { ...WEATHER_PRESETS.clear };
  private forced: WeatherKind | undefined;
  private scheduled: WeatherKind = 'clear';
  private readonly rain = rainMesh();

  constructor(scene: THREE.Scene) {
    scene.add(this.rain);
  }

  /** The weather in effect: the forced preset if any, else the schedule. */
  get kind(): WeatherKind {
    return this.forced ?? this.scheduled;
  }

  /** The forced preset, if any. */
  get forcedKind(): WeatherKind | undefined {
    return this.forced;
  }

  /** Force a preset (debug), or undefined to follow the schedule again. */
  force(kind: WeatherKind | undefined): void {
    this.forced = kind;
    // A forced preset (debug) applies at once.
    if (kind) this.current = { ...WEATHER_PRESETS[kind] };
  }

  /** Follow the schedule for a zone and game time. */
  schedule(zone: number, day: number, hour: number, underground: boolean): void {
    this.scheduled = scheduledWeather(zone, day, hour, underground);
    this.underground = underground;
  }

  private underground = false;

  /** Ease the amounts towards the preset; call every frame. */
  update(dt: number): void {
    const target = WEATHER_PRESETS[this.underground ? 'clear' : this.kind];
    this.current = easeWeather(this.current, target, dt);
    weatherLight.rain.value = this.current.rain;
    weatherLight.overcast.value = this.current.overcast;
    weatherLight.mist.value = this.current.mist;
    weatherLight.wet.value = this.current.wet;
    this.rain.visible = this.current.rain > 0.01;
  }

  /** Overcast amount now (0..1), for the key light. */
  get overcast(): number {
    return this.current.overcast;
  }
}
