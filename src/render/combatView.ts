import * as THREE from 'three/webgpu';
import { toRGBA } from '../formats/bmx';
import { isDead } from '../combat/rules';
import { gridFor, currentFighter, isOver, HOSTILE_KINDS, type BattleState, type Fighter } from '../combat/battle';
import type { GridPos } from '../combat/grid';
import { cameraPlan, gridPointToWorld, worldToGridCell, type Point } from '../combat/layout';
import type { CombatSprite } from '../combat/sprites';
import { createBillboards } from './zoneScene';
import { creatureModelName, FighterActor, loadPartyModel, partyModelName } from './fighterModels';
import { FLIGHT, RELEASE, SpellFx, spellColor } from './spellFx';

const WORLD_SCALE = 100;
/** Lift of the grid overlay above the ground, in BaK units. */
const OVERLAY_LIFT = 6;
/** Gap left between neighbouring overlay cells, as a fraction of the cell. */
const CELL_INSET = 0.04;
/** Marker billboard size when no original sprite is available, in BaK units. */
const MARKER_SIZE = { width: 200, height: 320 };

type Rgba = readonly [number, number, number, number];
const COLORS = {
  idle: [1, 1, 1, 0.06],
  reachable: [0.25, 0.55, 1, 0.3],
  attackable: [1, 0.15, 0.1, 0.5],
  current: [1, 0.9, 0.2, 0.55],
  hover: [1, 1, 1, 0.4],
} as const satisfies Record<string, Rgba>;

export interface CombatViewOptions {
  /** Where the party stood when the fight began (BaK units) and its 8-bit heading. */
  party: Point;
  heading: number;
  cols: number;
  rows: number;
  getHeight: (x: number, y: number) => number;
  /** Original sprite and its palette for a monster index, when one could be loaded. */
  spriteFor: (monster: number) => CombatSprite | undefined;
  palette: Uint8Array;
  /** Use the animated 3D models (party and creatures) when they load (default true; tests and tools turn it off). */
  models?: boolean;
}

const toRender = (x: number, h: number, y: number): THREE.Vector3 =>
  new THREE.Vector3(x / WORLD_SCALE, h / WORLD_SCALE, -y / WORLD_SCALE);

