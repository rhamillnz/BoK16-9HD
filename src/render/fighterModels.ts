import * as THREE from 'three/webgpu';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { EYE_HEIGHT } from '../world/partyController';
import { WORLD_SCALE } from './zoneScene';

/**
 * Rigged, animated 3D models for the party in combat (public/models/party/<name>.glb, built by
 * tools/blender/build_party.py from art/jobs/party.json). Each model carries one animation per combat state.
 */

export type FighterClip = 'idle' | 'walk' | 'attack' | 'block' | 'cast' | 'hit' | 'death';

/** Height of a party model in model units (metres); Gorath's is scaled up in the model itself. */
export const PARTY_MODEL_HEIGHT = 1.8;
/** Model units to render units: eyes (about 93% of the height) at the party's eye height, as the NPC figures. */
export const PARTY_SCALE = EYE_HEIGHT / WORLD_SCALE / (0.93 * PARTY_MODEL_HEIGHT);
/** Seconds a fighter takes to walk from one cell to the next. */
export const SECONDS_PER_CELL = 0.42;
/** Turning speed while facing a new direction, radians per second. */
const TURN_RATE = 7;

const PARTY_MODELS = new Set(['locklear', 'gorath', 'owyn', 'pug', 'james', 'patrus']);

/** The model file name for a party member, or undefined when there is none. */
export function partyModelName(name: string): string | undefined {
  const n = name.trim().toLowerCase();
  return PARTY_MODELS.has(n) ? n : undefined;
}

/**
 * Creature models (public/models/creatures/<name>.glb, built from art/jobs/creatures.json) by monster index
 * (MNAMES.DAT). Monsters that share a sprite set share a model (the four giants, the ogres, both Nighthawks).
 */
const CREATURE_MODELS: Readonly<Record<number, string>> = {
  18: 'mor',
  19: 'brk',
  21: 'mor_caster',
  22: 'bsy',
  23: 'nhk',
  24: 'rog',
  25: 'pan',
  26: 'pai',
  27: 'spl',
  29: 'gnt',
  30: 'rog_mage',
  31: 'gnt',
  32: 'gnt',
  33: 'gnt',
  34: 'ogr',
  35: 'ogr',
  36: 'ogr',
  37: 'ogr',
  48: 'tro',
  52: 'wit',
  53: 'gob',
  55: 'que',
  56: 'rus',
  57: 'sha',
  61: 'mak',
  62: 'nhk',
  63: 'mor_caster',
};

/** The creature model file name for a monster index, or undefined when it has none yet. */
export function creatureModelName(monster: number): string | undefined {
  return CREATURE_MODELS[monster];
}

const cache = new Map<string, Promise<GLTF | undefined>>();
let loader: GLTFLoader | undefined;

/** One loader for every model; the meshes are Draco-compressed (decoder copied into public/draco/). */
function gltfLoader(): GLTFLoader {
  if (!loader) loader = new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath('/draco/'));
  return loader;
}

export function loadPartyModel(name: string, baseUrl = '/models/party/'): Promise<GLTF | undefined> {
  const key = baseUrl + name;
  let p = cache.get(key);
  if (!p) {
    p = gltfLoader()
      .loadAsync(`${baseUrl}${name}.glb`)
      .then((g) => {
        // Clips play in place: the cell-to-cell walk moves the model, so drop any root translation.
        for (const clip of g.animations) clip.tracks = clip.tracks.filter((t) => t.name !== 'root.position');
        return g;
      })
      .catch((err) => {
        console.warn(`Model ${name} failed:`, err);
        return undefined;
      });
    cache.set(key, p);
  }
  return p;
}

/**
 * See-through creatures (Rusalki, shades) carry their opacity as an "alpha" extra on a node (glTF extras become
 * userData); every material of the model is made transparent at that opacity. Materials are cloned first, as a
 * cloned model shares them with the cached original.
 */
export function applyModelAlpha(root: THREE.Object3D): void {
  let alpha: number | undefined;
  root.traverse((o) => {
    const a = (o.userData as { alpha?: unknown }).alpha;
    if (typeof a === 'number') alpha = a;
  });
  if (alpha === undefined) return;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const one = (m: THREE.Material) => {
      const c = m.clone();
      c.transparent = true;
      c.opacity = alpha!;
      c.depthWrite = true; // hides its own far side, so the hair is not drawn under the scalp
      return c;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(one) : one(mesh.material);
    mesh.castShadow = false;
  });
}

