import * as THREE from 'three/webgpu';
import { Fn, attribute, cameraPosition, cross, float, instancedBufferAttribute, normalize, positionLocal, vec3 } from 'three/tsl';
import { toRGBA, type IndexedImage } from '../formats/bmx';
import { Terrain } from '../formats/scx';
import { EF_2D_OBJECT, type Face, type Model } from '../formats/tbl';
import { angleToRadians } from '../formats/world';
import { buildCollisionPolygons, type CollisionPolygon } from '../world/collision';
import type { ZoneData } from '../world/zone';

/**
 * Builds a three.js scene graph for an outdoor zone from the original data.
 * Static meshes are baked into world space and merged per material, so the whole
 * zone renders in a handful of draw calls. Trees and other billboards are instanced upright billboards (one draw call per sprite texture).
 *
 * Coordinates: BaK (x east, y north, z up) -> render (x/100, z/100, -y/100).
 */

export const WORLD_SCALE = 100;
/** BaK units covered by one repeat of a terrain texture. */
const TERRAIN_TEXTURE_SPAN = 800;
/** Small lifts (BaK units) so coplanar terrain decals (roads, rivers, fields) draw above the ground. */
const DECAL_LIFT = { ground: 0, field: 3, road: 6 } as const;
/** Original VGA pixels were 1.2x taller than wide. */
const VGA_PIXEL_STRETCH = 1.2;

const MAT_TEXTURE = new Set([0x90, 0x91, 0xd1, 0x11]);
const MAT_TERRAIN = 0xc1;

type FaceMaterial =
  | { kind: 'color'; index: number }
  | { kind: 'terrain'; strip: number }
  | { kind: 'slot'; image: number };

/** Mirrors the original engine's per-model rules for which faces use terrain/slot textures. */
export function classifyFace(model: Model, face: Face): FaceMaterial {
  const n = model.name;
  const c = face.color;
  const color = { kind: 'color', index: c } as const;
  const terrain = (strip: number) => ({ kind: 'terrain', strip }) as const;
  if (n.startsWith('t0')) return c === 1 ? terrain(Terrain.Road) : c === 2 ? terrain(Terrain.Path) : c === 3 ? terrain(Terrain.River) : color;
  if (n.startsWith('r0')) return c === 3 ? terrain(Terrain.River) : c === 5 ? terrain(Terrain.Bank) : color;
  if (n.startsWith('g0')) return c === 0 ? terrain(Terrain.Ground) : c === 5 ? terrain(Terrain.River) : color;
  if (n.startsWith('field')) return c === 2 ? terrain(Terrain.Bank) : terrain(Terrain.Dirt);
  if (n.startsWith('fall') || n.startsWith('spring')) {
    return c === 3 ? terrain(Terrain.River) : c === 5 ? terrain(Terrain.Bank) : c === 6 ? terrain(Terrain.Waterfall) : color;
  }
  if (face.material === MAT_TERRAIN) return terrain(Math.min(7, c));
  if (MAT_TEXTURE.has(face.material)) return { kind: 'slot', image: c };
  return color;
}

function decalLift(model: Model): number {
  const n = model.name;
  if (n === 'ground' || n.startsWith('g0')) return DECAL_LIFT.ground;
  if (n.startsWith('field')) return DECAL_LIFT.field;
  if (n.startsWith('t0') || n.startsWith('r0') || n.startsWith('fall') || n.startsWith('spring')) return DECAL_LIFT.road;
  return 0;
}

/** Accumulates non-indexed triangles for one material. */
class Batch {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  uvs: number[] = [];

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    if (this.colors.length) g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    if (this.uvs.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.computeBoundingSphere();
    return g;
  }
}

