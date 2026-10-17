import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { BagFigures, sackProfile } from './bagFigures';

describe('dropped bags in the world', () => {
  it('stands a sack where each bag lies and rebuilds only when the bags change', () => {
    const scene = new THREE.Scene();
    const figures = new BagFigures(scene);
    const flat = () => 0;
    figures.update([{ id: 'bag:1:100:200:0', x: 100, y: 200 }], flat);
    expect(figures.count).toBe(1);
    const first = figures.group.children[0];
    expect(first!.position.x).toBeCloseTo(1);
    expect(first!.position.z).toBeCloseTo(-2);
    figures.update([{ id: 'bag:1:100:200:0', x: 100, y: 200 }], flat);
    expect(figures.group.children[0]).toBe(first);
    figures.update([], flat);
    expect(figures.count).toBe(0);
  });

  it('is shaped like a tied sack: a full belly and a narrow neck', () => {
    const r = sackProfile().map((p) => p.x);
    expect(Math.max(...r)).toBeGreaterThan(r[6]! * 4);
  });
});