/** Shortest signed angle from `a` to `b`. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Heading (rotation about Y) that turns a model facing +Z towards `to` from `from`. */
export function headingTowards(from: THREE.Vector3, to: THREE.Vector3): number | undefined {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  return dx * dx + dz * dz < 1e-8 ? undefined : Math.atan2(dx, dz);
}

/** One party member on the field: plays its clips, walks paths between cells and turns to face things. */
export class FighterActor {
  readonly object: THREE.Object3D;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<FighterClip, THREE.AnimationAction>();
  private current: THREE.AnimationAction | undefined;
  private path: THREE.Vector3[] = [];
  /** Where the current path segment started and how far along it the model is (0..1). */
  private from = new THREE.Vector3();
  private along = 0;
  private heading = 0;
  private wantHeading: number | undefined;
  private timers: { at: number; run: () => void }[] = [];
  private clock = 0;
  private busy = false;
  dead = false;

  /** `height`: how tall to stand in render units (default: a person at world scale). */
  constructor(gltf: GLTF, height = PARTY_MODEL_HEIGHT * PARTY_SCALE) {
    this.object = cloneSkinned(gltf.scene);
    this.object.scale.setScalar(height / PARTY_MODEL_HEIGHT);
    applyModelAlpha(this.object);
    this.object.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.frustumCulled = false;
      }
    });
    this.mixer = new THREE.AnimationMixer(this.object);
    for (const clip of gltf.animations) this.actions.set(clip.name as FighterClip, this.mixer.clipAction(clip));
    this.mixer.addEventListener('finished', (e) => {
      if (this.dead || e.action !== this.current) return;
      this.busy = false;
      this.play(this.path.length ? 'walk' : 'idle');
    });
    this.play('idle');
  }

  get walking(): boolean {
    return this.path.length > 0;
  }

  /** Standing still with nothing to play: free to turn towards the enemy. */
  get idle(): boolean {
    return !this.busy && !this.walking && !this.dead && this.timers.length === 0;
  }

  private play(clip: FighterClip, once = false, fade = 0.2): void {
    const next = this.actions.get(clip);
    if (!next) return;
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    next.enabled = true;
    if (this.current && this.current !== next) next.crossFadeFrom(this.current, fade, false);
    next.play();
    this.current = next;
  }

  /** Play a one-shot clip (attack, cast...), then go back to idle. */
  act(clip: FighterClip, delay = 0): void {
    this.later(delay, () => {
      if (this.dead) return;
      this.busy = true;
      this.play(clip, true, 0.12);
    });
  }

  /** Fall and stay down. */
  die(delay = 0): void {
    if (this.dead) return;
    this.dead = true;
    this.later(delay, () => {
      this.path = [];
      this.play('death', true, 0.15);
    });
  }

  /** Walk through `points` (render space), one cell per SECONDS_PER_CELL. */
  walk(points: readonly THREE.Vector3[]): void {
    if (this.dead || points.length === 0) return;
    this.path = points.map((p) => p.clone());
    this.from.copy(this.object.position);
    this.along = 0;
    if (!this.busy) this.play('walk');
  }

  /** Stand on `p` straight away (the fight's opening positions, a spell moving someone). */
  place(p: THREE.Vector3): void {
    this.object.position.copy(p);
  }

  face(target: THREE.Vector3): void {
    const h = headingTowards(this.object.position, target);
    if (h !== undefined) this.wantHeading = h;
  }

  private later(seconds: number, run: () => void): void {
    if (seconds <= 0) run();
    else this.timers.push({ at: this.clock + seconds, run });
  }

  tick(dt: number): void {
    this.clock += dt;
    const due = this.timers.filter((t) => t.at <= this.clock);
    this.timers = this.timers.filter((t) => t.at > this.clock);
    for (const t of due) t.run();
    const next = this.path[0];
    if (next) {
      // Each path step is one cell, walked in SECONDS_PER_CELL.
      const h = headingTowards(this.from, next);
      if (h !== undefined) this.wantHeading = h;
      this.along = Math.min(1, this.along + dt / SECONDS_PER_CELL);
      this.object.position.lerpVectors(this.from, next, this.along);
      if (this.along >= 1) {
        this.path.shift();
        this.from.copy(next);
        this.along = 0;
        if (!this.path.length && !this.busy && !this.dead) this.play('idle');
      }
    }
    if (this.wantHeading !== undefined) {
      const d = angleDelta(this.heading, this.wantHeading);
      const turn = Math.sign(d) * Math.min(Math.abs(d), TURN_RATE * dt);
      this.heading += turn;
      if (Math.abs(d) < 1e-3) this.wantHeading = undefined;
      this.object.rotation.y = this.heading;
    }
    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.object.removeFromParent();
  }
}
