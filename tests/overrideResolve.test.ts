import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { resolveArtPath } from '../src/assets/artServe';
import {
  buildOverrideMeshes,
  overriddenModelNames,
  placementMatrix,
  slotTextureUrl,
} from '../src/render/overrideResolve';
import { buildZoneScene } from '../src/render/zoneScene';
import type { ModelTable } from '../src/formats/tbl';
import type { WorldItem } from '../src/formats/world';

const item = (type: number, x: number, y: number, z: number, zRot = 0): WorldItem =>
  ({ type, x, y, z, zRot }) as WorldItem;
const table = {
  names: ['ground', 'Inn', 'tree1'],
  models: [
    { name: 'ground', vertices: [], faces: [], radius: 0, scale: 1, flags: 0 },
    { name: 'Inn', vertices: [], faces: [], radius: 0, scale: 1, flags: 0 },
    { name: 'tree1', vertices: [], faces: [], radius: 0, scale: 1, flags: 0, sprite: { index: 4, scale: 0 } },
  ],
  clips: [],
  warnings: [],
} as unknown as ModelTable;

describe('slotTextureUrl', () => {
  it('pads the zone number', () => {
    expect(slotTextureUrl(1, 12)).toBe('/art/Z01/slots-4x/12.png');
    expect(slotTextureUrl(11, 0)).toBe('/art/Z11/slots-4x/0.png');
  });
});

describe('overriddenModelNames', () => {
  it('lists used, overridden names lowercased, covering sprite models', () => {
    const items = [item(0, 0, 0, 0), item(1, 0, 0, 0), item(2, 0, 0, 0), item(1, 5, 5, 0)];
    const has = (n: string) => ['inn', 'tree1'].includes(n.toLowerCase());
    expect([...overriddenModelNames(items, table, has)].sort()).toEqual(['inn', 'tree1']);
    expect([...overriddenModelNames(items, table, () => false)]).toEqual([]);
  });
});

describe('placementMatrix', () => {
  it('maps BaK x/y/z to render x/z/-y and applies yaw about up', () => {
    const p = new THREE.Vector3();
    placementMatrix(item(1, 200, 300, 50, 0)).decompose(p, new THREE.Quaternion(), new THREE.Vector3());
    expect(p.toArray()).toEqual([2, 0.5, -3]);
    // A quarter turn CCW (seen from above) takes BaK +x to BaK +y, i.e. render -z.
    const m = placementMatrix(item(1, 0, 0, 0, 0x4000));
    const east = new THREE.Vector3(1, 0, 0).applyMatrix4(m);
    expect(east.x).toBeCloseTo(0);
    expect(east.z).toBeCloseTo(-1);
  });
});

describe('buildOverrideMeshes / buildZoneScene', () => {
  const makeScene = () => {
    const g = new THREE.Group();
    g.scale.setScalar(2);
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
    return g;
  };

  it('instances each mesh over the placements, including the manifest transform', () => {
    const meshes = buildOverrideMeshes('inn', makeScene(), [
      placementMatrix(item(1, 100, 0, 0)),
      placementMatrix(item(1, 0, 100, 0)),
    ]);
    expect(meshes).toHaveLength(1);
    expect(meshes[0]!.count).toBe(2);
    const m = new THREE.Matrix4();
    meshes[0]!.getMatrixAt(0, m);
    expect(new THREE.Vector3(1, 0, 0).applyMatrix4(m).toArray()).toEqual([3, 0, 0]);
  });

  it('replaces original geometry and sprites for overridden names only', () => {
    const zone = {
      zone: 1,
      palette: new Uint8Array(1024),
      table,
      items: [item(1, 0, 0, 0), item(2, 100, 100, 0), item(0, 0, 0, 0)],
      slotImages: [],
      terrain: [],
      tiles: [],
    } as never;
    const plan = { models: new Map([['inn', makeScene()]]), slotTextures: new Map() };
    const out = buildZoneScene(zone, plan);
    expect(out.stats.overridden).toBe(1);
    expect(out.group.children.map((c) => c.name)).toEqual(['override:inn']);
  });
});

describe('resolveArtPath', () => {
  const root = '/srv/art/reference';
  it('maps png urls inside the root', () => {
    expect(resolveArtPath(root, '/Z01/slots-4x/3.png?x=1')).toBe(path.resolve(root, 'Z01/slots-4x/3.png'));
  });
  it('rejects traversal and non-png files', () => {
    expect(resolveArtPath(root, '/../secret.png')).toBeUndefined();
    expect(resolveArtPath(root, '/%2e%2e/secret.png')).toBeUndefined();
    expect(resolveArtPath(root, '/Z01/models.json')).toBeUndefined();
  });
});
