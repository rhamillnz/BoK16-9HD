import * as THREE from 'three/webgpu';
import { toRGBA } from '../formats/bmx';
import { isDead } from '../combat/rules';
import { gridFor, currentFighter, isOver, type BattleState, type Fighter } from '../combat/battle';
import type { GridPos } from '../combat/grid';
import { cameraPlan, gridPointToWorld, worldToGridCell, type Point } from '../combat/layout';
import type { CombatSprite } from '../combat/sprites';
import { createBillboards } from './zoneScene';

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
  textures: THREE.Texture[];
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
    this.group.add(mesh);
    this.nodes.set(f.id, { fighter: f, mesh, textures });
  }

  /** Ground-level render position of a grid cell's centre. */
  private cellCentre(p: GridPos): THREE.Vector3 {
    const w = gridPointToWorld(this.o.party, this.o.heading, p.x + 0.5, p.y + 0.5);
    return toRender(w.x, this.o.getHeight(w.x, w.y), w.y);
  }

  /** Redraw from the battle state: fighter positions and the colour of every cell. */
  update(state: BattleState, hover?: GridPos): void {
    for (const f of state.fighters) {
      const node = this.nodes.get(f.id);
      if (!node) continue;
      // The billboard shader recovers its anchor from the instance translation, so move the instance, not the mesh.
      const at = this.cellCentre(f.pos);
      node.mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(at.x, at.y, at.z));
      node.mesh.instanceMatrix.needsUpdate = true;
      // No corpse sprite yet: the fallen simply leave the field.
      node.mesh.visible = !isDead(f);
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
    this.group.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    for (const node of this.nodes.values()) {
      node.mesh.geometry.dispose();
      (node.mesh.material as THREE.Material).dispose();
      for (const t of node.textures) t.dispose();
    }
    this.nodes.clear();
  }
}
