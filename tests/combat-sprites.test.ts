import { describe, expect, it } from 'vitest';
import { combatSprite, spriteSheetName } from '../src/combat/sprites';
import type { IndexedImage } from '../src/formats/bmx';
import type { Model } from '../src/formats/tbl';

const img = (width: number, height: number): IndexedImage => ({
  width,
  height,
  pixels: new Uint8Array(width * height),
});
const model = (over: Partial<Model> = {}): Model => ({
  name: 'm',
  flags: 0,
  entityType: 0,
  terrainType: 0,
  scale: 1,
  radius: 128,
  vertices: [],
  faces: [],
  frames: 1,
  sprite: { index: 1, offsetX: 0, offsetY: 0, baseVertex: 0, scale: 256 },
  ...over,
});
const set = { prefix: 'brig', suffixes: [2, 3, 4] as [number, number, number], colorSwap: 0 };

describe('combatSprite', () => {
  it('names the first sprite sheet of the set', () => {
    expect(spriteSheetName(set)).toBe('BRIG2.BMX');
  });

  it('takes the model sprite from the sheet and sizes it from radius and scale', () => {
    const asked: string[] = [];
    const s = combatSprite(
      1,
      { models: [undefined, model()] },
      [set, set],
      (name) => (asked.push(name), [img(10, 10), img(20, 40)]),
    );
    expect(asked).toEqual(['BRIG2.BMX']);
    expect(s!.image.width).toBe(20);
    // major = 2 * 128 * 256 / 256 * 1 = 256; the taller side gets it, times the 1.2 pixel stretch.
    expect(s!.height).toBeCloseTo(256 * 1.2);
    expect(s!.width).toBeCloseTo(128);
  });

  it('treats a stored scale of 0 as 256', () => {
    const m = model({ sprite: { index: 0, offsetX: 0, offsetY: 0, baseVertex: 0, scale: 0 } });
    const s = combatSprite(0, { models: [m] }, [set], () => [img(8, 8)]);
    expect(s!.width).toBeCloseTo(256);
  });

  it('is undefined without a model, sprite, set or image', () => {
    const load = () => [img(4, 4)];
    expect(combatSprite(0, { models: [undefined] }, [set], load)).toBeUndefined();
    expect(combatSprite(0, { models: [model({ sprite: undefined })] }, [set], load)).toBeUndefined();
    expect(combatSprite(0, { models: [model()] }, [{ ...set, prefix: '' }], load)).toBeUndefined();
    expect(combatSprite(0, { models: [model()] }, [set], () => undefined)).toBeUndefined();
    expect(
      combatSprite(
        0,
        { models: [model({ sprite: { index: 9, offsetX: 0, offsetY: 0, baseVertex: 0, scale: 1 } })] },
        [set],
        load,
      ),
    ).toBeUndefined();
  });
});