/** Round coloured token with the first letter of the name, for fighters whose sprite is missing. */
function markerTexture(name: string, party: boolean): THREE.Texture {
  const w = 64;
  const h = 120;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  g.fillStyle = party ? '#2f6fdb' : '#c8352b';
  g.strokeStyle = '#101010';
  g.lineWidth = 4;
  g.beginPath();
  g.roundRect(8, 8, w - 16, h - 16, 24);
  g.fill();
  g.stroke();
  g.fillStyle = '#fff';
  g.font = 'bold 40px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name.slice(0, 1).toUpperCase(), w / 2, h / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function spriteTexture(sprite: CombatSprite, palette: Uint8Array): THREE.DataTexture {
  const { image } = sprite;
  const rgba = toRGBA(image, palette);
  const flipped = new Uint8ClampedArray(rgba.length);
  const row = image.width * 4;
  for (let y = 0; y < image.height; y++)
    flipped.set(rgba.subarray(y * row, (y + 1) * row), (image.height - 1 - y) * row);
  const tex = new THREE.DataTexture(flipped, image.width, image.height, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

interface FighterNode {
  fighter: Fighter;
  /** One-instance billboard; the instance translation is its anchor, which the billboard shader turns around. */
  mesh: THREE.InstancedMesh;
  /** The same figure drawn faintly through anything in front of it (a hill, a rock, a tree), tinted by side. */
  ghost: THREE.InstancedMesh;
  textures: THREE.Texture[];
  /** The animated 3D model, once loaded; the billboard stands in until then. */
  actor?: FighterActor;
}

/**
 * The 3D side of a fight: a coloured grid laid over the ground, one upright billboard per fighter and
 * a raised camera. Cells are coloured from the current battle state (reachable, attackable, whose
 * turn it is, hover). Ground heights come from the zone so the overlay follows the terrain.
 */
export class CombatView {
  readonly group = new THREE.Group();
  private readonly colors: Float32Array;
  private readonly colorAttr: THREE.BufferAttribute;
  private readonly nodes = new Map<string, FighterNode>();
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshBasicNodeMaterial;
  private readonly plan;
  /** Battle events already turned into animation. */
  private readonly seen = new WeakSet<object>();
  private disposed = false;
  /** Spell light: orbs, flares and rings. */
  private readonly fx = new SpellFx();

  constructor(
    private readonly o: CombatViewOptions,
    fighters: readonly Fighter[],
  ) {
    this.group.name = 'combat';
    const { cols, rows } = o;
    const positions = new Float32Array(cols * rows * 4 * 3);
    this.colors = new Float32Array(cols * rows * 4 * 4);
    const indices: number[] = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const cell = y * cols + x;
        const corners: [number, number][] = [
          [x + CELL_INSET, y + CELL_INSET],
          [x + 1 - CELL_INSET, y + CELL_INSET],
          [x + 1 - CELL_INSET, y + 1 - CELL_INSET],
          [x + CELL_INSET, y + 1 - CELL_INSET],
        ];
        corners.forEach(([gx, gy], k) => {
          const w = gridPointToWorld(o.party, o.heading, gx, gy);
          const v = toRender(w.x, o.getHeight(w.x, w.y) + OVERLAY_LIFT, w.y);
          positions.set([v.x, v.y, v.z], (cell * 4 + k) * 3);
        });
        const b = cell * 4;
        indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.colorAttr = new THREE.BufferAttribute(this.colors, 4);
    this.geometry.setAttribute('color', this.colorAttr);
    this.geometry.setIndex(indices);
    this.material = new THREE.MeshBasicNodeMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const overlay = new THREE.Mesh(this.geometry, this.material);
    overlay.frustumCulled = false;
    overlay.renderOrder = 2;
    this.group.add(overlay);

    this.group.add(this.fx.group);
    for (const f of fighters) this.addFighter(f);
    this.plan = cameraPlan(o.party, o.heading, cols, rows);
  }

  private addFighter(f: Fighter): void {
    const sprite = this.o.spriteFor(f.monster);
    const textures: THREE.Texture[] = [];
    const map = sprite ? spriteTexture(sprite, this.o.palette) : markerTexture(f.name, f.side === 'party');
    textures.push(map);
    const w = (sprite?.width ?? MARKER_SIZE.width) / WORLD_SCALE;
    const h = (sprite?.height ?? MARKER_SIZE.height) / WORLD_SCALE;
    const mesh = createBillboards(map, [0, 0, 0, w, h], `fighter-${f.id}`);
    mesh.frustumCulled = false;
    const ghost = createBillboards(map, [0, 0, 0, w, h], `fighter-${f.id}-ghost`);
    ghost.frustumCulled = false;
    const gm = ghost.material as THREE.MeshBasicNodeMaterial;
    gm.depthTest = false;
    gm.depthWrite = false;
    gm.transparent = true;
    gm.opacity = 0.45;
    gm.alphaTest = 0.2;
    gm.fog = false;
    gm.color.set(f.side === 'party' ? '#9cc4ff' : '#ff9a90');
    ghost.renderOrder = 5;
    this.group.add(mesh, ghost);
    const node: FighterNode = { fighter: f, mesh, ghost, textures };
    this.nodes.set(f.id, node);
    // Party members by name; monsters (and summoned allies such as a Rusalki) by monster index.
    const partyModel = f.side === 'party' ? partyModelName(f.name) : undefined;
    const model = this.o.models === false ? undefined : (partyModel ?? creatureModelName(f.monster));
    if (model)
      void loadPartyModel(model, partyModel ? '/models/party/' : '/models/creatures/').then((gltf) => {
        if (!gltf || this.disposed || this.nodes.get(f.id) !== node) return;
        // Combat draws everyone at the original sprites' scale: stand as tall as this character's combat sprite.
        const actor = new FighterActor(gltf, (sprite?.height ?? MARKER_SIZE.height) / WORLD_SCALE);
        actor.place(this.cellCentre(node.fighter.pos));
        node.actor = actor;
        mesh.visible = ghost.visible = false;
        this.faceFoes(node);
        if (isDead(node.fighter)) actor.die();
        this.group.add(actor.object);
      });
  }

  /** Turn a model towards the nearest standing enemy. */
  private faceFoes(node: FighterNode): void {
    const actor = node.actor;
    if (!actor?.idle) return;
    let best: THREE.Vector3 | undefined;
    let bestD = Infinity;
    for (const other of this.nodes.values()) {
      const f = other.fighter;
      if (f.side === node.fighter.side || isDead(f)) continue;
      const p = this.cellCentre(f.pos);
      const d = p.distanceToSquared(actor.object.position);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best) actor.face(best);
  }

  /** Turn the last action's events into animation: walks, swings, casts, flinches and falls. */
  private animate(state: BattleState): void {
    const actorOf = (id: string) => this.nodes.get(id)?.actor;
    const at = (id: string) => {
      const f = state.fighters.find((x) => x.id === id);
      return f && this.cellCentre(f.pos);
    };
    const struck = (id: string, killed: boolean, delay: number) => {
      const a = actorOf(id);
      if (!a) return;
      if (killed) a.die(delay);
      else a.act('hit', delay);
    };
    for (const e of state.events) {
      if (this.seen.has(e)) continue;
      this.seen.add(e);
      switch (e.type) {
        case 'move': {
          const a = actorOf(e.id);
          if (a) a.walk(e.path.filter((p) => p.x !== e.from.x || p.y !== e.from.y).map((p) => this.cellCentre(p)));
          break;
        }
        case 'attack':
        case 'shoot': {
          const a = actorOf(e.attacker);
          const target = at(e.target);
          if (a && target) a.face(target);
          // No crossbow clip in the animation kit (its "shoot" is a pistol): a shot plays the attack.
          a?.act('attack', a.walking ? 0.4 : 0);
          if (e.hit) struck(e.target, e.killed, 0.45);
          if (e.type === 'attack' && e.effect) {
            const p = actorOf(e.target)?.object.position ?? target;
            if (p) this.fx.hit(e.effect, p, 0.45);
          } else actorOf(e.target)?.act('block', 0.25);
          if (e.type === 'shoot' && e.stray) struck(e.stray.target, e.stray.killed, 0.5);
          break;
        }
        case 'assess': {
          const target = at(e.target);
          if (target) actorOf(e.id)?.face(target);
          break;
        }
        case 'cast': {
          const a = actorOf(e.caster);
          const target = at(e.target);
          if (a && target && e.target !== e.caster) a.face(target);
          a?.act('cast');
          const color = spellColor(e.kind, e.spell);
          const from = a?.object.position ?? at(e.caster);
          const to = (e.target === e.caster ? undefined : actorOf(e.target)?.object.position) ?? at(e.target);
          if (from) {
            this.fx.gather(from, color);
            if (HOSTILE_KINDS.includes(e.kind) && to && e.target !== e.caster) this.fx.bolt(from, to, color, !e.missed);
            else if (HOSTILE_KINDS.includes(e.kind)) this.fx.burst(from, color);
            else this.fx.aura(to ?? from, color);
            for (const o of e.also ?? []) {
              const p = actorOf(o.target)?.object.position ?? at(o.target);
              if (p) this.fx.burst(p, color);
            }
          }
          const hostile =
            state.fighters.find((x) => x.id === e.caster)?.side !== state.fighters.find((x) => x.id === e.target)?.side;
          if (hostile && (e.amount > 0 || e.killed)) struck(e.target, e.killed, RELEASE + FLIGHT);
          for (const o of e.also ?? []) if (o.amount > 0 || o.killed) struck(o.target, o.killed, 0.7);
          break;
        }
        case 'defend':
          actorOf(e.id)?.act('block');
          break;
        default:
          break;
      }
    }
  }

  /** Per frame: advance the models' animation and walking. */
  tick(dt: number): void {
    this.fx.tick(dt);
    for (const node of this.nodes.values()) node.actor?.tick(dt);
  }

  /** Ground-level render position of a grid cell's centre. */
  private cellCentre(p: GridPos): THREE.Vector3 {
    const w = gridPointToWorld(this.o.party, this.o.heading, p.x + 0.5, p.y + 0.5);
    return toRender(w.x, this.o.getHeight(w.x, w.y), w.y);
  }

  /** Redraw from the battle state: fighter positions and the colour of every cell. */
  update(state: BattleState, hover?: GridPos): void {
    this.animate(state);
    for (const f of state.fighters) {
      // Fighters a spell brought in mid-fight get their sprite on first sight.
      if (!this.nodes.has(f.id)) this.addFighter(f);
      const node = this.nodes.get(f.id);
      if (!node) continue;
      node.fighter = f;
      if (node.actor) {
        // Models stay where their walk takes them; anything else that moved them (a spell) places them.
        if (!node.actor.walking && node.actor.object.position.distanceTo(this.cellCentre(f.pos)) > 0.05)
          node.actor.place(this.cellCentre(f.pos));
        // Those who ran leave the field; the fallen stay on it, lying where they fell.
        node.actor.object.visible = !f.fled;
        if (isDead(f)) node.actor.die();
        else if (node.actor.dead) node.actor.revive();
        else this.faceFoes(node);
        continue;
      }
      // The billboard shader recovers its anchor from the instance translation, so move the instance, not the mesh.
      const at = this.cellCentre(f.pos);
      for (const m of [node.mesh, node.ghost]) {
        m.setMatrixAt(0, new THREE.Matrix4().makeTranslation(at.x, at.y, at.z));
        m.instanceMatrix.needsUpdate = true;
        // No corpse sprite yet: the fallen simply leave the field (as do those who ran).
        m.visible = !isDead(f) && !f.fled;
      }
    }
    const { cols, rows } = this.o;
    const over = isOver(state);
    const grid = over ? undefined : gridFor(state);
    const me = over ? undefined : currentFighter(state);
    const mine = me?.side === 'party';
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const cell = grid?.cells[i];
        let c: Rgba = COLORS.idle;
        if (me && x === me.pos.x && y === me.pos.y) c = COLORS.current;
        else if (cell && mine && cell.attackable) c = COLORS.attackable;
        else if (cell && mine && cell.reachable) c = COLORS.reachable;
        if (mine && hover && hover.x === x && hover.y === y) c = COLORS.hover;
        for (let k = 0; k < 4; k++) this.colors.set(c, (i * 4 + k) * 4);
      }
    }
    this.colorAttr.needsUpdate = true;
  }

  /** Put the camera above the grid, looking at its middle. */
  applyCamera(camera: THREE.PerspectiveCamera): void {
    const { eye, target, height } = this.plan;
    const ground = this.o.getHeight(eye.x, eye.y);
    camera.position.copy(toRender(eye.x, ground + height, eye.y));
    camera.lookAt(toRender(target.x, this.o.getHeight(target.x, target.y), target.y));
  }

  /** The grid cell under a pointer given in normalised device coordinates (-1..1). */
  pick(camera: THREE.PerspectiveCamera, ndcX: number, ndcY: number): GridPos | undefined {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    const { origin, direction } = ray.ray;
    if (direction.y >= -1e-6) return undefined;
    // Intersect the ground plane at the grid's average height, then once more at the height found there.
    let planeY = this.cellCentre({ x: this.o.cols >> 1, y: this.o.rows >> 1 }).y;
    let hit: Point | undefined;
    for (let pass = 0; pass < 3; pass++) {
      const t = (planeY - origin.y) / direction.y;
      hit = { x: (origin.x + direction.x * t) * WORLD_SCALE, y: -(origin.z + direction.z * t) * WORLD_SCALE };
      planeY = this.o.getHeight(hit.x, hit.y) / WORLD_SCALE;
    }
    return hit && worldToGridCell(this.o.party, this.o.heading, hit, this.o.cols, this.o.rows);
  }

  dispose(): void {
    this.disposed = true;
    this.fx.dispose();
    for (const node of this.nodes.values()) node.actor?.dispose();
    this.group.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    for (const node of this.nodes.values()) {
      for (const m of [node.mesh, node.ghost]) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
      for (const t of node.textures) t.dispose();
    }
    this.nodes.clear();
  }
}
