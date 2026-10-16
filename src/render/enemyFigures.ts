import * as THREE from 'three/webgpu';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { CombatDef } from '../combat/combatData';
import { TILE_SIZE } from '../formats/world';
import type { PlacedEncounter } from '../world/encounters';
import { headingToVector } from '../world/partyController';
import { applyModelAlpha, creatureModelName, loadPartyModel, PARTY_SCALE } from './fighterModels';
import { WORLD_SCALE } from './zoneScene';

/**
 * The enemies of a combat encounter standing in the world before the fight, where DEF_COMB.DAT places them
 * (tile-relative, with a heading and a movement type): sentries idle, the others pace back and forth along
 * their heading, and when the party comes near they turn and walk towards it. Ambushes stay hidden until they
 * spring. Every figure hides while a fight is on, and an encounter's figures go once it can no longer fire.
 * Models: the combat creature models (public/models/creatures/), at their true size.
 */

/** Figures further away than this (BaK units) are hidden. */
export const ENEMY_SHOW_DISTANCE = 22000;
/** The party is this close (BaK units, to the figure): it turns and comes for them. */
export const ENEMY_APPROACH_DISTANCE = 6000;
/** An approaching enemy stops this far from the party (the fight starts when the party reaches its area). */
export const ENEMY_STOP_DISTANCE = 900;
/** Walking speeds, BaK units per second; the walk clip's own pace is about WALK_CLIP_SPEED. */
export const PATROL_SPEED = 120;
export const APPROACH_SPEED = 170;
const WALK_CLIP_SPEED = 110;
/** How far a patrolling enemy paces either side of its post. */
export const PATROL_REACH = 1600;

/** Where a combatant stands in the world: its tile's corner plus its tile-relative position. */
export function spawnPoint(
  encounter: Pick<PlacedEncounter, 'tileX' | 'tileY'>,
  position: CombatDef['combatants'][number]['position'],
): { x: number; y: number; heading: number } {
  return {
    x: encounter.tileX * TILE_SIZE + position.x,
    y: encounter.tileY * TILE_SIZE + position.y,
    heading: position.heading,
  };
}

/** Render-space rotation (models face +Z) for facing along the BaK direction (dx, dy). */
export const facingAngle = (dx: number, dy: number): number => Math.atan2(dx, -dy);

/** A patrolling enemy's offset along its line at time t: back and forth over ±PATROL_REACH. */
export function patrolOffset(t: number): { along: number; direction: 1 | -1 } {
  const period = (4 * PATROL_REACH) / PATROL_SPEED;
  const k = (((t % period) + period) % period) / period;
  // Triangle wave: out to +reach, back through 0 to -reach, and home.
  const along = k < 0.25 ? k * 4 : k < 0.75 ? 2 - k * 4 : k * 4 - 4;
  const direction = k < 0.25 || k >= 0.75 ? 1 : -1;
  return { along: along * PATROL_REACH, direction };
}

interface Figure {
  encounter: PlacedEncounter;
  object: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  idle?: THREE.AnimationAction;
  walk?: THREE.AnimationAction;
  post: { x: number; y: number; heading: number };
  patrols: boolean;
  x: number;
  y: number;
  /** Seconds into its patrol (desynchronised per figure). */
  t: number;
  walking: boolean;
}

export class EnemyFigures {
  readonly group = new THREE.Group();
  private runner: unknown;
  private figures: Figure[] = [];
  private generation = 0;
  private lastTime: number | undefined;

  constructor(
    scene: THREE.Scene,
    private readonly defFor: (encounter: PlacedEncounter) => CombatDef | undefined,
    private readonly baseUrl = '/models/creatures/',
  ) {
    this.group.name = 'enemyFigures';
    scene.add(this.group);
  }

  /** Number of figures currently drawn. */
  get visibleCount(): number {
    return this.figures.filter((f) => f.object.visible).length;
  }

  private clear(): void {
    this.generation++;
    for (const f of this.figures) {
      f.mixer.stopAllAction();
      this.group.remove(f.object);
    }
    this.figures = [];
  }