function imageTexture(img: IndexedImage, palette: Uint8Array, repeat: boolean): THREE.DataTexture {
  // Original images are stored top row first; texture data starts at the bottom (v = 0).
  const rgba = toRGBA(img, palette);
  const flipped = new Uint8ClampedArray(rgba.length);
  const row = img.width * 4;
  for (let y = 0; y < img.height; y++) flipped.set(rgba.subarray(y * row, (y + 1) * row), (img.height - 1 - y) * row);
  const tex = new THREE.DataTexture(flipped, img.width, img.height, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.flipY = false;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/**
 * The original terrain strips are shaded top-to-bottom (a fake distance gradient), so they
 * don't tile. Build a seamless 64x64 texture by sampling pixels from the strip's middle rows,
 * which keeps the original palette and grain.
 */
function tileableTerrain(strip: IndexedImage, seed: number): IndexedImage {
  const size = 64;
  const y0 = Math.floor(strip.height * 0.3);
  const y1 = Math.max(y0 + 1, Math.ceil(strip.height * 0.7));
  const pool: number[] = [];
  for (let y = y0; y < y1; y++) for (let x = 0; x < strip.width; x++) pool.push(strip.pixels[y * strip.width + x]!);
  let s = seed * 9301 + 49297;
  const rand = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const pixels = new Uint8Array(size * size);
  for (let i = 0; i < pixels.length; i++) pixels[i] = pool[Math.floor(rand() * pool.length)] ?? 0;
  return { width: size, height: size, pixels };
}

let billboardQuad: THREE.PlaneGeometry | undefined;

/**
 * One InstancedMesh for all billboards sharing a texture. `data` holds 5 floats per instance
 * (render-space x, y, z of the bottom centre, then width and height). Each quad turns around
 * the Y axis to face the camera, so trees stay upright. Unlit, alpha-tested and fogged like
 * the THREE.Sprite it replaces.
 */
export function createBillboards(map: THREE.Texture, data: number[], name: string): THREE.InstancedMesh {
  const count = data.length / 5;
  if (!billboardQuad) {
    // Bottom-centre anchored unit quad.
    billboardQuad = new THREE.PlaneGeometry(1, 1);
    billboardQuad.translate(0, 0.5, 0);
  }
  const size = new Float32Array(count * 2);
  const geometry = billboardQuad.clone();
  const material = new THREE.MeshBasicNodeMaterial({ map, alphaTest: 0.5, fog: true, side: THREE.DoubleSide });
  // The instance matrix (translation only) is applied to positionLocal before positionNode runs,
  // so subtracting the quad's own vertex recovers the instance's anchor point.
  const sizeAttr = new THREE.InstancedBufferAttribute(size, 2);
  const quad = attribute<'vec3'>('position', 'vec3');
  material.positionNode = Fn(() => {
    const anchor = positionLocal.sub(quad);
    const wh = instancedBufferAttribute<'vec2'>(sizeAttr, 'vec2');
    const toCamera = vec3(cameraPosition.x.sub(anchor.x), float(0), cameraPosition.z.sub(anchor.z));
    const right = normalize(cross(vec3(0, 1, 0), toCamera));
    return anchor.add(right.mul(quad.x.mul(wh.x))).add(vec3(0, 1, 0).mul(quad.y.mul(wh.y)));
  })();

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = name;
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    m.makeTranslation(data[i * 5]!, data[i * 5 + 1]!, data[i * 5 + 2]!);
    mesh.setMatrixAt(i, m);
    size[i * 2] = data[i * 5 + 3]!;
    size[i * 2 + 1] = data[i * 5 + 4]!;
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  // The shader moves vertices, so the bounding sphere must cover the quads, not just the anchors.
  const bs = mesh.boundingSphere!;
  const maxExtent = size.reduce((a, v) => Math.max(a, v), 0);
  bs.radius += maxExtent;
  return mesh;
}

export interface ZoneScene {
  group: THREE.Group;
  collision: CollisionPolygon[];
  stats: { items: number; meshItems: number; sprites: number; triangles: number; drawCalls: number };
}

export function buildZoneScene(zone: ZoneData): ZoneScene {
  const { palette, table, items, slotImages } = zone;
  const group = new THREE.Group();
  group.name = `zone${zone.zone}`;

  const colorBatch = new Batch();
  const terrainBatches = new Map<number, Batch>();
  const slotBatches = new Map<number, Batch>();
  const batchFor = (m: FaceMaterial): Batch => {
    if (m.kind === 'color') return colorBatch;
    const map = m.kind === 'terrain' ? terrainBatches : slotBatches;
    const key = m.kind === 'terrain' ? m.strip : m.image;
    let b = map.get(key);
    if (!b) map.set(key, (b = new Batch()));
    return b;
  };

  const billboards = new Map<number, number[]>();

  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  let meshItems = 0;
  let sprites = 0;

  for (const item of items) {
    const model = table.models[item.type];
    if (!model) continue;

    if (model.sprite) {
      const img = slotImages[model.sprite.index];
      if (!img) continue;
      const sf = model.sprite.scale === 0 ? 256 : model.sprite.scale;
      const major = ((2 * model.radius * sf) / 256) * model.scale;
      const maxDim = Math.max(img.width, img.height);
      let list = billboards.get(model.sprite.index);
      if (!list) billboards.set(model.sprite.index, (list = []));
      list.push(
        item.x / WORLD_SCALE,
        item.z / WORLD_SCALE,
        -item.y / WORLD_SCALE,
        ((img.width / maxDim) * major) / WORLD_SCALE,
        ((img.height / maxDim) * major * VGA_PIXEL_STRETCH) / WORLD_SCALE,
      );
      sprites++;
      continue;
    }
    if (model.faces.length === 0) continue;
    meshItems++;

    const yaw = angleToRadians(item.zRot);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const lift = decalLift(model);
    const v = model.vertices;
    const world = (i: number, out: THREE.Vector3) => {
      const vx = v[i * 3]!;
      const vy = v[i * 3 + 1]!;
      const vz = v[i * 3 + 2]!;
      const wx = item.x + vx * cos - vy * sin;
      const wy = item.y + vx * sin + vy * cos;
      const wz = item.z + vz + lift;
      return out.set(wx / WORLD_SCALE, wz / WORLD_SCALE, -wy / WORLD_SCALE);
    };

    for (const face of model.faces) {
      if (face.indices.length < 3) continue;
      const mat = classifyFace(model, face);
      const batch = batchFor(mat);
      const loop = face.indices.map((i) => world(i, new THREE.Vector3()));
      n.subVectors(loop[1]!, loop[0]!).cross(c.subVectors(loop[2]!, loop[0]!)).normalize();
      const rgb = mat.kind === 'color' ? new THREE.Color().setRGB(palette[face.color * 4]! / 255, palette[face.color * 4 + 1]! / 255, palette[face.color * 4 + 2]! / 255, THREE.SRGBColorSpace) : null;
      // Slot textures stretch over the face's first four corners, as in the original.
      const corner = [[0, 0], [1, 0], [1, 1], [0, 1]] as const;
      for (let k = 1; k + 1 < loop.length; k++) {
        for (const idx of [0, k, k + 1]) {
          const p = loop[idx]!;
          batch.positions.push(p.x, p.y, p.z);
          batch.normals.push(n.x, n.y, n.z);
          if (rgb) batch.colors.push(rgb.r, rgb.g, rgb.b);
          if (mat.kind === 'terrain') {
            const span = TERRAIN_TEXTURE_SPAN / WORLD_SCALE;
            batch.uvs.push(p.x / span, p.z / span);
          } else if (mat.kind === 'slot') {
            const uv = corner[Math.min(idx, 3)]!;
            batch.uvs.push(uv[0], uv[1]);
          }
        }
      }
    }
  }

  let triangles = 0;
  let drawCalls = 0;
  const addMesh = (batch: Batch, material: THREE.Material, name: string) => {
    if (!batch.positions.length) return;
    const mesh = new THREE.Mesh(batch.geometry(), material);
    mesh.name = name;
    mesh.receiveShadow = true;
    mesh.castShadow = name !== 'terrain';
    group.add(mesh);
    triangles += batch.positions.length / 9;
    drawCalls++;
  };

  addMesh(colorBatch, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, side: THREE.DoubleSide }), 'flat');
  for (const [strip, batch] of terrainBatches) {
    const src = zone.terrain[strip];
    if (!src) continue;
    const map = imageTexture(tileableTerrain(src, strip + 1), palette, true);
    addMesh(batch, new THREE.MeshStandardMaterial({ map, roughness: 1, side: THREE.DoubleSide }), `terrain${strip}`);
  }
  for (const [image, batch] of slotBatches) {
    const src = slotImages[image];
    const map = src ? imageTexture(src, palette, false) : null;
    addMesh(batch, new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, roughness: 0.9, side: THREE.DoubleSide }), `slot${image}`);
  }
  for (const [index, data] of billboards) {
    const img = slotImages[index]!;
    group.add(createBillboards(imageTexture(img, palette, false), data, `sprite${index}`));
    drawCalls++;
  }

  // Terrain pieces (entity flags without EF_2D_OBJECT) are floor, not obstacles.
  const clips = table.clips.map((clip, i) => (table.models[i] && table.models[i]!.flags & EF_2D_OBJECT ? clip : undefined));
  const scales = table.models.map((m) => m?.scale ?? 1);
  const collision = buildCollisionPolygons(items, clips, {}, scales);

  return { group, collision, stats: { items: items.length, meshItems, sprites, triangles, drawCalls } };
}

/**
 * Terrain triangles (models without EF_2D_OBJECT) in placed world space, BaK coordinates,
 * as a flat array of 9 numbers per triangle (x, y, z per corner) for `buildHeightField`.
 */
export function collectTerrainTriangles(zone: ZoneData): number[] {
  const { table, items } = zone;
  const out: number[] = [];
  for (const item of items) {
    const model = table.models[item.type];
    if (!model || model.sprite || model.flags & EF_2D_OBJECT) continue;
    const yaw = angleToRadians(item.zRot);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const v = model.vertices;
    const world = (i: number) => {
      const vx = v[i * 3]!;
      const vy = v[i * 3 + 1]!;
      const vz = v[i * 3 + 2]!;
      return [item.x + vx * cos - vy * sin, item.y + vx * sin + vy * cos, item.z + vz] as const;
    };
    for (const face of model.faces) {
      if (face.indices.length < 3) continue;
      const loop = face.indices.map(world);
      for (let k = 1; k + 1 < loop.length; k++) out.push(...loop[0]!, ...loop[k]!, ...loop[k + 1]!);
    }
  }
  return out;
}
