import type { Font, Glyph } from '../formats/fnt';
import { CHARACTER_SKILL_STRIDE, GAM_OFFSETS as O, parseGam, type GamSave } from '../formats/gam';
import type { Face, Model } from '../formats/tbl';
import type { ZoneData } from '../world/zone';

/**
 * Hand-built stand-ins for the original game data, so the end-to-end smoke tests run anywhere
 * (CI has no BaK install). Nothing here is copied from the game; it only has the right shapes.
 */

/** A plain 4x6 block font covering printable ASCII. */
export function syntheticFont(): Font {
  const glyphs: Glyph[] = [];
  for (let code = 32; code < 127; code++)
    glyphs.push({ code, width: 4, height: 6, pixels: new Uint8Array(24).fill(code === 32 ? 0 : 1) });
  return { version: 0xff, maxWidth: 4, height: 6, baseline: 5, firstChar: 32, glyphs };
}

/** A save image with Owyn and Pug active, 500 gold and ordinary skills. */
export function syntheticSave(): GamSave {
  const b = new Uint8Array(O.partyKeys + 3 + 4 * 8);
  const v = new DataView(b.buffer);
  v.setUint16(O.chapter, 1, true);
  v.setUint16(O.chapterCopy, 1, true);
  v.setUint32(O.gold, 500, true);
  v.setUint32(O.time, 6 * 1800, true); // 06:00 on day 0
  [
    ['Owyn', 0],
    ['Pug', 1],
  ].forEach(([name, index]) => {
    b.set(
      [...(name as string)].map((c) => c.charCodeAt(0)),
      O.characterName + (index as number) * 10,
    );
    const s = O.characterSkills + (index as number) * CHARACTER_SKILL_STRIDE;
    for (let skill = 0; skill < 16; skill++) b.set([50, 40, 40, 0, 0], s + 8 + skill * 5);
    b[O.characterConditions + 7 * (index as number)] = 0;
    v.setUint16(O.characterInventory + 0x70 * (index as number) + 1, 24, true);
  });
  b[O.activeCharacters] = 2;
  b.set([0, 1], O.activeCharacters + 1);
  v.setUint16(O.partyKeys + 1, 8, true);
  return parseGam(b);
}

const SPAN = 4800;
const quad = (z: number, half: number): number[] => [-half, -half, z, half, -half, z, half, half, z, -half, half, z];

const model = (name: string, extra: Partial<Model>): Model => ({
  name,
  flags: 0,
  entityType: 0,
  terrainType: 0,
  scale: 0,
  radius: 128,
  vertices: [],
  faces: [],
  frames: 1,
  ...extra,
});

/**
 * One flat grass tile with a stone block and a tree sprite on it. Palette entries 1..3 are
 * green, grey and brown; the tree sprite is a 16x24 brown-and-green bitmap.
 */
export function syntheticZone(): ZoneData {
  const palette = new Uint8Array(256 * 4);
  const colour = (i: number, r: number, g: number, bl: number) => palette.set([r, g, bl, 255], i * 4);
  colour(1, 70, 140, 60);
  colour(2, 150, 150, 160);
  colour(3, 110, 70, 40);
  const face = (color: number, indices: number[]): Face => ({ material: 0, color, indices });
  const ground = model('ground', { vertices: quad(0, SPAN / 2), faces: [face(1, [0, 1, 2, 3])] });
  const block = model('block', {
    vertices: [...quad(0, 150), ...quad(300, 150)],
    faces: [
      face(2, [4, 5, 6, 7]),
      face(2, [0, 1, 5, 4]),
      face(2, [1, 2, 6, 5]),
      face(2, [2, 3, 7, 6]),
      face(2, [3, 0, 4, 7]),
    ],
  });
  const tree = model('tree', { radius: 128, sprite: { index: 0, offsetX: 0, offsetY: 0, baseVertex: 0, scale: 256 } });
  const treePixels = new Uint8Array(16 * 24);
  for (let y = 0; y < 24; y++)
    for (let x = 0; x < 16; x++) treePixels[y * 16 + x] = y < 14 ? (x > 1 && x < 14 ? 1 : 0) : x > 6 && x < 10 ? 3 : 0;
  const item = (type: number, x: number, y: number) => ({ type, xRot: 0, yRot: 0, zRot: 0, x, y, z: 0 });
  return {
    zone: 1,
    palette,
    table: { models: [ground, block, tree], clips: [] },
    items: [item(0, 0, 0), item(1, 800, 800), item(2, -600, 900), item(2, 600, 1500), item(2, -900, -400)],
    slotImages: [{ width: 16, height: 24, pixels: treePixels }],
    terrain: [],
    tiles: [[0, 0]],
  } as unknown as ZoneData;
}
