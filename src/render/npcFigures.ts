import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { npcPlacement, npcVariant, type ClothingColors, type NpcVariant } from '../game/npcLook';
import type { EncounterRunner } from '../game/encounterRunner';
import type { PlacedEncounter } from '../world/encounters';
import { WORLD_SCALE } from './zoneScene';

/**
 * Standing figures for the NPCs of dialogue encounters, so there is someone to look at when they talk.
 * A figure appears while its encounter can still fire and stays while the party is near after it
 * fired (the dialogue is open), then goes. Models: public/models/npc/npc_<variant>.glb, built by
 * tools/blender/build_bodies.py from art/jobs/npcs.json; the clothing parts are materials named
 * `tint_*` that are multiplied with colours taken from the actor's portrait.
 */

/** Figures further away than this (BaK units) are hidden. */
export const NPC_SHOW_DISTANCE = 22000;
/** A figure whose encounter has fired stays while the party is this close (BaK units). */
export const NPC_LINGER_DISTANCE = 4000;

interface Figure {
  encounter: PlacedEncounter;
  object: THREE.Object3D;
  /** The encounter fired and the party is still near: keep the figure until it walks away. */
  lingering: boolean;
  gone: boolean;
}

const PRIMARY_PARTS = new Set(['tint_body', 'tint_arms', 'tint_head_hood']);

export class NpcFigures {
  readonly group = new THREE.Group();
  private readonly models = new Map<NpcVariant, Promise<THREE.Object3D | undefined>>();
  private runner: EncounterRunner | undefined;
  private figures: Figure[] = [];
  private generation = 0;

  constructor(
    scene: THREE.Scene,
    private readonly colors: (actor: number) => ClothingColors | undefined,
    private readonly baseUrl = '/models/npc/',
  ) {
    this.group.name = 'npcFigures';
    scene.add(this.group);
  }

  /** Number of figures currently drawn. */
  get visibleCount(): number {
    return this.figures.filter((f) => f.object.visible).length;
  }

  private model(variant: NpcVariant): Promise<THREE.Object3D | undefined> {
    let p = this.models.get(variant);
    if (!p) {
      p = new GLTFLoader()
        .loadAsync(`${this.baseUrl}npc_${variant}.glb`)
        .then((g) => g.scene)
        .catch((err) => {
          console.warn(`NPC model ${variant} failed:`, err);
          return undefined;
        });
      this.models.set(variant, p);
    }
    return p;
  }

  private clear(): void {
    this.generation++;
    for (const f of this.figures) {
      f.object.traverse((o) => {
        const mat = (o as THREE.Mesh).material;
        for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) m.dispose();
      });
      this.group.remove(f.object);
    }
    this.figures = [];
  }

  private async build(runner: EncounterRunner, getHeight: (x: number, y: number) => number): Promise<void> {
    const gen = this.generation;
    for (const npc of runner.npcEncounters()) {
      const template = await this.model(npcVariant(npc.name));
      if (!template || gen !== this.generation) return;
      const object = template.clone(true);
      const palette = this.colors(npc.actor);
      object.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        const tint = (m: THREE.Material): THREE.Material => {
          const rgb = PRIMARY_PARTS.has(m.name)
            ? palette?.primary
            : m.name === 'tint_legs'
              ? palette?.secondary
              : undefined;
          if (!rgb) return m;
          const copy = m.clone() as THREE.MeshStandardMaterial;
          copy.color.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
          return copy;
        };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(tint) : tint(mesh.material);
      });
      const at = npcPlacement(npc.encounter);
      object.position.set(at.x / WORLD_SCALE, getHeight(at.x, at.y) / WORLD_SCALE, -at.y / WORLD_SCALE);
      object.visible = false;
      this.group.add(object);
      this.figures.push({ encounter: npc.encounter, object, lingering: false, gone: false });
    }
  }

  /** Call every frame with the zone's encounter runner (a new one means a new zone or chapter). */
  update(runner: EncounterRunner, getHeight: (x: number, y: number) => number, partyX: number, partyY: number): void {
    if (runner !== this.runner) {
      this.runner = runner;
      this.clear();
      void this.build(runner, getHeight);
    }
    for (const f of this.figures) {
      if (f.gone) continue;
      const at = npcPlacement(f.encounter);
      const dx = partyX - at.x;
      const dy = partyY - at.y;
      const dist = Math.hypot(dx, dy);
      const pending = runner.isPending(f.encounter);
      if (!pending && f.object.visible) f.lingering = true;
      if (f.lingering && dist > NPC_LINGER_DISTANCE) {
        f.gone = true;
        f.object.visible = false;
        continue;
      }
      f.object.visible = (pending || f.lingering) && dist < NPC_SHOW_DISTANCE;
      // The models face +Z (south); turn towards the party, in render space z = -y.
      if (f.object.visible) f.object.rotation.y = Math.atan2(dx, -dy);
    }
  }
}
