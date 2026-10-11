import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { TREE_VARIATION, ZONE_FOLIAGE, isPlantModel, styleInstances } from './treeStyle';

const at = (x: number, z: number) => new THREE.Matrix4().makeTranslation(x, 0, z);

describe('isPlantModel', () => {
  it('matches kit plants only', () => {
    for (const n of ['tree0', 'tree9a', 'grove', 'fern', 'bush1', 'bush5']) expect(isPlantModel(n)).toBe(true);
    for (const n of ['house', 'treehouse', 'tstone1', 'scatter_rock1', 'bush']) expect(isPlantModel(n)).toBe(false);
  });
});

describe('styleInstances', () => {
  const placements = Array.from({ length: 200 }, (_, i) => at(i * 3.7, (i % 13) * 5.1));
  it('is deterministic and keeps positions', () => {
    const a = styleInstances(1, placements);
    const b = styleInstances(1, placements);
    expect(a.matrices.map((m) => m.elements.join())).toEqual(b.matrices.map((m) => m.elements.join()));
    expect(a.matrices[7]!.elements[12]).toBeCloseTo(7 * 3.7);
  });
  it('varies height within the configured spread and gives different colours', () => {
    const { matrices, colors } = styleInstances(1, placements);
    const heights = matrices.map((m) => m.elements[5]!);
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(1 - TREE_VARIATION.height - 1e-6);
    expect(Math.max(...heights)).toBeLessThanOrEqual(1 + TREE_VARIATION.height + 1e-6);
    expect(new Set(heights.map((h) => h.toFixed(3))).size).toBeGreaterThan(50);
    expect(new Set(colors.map((c) => c.getHex())).size).toBeGreaterThan(50);
  });
  it('applies the zone tint', () => {
    const mean = (z: number) => {
      const cs = styleInstances(z, placements).colors;
      return cs.reduce((s, c) => s + c.b / Math.max(c.r, 1e-6), 0) / cs.length;
    };
    expect(ZONE_FOLIAGE[6]).toBeDefined();
    expect(mean(6)).toBeGreaterThan(mean(1) * 1.1);
  });
});

describe('styleInstances palette', () => {
  it('gives each instance one of the palette colours', () => {
    const placements = Array.from({ length: 200 }, (_, i) => at(i * 2.3, (i % 7) * 4.1));
    const palette = [
      [1, 0.5, 0.5],
      [0.5, 1, 0.5],
    ] as const;
    const { colors } = styleInstances(1, placements, palette);
    const reddish = colors.filter((c) => c.r > c.g).length;
    expect(reddish).toBeGreaterThan(40);
    expect(reddish).toBeLessThan(160);
  });
});
