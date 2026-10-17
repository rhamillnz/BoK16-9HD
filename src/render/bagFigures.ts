import * as THREE from 'three/webgpu';
import { PARTY_SCALE } from './fighterModels';
import { WORLD_SCALE } from './zoneScene';

/**
 * Bags the party dropped (manual: leave an item in a bag on the ground and come back for it): a tied sack
 * standing where each one lies. Rebuilt only when the zone's bags change.
 */

/** A sack's height in metres. */
const SACK_HEIGHT = 0.55;

export interface BagSpot {
  id: string;
  x: number;
  y: number;
}

/** The outline of a sack, turned about its axis: a full belly, a pinched neck and a flared, tied top. */
export function sackProfile(): THREE.Vector2[] {
  const pts: [number, number][] = [
    [0, 0],
    [0.17, 0.01],
    [0.22, 0.12],
    [0.21, 0.28],
    [0.14, 0.4],
    [0.05, 0.46],
    [0.04, 0.48],
    [0.08, 0.53],
    [0.06, 0.55],
    [0, 0.55],
  ];
  return pts.map(([r, h]) => new THREE.Vector2(r, h));
}

export class BagFigures {
  readonly group = new THREE.Group();
  private key = '';
  private readonly geometry = new THREE.LatheGeometry(sackProfile(), 14);
  private readonly material = new THREE.MeshStandardNodeMaterial({ color: 0x6b4a2a, roughness: 0.95 });

  constructor(scene: THREE.Scene) {
    this.group.name = 'bags';
    scene.add(this.group);
  }

  get count(): number {
    return this.group.children.length;
  }

  /** Call every frame (cheap when nothing changed) with the current zone's bags. */
  update(bags: readonly BagSpot[], getHeight: (x: number, y: number) => number): void {
    const key = bags.map((b) => b.id).join('|');
    if (key === this.key) return;
    this.key = key;
    this.group.clear();
    const s = (PARTY_SCALE * SACK_HEIGHT) / 0.55;
    for (const b of bags) {
      const mesh = new THREE.Mesh(this.geometry, this.material);
      mesh.position.set(b.x / WORLD_SCALE, getHeight(b.x, b.y) / WORLD_SCALE, -b.y / WORLD_SCALE);
      // A little squashed and turned, so no two look stamped out.
      const h = [...b.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
      mesh.scale.set(s, s * (0.85 + (h % 20) / 100), s);
      mesh.rotation.y = ((h % 360) * Math.PI) / 180;
      mesh.castShadow = true;
      this.group.add(mesh);
    }
  }
}
