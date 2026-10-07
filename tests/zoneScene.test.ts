import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { buildZoneScene, createBillboards } from '../src/render/zoneScene';
import type { ZoneData } from '../src/world/zone';

const img = (w: number, h: number) => ({ width: w, height: h, pixels: new Uint8Array(w * h).fill(1) });
const model = (sprite?: { index: number; scale: number }) => ({
  name: 'tree', flags: 0, entityType: 0, terrainType: 0, scale: 0, radius: 128, vertices: [], faces: [], frames: 1, sprite,
});

describe('instanced billboards', () => {
  it('batches sprites into InstancedMeshes per texture and ground chunk with the original sizing', () => {
    const palette = new Uint8Array(256 * 4).fill(255);
    const zone = {
      zone: 1,
      palette,
      table: { models: [model({ index: 0, scale: 256 }), model({ index: 1, scale: 256 })], clips: [] },
      items: [
        { type: 0, xRot: 0, yRot: 0, zRot: 0, x: 1000, y: 2000, z: 300 },
        { type: 0, xRot: 0, yRot: 0, zRot: 0, x: 3000, y: 4000, z: 0 },
        { type: 1, xRot: 0, yRot: 0, zRot: 0, x: 0, y: 0, z: 0 },
      ],
      slotImages: [img(8, 16), img(16, 16)],
      terrain: [],
      tiles: [],
    } as unknown as ZoneData;
    const scene = buildZoneScene(zone);
    const meshes = scene.group.children.filter((o): o is THREE.InstancedMesh => o instanceof THREE.InstancedMesh);
    // Texture 0's two trees sit in different 32-unit ground chunks, so they get a mesh each.
    expect(meshes.map((m) => m.count)).toEqual([1, 1, 1]);
    expect(meshes.every((m) => m.userData.chunk)).toBe(true);
    expect(scene.stats.sprites).toBe(3);
    expect(scene.stats.drawCalls).toBe(3);
    expect(scene.group.children.some((o) => o instanceof THREE.Sprite)).toBe(false);

    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    meshes[0]!.getMatrixAt(0, m);
    p.setFromMatrixPosition(m);
    expect(p.toArray()).toEqual([10, 3, -20]);
  });

  it('anchors the quad at its bottom centre', () => {
    const mesh = createBillboards(new THREE.Texture(), [0, 0, 0, 1, 2], 'x');
    const pos = mesh.geometry.getAttribute('position');
    let minY = Infinity;
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      minY = Math.min(minY, pos.getY(i));
      minX = Math.min(minX, pos.getX(i));
      maxX = Math.max(maxX, pos.getX(i));
    }
    expect([minY, minX, maxX]).toEqual([0, -0.5, 0.5]);
  });
});
