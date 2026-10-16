import * as THREE from 'three/webgpu';
import type { CastKind } from '../combat/battle';

/**
 * What a spell looks like in a fight: a glowing orb that leaves the caster's hands and flies to a hostile
 * target, bursting there; a ring of light rising round whoever a friendly spell touches. Colours follow the
 * spell's kind (fire spells by name). Times are seconds after the cast event, matched to the cast clip's
 * release and the target's flinch.
 */

/** When the orb leaves the hands, and how long it flies. */
export const RELEASE = 0.35;
export const FLIGHT = 0.35;
/** Height of the hands and of a target's chest above the ground, render units. */
const HAND_HEIGHT = 0.9;
const CHEST_HEIGHT = 0.8;

const KIND_COLORS: Record<CastKind, number> = {
  damage: 0x9a6bff,
  heal: 0x5dff7a,
  hold: 0x9fd8ff,
  ward: 0xffd45a,
  drain: 0xb0204a,
  push: 0xf2f2ff,
  pull: 0xf2f2ff,
  silence: 0x8a7ab8,
  banish: 0xfff2c0,
  mirror: 0xd8e4ff,
  summon: 0x4fe0d0,
};

/** The colour of a spell's light. */
export function spellColor(kind: CastKind, name: string): number {
  if (kind === 'damage' && /flame|fire|dragon|brimstone|skyfire/i.test(name)) return 0xff7a24;
  return KIND_COLORS[kind] ?? 0xffffff;
}

interface Effect {
  object: THREE.Object3D;
  material: THREE.MeshBasicNodeMaterial;
  /** Seconds since spawn (negative while waiting for its delay). */
  t: number;
  duration: number;
  update(e: Effect, k: number): void;
}

function glowMaterial(color: number): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial({ color, transparent: true, depthWrite: false });
  m.blending = THREE.AdditiveBlending;
  m.toneMapped = false;
  return m;
}

export class SpellFx {
  readonly group = new THREE.Group();
  private effects: Effect[] = [];
  private readonly sphere = new THREE.SphereGeometry(0.14, 16, 12);
  private readonly ring = new THREE.TorusGeometry(0.45, 0.03, 8, 40);

  constructor() {
    this.group.name = 'spellFx';
  }

  /** Effects still playing. */
  get active(): number {
    return this.effects.length;
  }

  private add(
    object: THREE.Object3D,
    material: THREE.MeshBasicNodeMaterial,
    delay: number,
    duration: number,
    update: Effect['update'],
  ): void {
    object.visible = false;
    this.group.add(object);
    this.effects.push({ object, material, t: -delay, duration, update });
  }

  /** An orb from the caster's hands to the target; `burst` flares where it lands (false for a miss). */
  bolt(from: THREE.Vector3, to: THREE.Vector3, color: number, burst = true): void {
    const a = from.clone().add(new THREE.Vector3(0, HAND_HEIGHT, 0));
    const b = to.clone().add(new THREE.Vector3(0, CHEST_HEIGHT, 0));
    const mat = glowMaterial(color);
    const orb = new THREE.Mesh(this.sphere, mat);
    this.add(orb, mat, RELEASE, FLIGHT, (e, k) => {
      e.object.position.lerpVectors(a, b, k);
      // A low arc, and a pulse as it flies.
      e.object.position.y += Math.sin(k * Math.PI) * 0.25;
      e.object.scale.setScalar(1 + 0.3 * Math.sin(k * Math.PI * 6));
      // A miss fades as it goes.
      mat.opacity = burst ? 1 : 1 - k;
    });
    if (burst) this.burst(to, color, RELEASE + FLIGHT);
  }

  /** A flare of light at a fighter. */
  burst(at: THREE.Vector3, color: number, delay = RELEASE + FLIGHT): void {
    const p = at.clone().add(new THREE.Vector3(0, CHEST_HEIGHT, 0));
    const mat = glowMaterial(color);
    const flare = new THREE.Mesh(this.sphere, mat);
    flare.position.copy(p);
    this.add(flare, mat, delay, 0.35, (e, k) => {
      e.object.scale.setScalar(1 + 4 * k);
      mat.opacity = 1 - k;
    });
  }

  /** A ring of light rising round a fighter (a friendly spell). */
  aura(at: THREE.Vector3, color: number, delay = RELEASE): void {
    const mat = glowMaterial(color);
    const ring = new THREE.Mesh(this.ring, mat);
    ring.rotation.x = -Math.PI / 2;
    this.add(ring, mat, delay, 0.8, (e, k) => {
      e.object.position.set(at.x, at.y + 0.1 + 1.3 * k, at.z);
      e.object.scale.setScalar(1 - 0.4 * k);
      mat.opacity = Math.sin(k * Math.PI);
    });
  }

  /** Light gathering at the caster's hands while the spell is spoken. */
  gather(at: THREE.Vector3, color: number): void {
    const p = at.clone().add(new THREE.Vector3(0, HAND_HEIGHT, 0));
    const mat = glowMaterial(color);
    const glow = new THREE.Mesh(this.sphere, mat);
    glow.position.copy(p);
    this.add(glow, mat, 0, RELEASE, (e, k) => {
      e.object.scale.setScalar(0.3 + 0.9 * k);
      mat.opacity = 0.4 + 0.6 * k;
    });
  }

  tick(dt: number): void {
    for (const e of this.effects) {
      e.t += dt;
      if (e.t < 0) continue;
      const k = Math.min(1, e.t / e.duration);
      e.object.visible = true;
      e.update(e, k);
    }
    const done = this.effects.filter((e) => e.t >= e.duration);
    if (done.length === 0) return;
    for (const e of done) {
      this.group.remove(e.object);
      e.material.dispose();
    }
    this.effects = this.effects.filter((e) => e.t < e.duration);
  }

  dispose(): void {
    for (const e of this.effects) e.material.dispose();
    this.effects = [];
    this.group.clear();
    this.sphere.dispose();
    this.ring.dispose();
  }
}
