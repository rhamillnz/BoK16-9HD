import { describe, expect, it, vi } from 'vitest';
import { Group } from 'three/webgpu';
import { AssetOverrides, ManifestError, parseManifest } from '../src/assets/overrides';

const valid = {
  version: 1,
  models: {
    Inn: { file: 'inn.glb', scale: 0.5, rotation: [0, Math.PI, 0], offset: [1, 2, 3] },
    tree1: { file: 'nature/tree1.glb' },
  },
};

describe('parseManifest', () => {
  it('normalizes names, defaults and scalar scale', () => {
    const m = parseManifest(valid);
    expect(m.models.get('inn')).toEqual({
      file: 'inn.glb',
      scale: [0.5, 0.5, 0.5],
      rotation: [0, Math.PI, 0],
      offset: [1, 2, 3],
    });
    expect(m.models.get('tree1')).toEqual({
      file: 'nature/tree1.glb',
      scale: [1, 1, 1],
      rotation: [0, 0, 0],
      offset: [0, 0, 0],
    });
  });

  it('accepts the shipped empty manifest', () => {
    expect(parseManifest({ version: 1, models: {} }).models.size).toBe(0);
  });

  it.each([
    ['non-object root', []],
    ['bad version', { version: 2, models: {} }],
    ['missing models', { version: 1 }],
    ['entry not an object', { version: 1, models: { a: 'a.glb' } }],
    ['missing file', { version: 1, models: { a: {} } }],
    ['non-glb file', { version: 1, models: { a: { file: 'a.obj' } } }],
    ['absolute file', { version: 1, models: { a: { file: '/a.glb' } } }],
    ['parent traversal', { version: 1, models: { a: { file: '../a.glb' } } }],
    ['url file', { version: 1, models: { a: { file: 'http://x/a.glb' } } }],
    ['short vector', { version: 1, models: { a: { file: 'a.glb', offset: [1, 2] } } }],
    ['NaN-ish vector', { version: 1, models: { a: { file: 'a.glb', rotation: [0, 'x', 0] } } }],
    ['zero scale', { version: 1, models: { a: { file: 'a.glb', scale: [1, 0, 1] } } }],
    ['scalar rotation', { version: 1, models: { a: { file: 'a.glb', rotation: 1 } } }],
    ['duplicate after lowercasing', { version: 1, models: { A: { file: 'a.glb' }, a: { file: 'b.glb' } } }],
  ])('rejects %s', (_label, json) => {
    expect(() => parseManifest(json)).toThrow(ManifestError);
  });
});

describe('AssetOverrides', () => {
  const makeScene = () => {
    const g = new Group();
    g.add(new Group());
    return g;
  };

  it('falls back when no override exists', async () => {
    const load = vi.fn();
    const o = new AssetOverrides(parseManifest(valid), '/models/', load);
    expect(await o.resolve('chest_nl')).toEqual({ fallback: true, name: 'chest_nl' });
    expect(load).not.toHaveBeenCalled();
  });

  it('loads once, caches, and returns transformed clones', async () => {
    const load = vi.fn(async () => makeScene());
    const o = new AssetOverrides(parseManifest(valid), '/models/', load);
    const a = await o.resolve('INN');
    const b = await o.resolve('inn');
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('/models/inn.glb');
    if (a.fallback || b.fallback) throw new Error('expected overrides');
    expect(a.scene).not.toBe(b.scene);
    expect(a.scene.scale.toArray()).toEqual([0.5, 0.5, 0.5]);
    expect(a.scene.position.toArray()).toEqual([1, 2, 3]);
    expect(a.scene.rotation.y).toBeCloseTo(Math.PI);
  });

  it('falls back when the glb fails to load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const o = new AssetOverrides(parseManifest(valid), '/models/', async () => {
      throw new Error('404');
    });
    expect((await o.resolve('inn')).fallback).toBe(true);
    warn.mockRestore();
  });

  it('reports has/get case-insensitively', () => {
    const o = new AssetOverrides(parseManifest(valid), '/models/');
    expect(o.has('TREE1')).toBe(true);
    expect(o.has('chest_nl')).toBe(false);
    expect(o.get('tree1')?.file).toBe('nature/tree1.glb');
  });
});