  private async build(
    encounters: readonly PlacedEncounter[],
    getHeight: (x: number, y: number) => number,
  ): Promise<void> {
    const gen = this.generation;
    for (const encounter of encounters) {
      const def = this.defFor(encounter);
      if (!def || def.ambush) continue;
      for (const [i, c] of def.combatants.entries()) {
        const name = creatureModelName(c.monster);
        if (!name) continue;
        const gltf = await loadPartyModel(name, this.baseUrl);
        if (gen !== this.generation) return;
        if (!gltf) continue;
        const object = cloneSkinned(gltf.scene);
        applyModelAlpha(object);
        object.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) {
            o.castShadow = true;
            o.frustumCulled = false;
          }
        });
        object.scale.setScalar(PARTY_SCALE);
        object.visible = false;
        const mixer = new THREE.AnimationMixer(object);
        const clip = (n: string) => gltf.animations.find((a) => a.name === n);
        const idleClip = clip('idle');
        const walkClip = clip('walk');
        const idle = idleClip && mixer.clipAction(idleClip);
        const walk = walkClip && mixer.clipAction(walkClip);
        idle?.play();
        mixer.update((i * 0.53) % 1);
        const post = spawnPoint(encounter, c.position);
        object.position.set(post.x / WORLD_SCALE, getHeight(post.x, post.y) / WORLD_SCALE, -post.y / WORLD_SCALE);
        const v = headingToVector(post.heading);
        object.rotation.y = facingAngle(v.x, v.y);
        this.group.add(object);
        this.figures.push({
          encounter,
          object,
          mixer,
          idle,
          walk,
          post,
          patrols: c.movementType !== 0,
          x: post.x,
          y: post.y,
          t: i * 7.3,
          walking: false,
        });
      }
    }
  }

  private setWalking(f: Figure, on: boolean, speed: number): void {
    if (f.walk) f.walk.timeScale = speed / WALK_CLIP_SPEED;
    if (on === f.walking) return;
    f.walking = on;
    const from = on ? f.idle : f.walk;
    const to = on ? f.walk : f.idle;
    if (!to) return;
    to.reset().play();
    if (from) to.crossFadeFrom(from, 0.25, false);
  }

  /**
   * Call every frame with the zone's encounter runner (a new one means a new zone or chapter), its combat
   * encounters and whether they can still fire, and whether a fight is on.
   */
  update(
    runner: unknown,
    encounters: () => readonly PlacedEncounter[],
    isPending: (e: PlacedEncounter) => boolean,
    getHeight: (x: number, y: number) => number,
    partyX: number,
    partyY: number,
    fighting: boolean,
  ): void {
    if (runner !== this.runner) {
      this.runner = runner;
      this.clear();
      void this.build(encounters(), getHeight);
    }
    const now = performance.now() / 1000;
    const dt = this.lastTime === undefined ? 0 : Math.min(0.1, now - this.lastTime);
    this.lastTime = now;
    const pending = new Map<PlacedEncounter, boolean>();
    for (const f of this.figures) {
      let live = pending.get(f.encounter);
      if (live === undefined) pending.set(f.encounter, (live = isPending(f.encounter)));
      const dist = Math.hypot(partyX - f.x, partyY - f.y);
      f.object.visible = live && !fighting && dist < ENEMY_SHOW_DISTANCE;
      if (!f.object.visible) continue;
      if (dist < ENEMY_APPROACH_DISTANCE) {
        // Seen: come for the party.
        const go = dist > ENEMY_STOP_DISTANCE;
        if (go) {
          const step = Math.min(APPROACH_SPEED * dt, dist - ENEMY_STOP_DISTANCE);
          f.x += ((partyX - f.x) / dist) * step;
          f.y += ((partyY - f.y) / dist) * step;
        }
        f.object.rotation.y = facingAngle(partyX - f.x, partyY - f.y);
        this.setWalking(f, go, APPROACH_SPEED);
      } else if (f.patrols) {
        f.t += dt;
        const p = patrolOffset(f.t);
        const v = headingToVector(f.post.heading);
        f.x = f.post.x + v.x * p.along;
        f.y = f.post.y + v.y * p.along;
        f.object.rotation.y = facingAngle(v.x * p.direction, v.y * p.direction);
        this.setWalking(f, true, PATROL_SPEED);
      } else {
        this.setWalking(f, false, 0);
      }
      f.object.position.set(f.x / WORLD_SCALE, getHeight(f.x, f.y) / WORLD_SCALE, -f.y / WORLD_SCALE);
      f.mixer.update(dt);
    }
  }
}
